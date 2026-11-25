"""Restaurants: partner onboarding, admin review, public discovery (Node: restaurant.service.js)."""

import uuid
from functools import reduce
from operator import or_
from typing import Any

from django.conf import settings
from django.db import connection, transaction
from django.db.models import Count, F, Q, QuerySet
from django.db.models.expressions import RawSQL
from django.db.models.fields import TextField
from django.db.models.functions import Cast
from django.utils import timezone

from apps.accounts.admin_services import joined_between
from apps.accounts.models import User
from apps.dispatch.tunables import max_delivery_km
from apps.kyc import services as kyc
from apps.menus.models import FoodItem
from apps.notifications.services import notify, notify_admins
from apps.rbac.roles import Permission
from common.api import ApiError
from common.filters import Facet, apply_facets, with_facets
from common.geo import GeoPoint
from common.geo_sql import Distance, DWithin, point_sql
from common.pagination import Page, paginate
from common.slug import unique_slug

from .models import ADMIN_STATUS_TRANSITIONS, Restaurant, RestaurantStatus
from .presenters import is_open_now, restaurant_json

OWNER_FIELDS = (
    "name",
    "description",
    "cuisines",
    "phone",
    "email",
    "image_url",
    "is_pure_veg",
    "cost_for_two_paise",
    "min_order_paise",
    "avg_prep_time_minutes",
    "opening_time",
    "closing_time",
    "owner_name",
    "gst_registered",
    "gstin",
    "fssai_number",
    "fssai_valid_until",
    "photos",
    "weekly_hours",
)
NULLABLE = {"fssai_valid_until", "weekly_hours"}
ADDRESS_FIELDS = ("line1", "line2", "area", "city", "state", "postal_code")

STATUS_NOTICE = {
    RestaurantStatus.APPROVED: (
        "Your restaurant is live",
        "Customers can now find you and place orders.",
    ),
    RestaurantStatus.REJECTED: (
        "Your application needs changes",
        "Update your details to send it for review again.",
    ),
    RestaurantStatus.SUSPENDED: (
        "Your restaurant is suspended",
        "Customers cannot order until BiteBox reinstates it.",
    ),
    RestaurantStatus.RESUBMISSION_REQUESTED: (
        "Please update your documents",
        "Fix what is asked on the Verification page, then send it for review again.",
    ),
}
NEEDS_REASON = (
    RestaurantStatus.REJECTED,
    RestaurantStatus.SUSPENDED,
    RestaurantStatus.RESUBMISSION_REQUESTED,
)


def _apply(restaurant: Restaurant, data: dict[str, Any]) -> None:
    for field in OWNER_FIELDS:
        if field in data:
            empty = None if field in NULLABLE else ""
            setattr(restaurant, field, data[field] if data[field] is not None else empty)
    if address := data.get("address"):
        for field in ADDRESS_FIELDS:
            setattr(restaurant, field, address.get(field, "") or "")
    if location := data.get("location"):
        restaurant.location = GeoPoint(lat=location["latitude"], lng=location["longitude"])


def _ask_for_review(r: Restaurant, title: str, body: str) -> None:
    notify_admins(
        Permission.RESTAURANTS_MANAGE,
        type="restaurant.review",
        title=f"{title}: {r.name}",
        body=body,
        link=f"/admin/restaurants/{r.pk}",
    )


def own_restaurant(owner: User) -> Restaurant | None:
    return Restaurant.objects.filter(owner=owner).first()


def require_own_restaurant(owner: User) -> Restaurant:
    restaurant = own_restaurant(owner)
    if restaurant is None:
        raise ApiError.not_found("Create your restaurant profile first")
    return restaurant


def create_own(owner: User, data: dict[str, Any]) -> Restaurant:
    if Restaurant.objects.filter(owner=owner).exists():
        raise ApiError.conflict("You already have a restaurant. Edit it instead.")
    restaurant = Restaurant(owner=owner, status=RestaurantStatus.PENDING)
    _apply(restaurant, data)
    restaurant.slug = unique_slug(Restaurant, data["name"])
    restaurant.save()
    _ask_for_review(
        restaurant, "New restaurant application", "Review it to put it live on BiteBox."
    )
    return restaurant


def apply_update(restaurant: Restaurant, data: dict[str, Any]) -> None:
    """Sets the partner-editable fields (RestaurantInput, partial) without saving; a new name
    gets a new slug. Shared by the partner's own edit and the admin's (restaurant accounts)."""
    old_name = restaurant.name
    _apply(restaurant, data)
    if data.get("name") and data["name"] != old_name:
        restaurant.slug = unique_slug(Restaurant, data["name"], restaurant.pk)


def update_own(owner: User, data: dict[str, Any]) -> Restaurant:
    restaurant = require_own_restaurant(owner)
    apply_update(restaurant, data)
    resubmitted = restaurant.status == RestaurantStatus.REJECTED
    if resubmitted:  # editing a rejected application sends it back for review
        restaurant.status = RestaurantStatus.PENDING
        restaurant.status_reason = ""
    restaurant.save()
    if resubmitted:
        _ask_for_review(
            restaurant, "Restaurant resubmitted", "The owner updated a rejected application."
        )
    return restaurant


def set_accepting_orders(owner: User, accepting: bool) -> Restaurant:
    restaurant = require_own_restaurant(owner)
    set_accepting(restaurant, accepting)
    return restaurant


def set_accepting(restaurant: Restaurant, accepting: bool) -> None:
    """Open or pause new orders (the partner's toggle; admins may close it too)."""
    restaurant.is_accepting_orders = accepting
    restaurant.save(update_fields=["is_accepting_orders", "updated_at"])


def owner_stats(restaurant: Restaurant) -> dict[str, int]:
    return FoodItem.objects.filter(restaurant=restaurant, deleted_at__isnull=True).aggregate(
        total_items=Count("id"),
        available_items=Count("id", filter=Q(is_available=True)),
        categories_used=Count("category", distinct=True),
    )


# --- admin ----------------------------------------------------------------------------------------


TABLE = connection.ops.quote_name(Restaurant._meta.db_table)


def _text_search(qs: QuerySet[Restaurant], search: str, also: Q) -> QuerySet[Restaurant]:
    """Name or any cuisine contains `search`, or `also` matches."""
    return qs.annotate(_cuisines=Cast("cuisines", TextField())).filter(
        Q(name__icontains=search) | Q(_cuisines__icontains=search) | also
    )


PLACE_FIELDS = ("line1", "line2", "area", "city", "postal_code")


def _place_match(term: str) -> Q:
    """The restaurant's street, area, city or PIN code contains `term`."""
    return reduce(or_, (Q(**{f"{f}__icontains": term}) for f in PLACE_FIELDS))


VEG = {"pure_veg": Q(is_pure_veg=True), "mixed": Q(is_pure_veg=False)}
ACCEPTING = {"open": Q(is_accepting_orders=True), "closed": Q(is_accepting_orders=False)}
# Facets (and filters) shared with the restaurant accounts list (accounts.FACETS).
STATUS_FACET = Facet("status", values=RestaurantStatus.values)
CITY_FACET = Facet("city", ignore_case=True)  # the cities that occur, by count


def _cuisine_any(values: list[str]) -> Q:
    """Restaurants with any of the cuisines (each trimmed, any letter case)."""
    matching = RawSQL(  # noqa: S611 (the values are a bound parameter)
        f"SELECT r.id FROM {TABLE} r "  # noqa: S608 (table name)
        "CROSS JOIN LATERAL jsonb_array_elements_text(r.cuisines) c(value) "
        "WHERE lower(btrim(c.value)) = ANY(SELECT lower(btrim(v)) FROM unnest(%s::text[]) v)",
        (values,),
    )
    return Q(pk__in=matching)


ADMIN_FACETS = (
    STATUS_FACET,
    CITY_FACET,
    # Each cuisine that occurs; a restaurant counts once under each of its cuisines.
    Facet("cuisine", field="cuisines", elements=True, ignore_case=True, match=_cuisine_any),
    Facet("veg", values=list(VEG), cases=VEG),
    Facet("accepting", values=list(ACCEPTING), cases=ACCEPTING),
)


def _admin_restaurants(query: dict[str, Any]) -> QuerySet[Restaurant]:
    """The restaurants matching the filters (ADMIN_FACETS, joined days, `search`)."""
    qs = apply_facets(Restaurant.objects.select_related("owner"), query, ADMIN_FACETS)
    qs = qs.filter(joined_between(query))
    if search := (query.get("search") or "").strip():
        qs = _text_search(qs, search, Q(city__icontains=search))
    return qs


def admin_list(query: dict[str, Any], page: Page) -> dict[str, Any]:
    items, meta = paginate(_admin_restaurants(query).order_by("-created_at"), page)
    result = {"items": [restaurant_json(r, owner="admin") for r in items], "pagination": meta}
    return with_facets(result, query, _admin_restaurants, ADMIN_FACETS)


def admin_get(restaurant_id: uuid.UUID) -> Restaurant:
    restaurant = Restaurant.objects.select_related("owner").filter(pk=restaurant_id).first()
    if restaurant is None:
        raise ApiError.not_found("Restaurant not found")
    return restaurant


def admin_counts() -> dict[str, int]:
    counts = {s.value: 0 for s in RestaurantStatus}
    for row in Restaurant.objects.values("status").annotate(n=Count("id")):
        counts[row["status"]] = row["n"]
    return counts


def admin_set_status(restaurant_id: uuid.UUID, status: str, reason: str, admin: User) -> Restaurant:
    current = Restaurant.objects.filter(pk=restaurant_id).values_list("status", flat=True).first()
    if current is None:
        raise ApiError.not_found("Restaurant not found")
    if status not in ADMIN_STATUS_TRANSITIONS.get(current, frozenset()):
        raise ApiError.conflict(f"Cannot change a {current} restaurant to {status}")
    if status in NEEDS_REASON and not reason:
        raise ApiError.bad_request("A reason is required")
    if status == RestaurantStatus.APPROVED and (gaps := kyc_gaps(admin_get(restaurant_id))):
        raise ApiError.conflict(
            "Finish the verification first: " + ", ".join(gaps), code="KYC_INCOMPLETE"
        )

    with transaction.atomic():
        # Only if nobody changed it in the meantime.
        changed = Restaurant.objects.filter(pk=restaurant_id, status=current).update(
            status=status,
            status_reason=reason or "",
            reviewed_at=timezone.now(),
            reviewed_by=admin,
            updated_at=timezone.now(),
        )
        if not changed:
            raise ApiError.conflict(
                "This restaurant was updated by someone else. Refresh and try again."
            )
        restaurant = admin_get(restaurant_id)
    if notice := STATUS_NOTICE.get(RestaurantStatus(status)):
        title, body = notice
        notify(
            restaurant.owner_id,
            type=f"restaurant.{status}",
            title=title,
            body=f"{body} Reason: {reason}" if reason else body,
            link="/restaurant/verification"
            if status == RestaurantStatus.RESUBMISSION_REQUESTED
            else "/restaurant",
        )
    return restaurant


def kyc_gaps(restaurant: Restaurant) -> list[str]:
    """What stops approval (RESTAURANT_KYC_REQUIRED): the FSSAI number, documents, bank account."""
    if not settings.RESTAURANT_KYC_REQUIRED:
        return []
    gaps = [] if restaurant.fssai_number else ["FSSAI number"]
    return gaps + kyc.missing(restaurant.owner)


def resubmit(owner: User) -> Restaurant:
    """The owner fixed what was asked: back to the review queue."""
    restaurant = require_own_restaurant(owner)
    if restaurant.status not in (
        RestaurantStatus.REJECTED,
        RestaurantStatus.RESUBMISSION_REQUESTED,
    ):
        raise ApiError.conflict("Your restaurant is not waiting for changes")
    restaurant.status, restaurant.status_reason = RestaurantStatus.PENDING, ""
    restaurant.save(update_fields=["status", "status_reason", "updated_at"])
    _ask_for_review(restaurant, "Restaurant resubmitted", "The owner sent it for review again.")
    return restaurant


# --- public ---------------------------------------------------------------------------------------

CUISINE_MATCH_SQL = (
    f"EXISTS (SELECT 1 FROM jsonb_array_elements_text({TABLE}.cuisines) c "  # noqa: S608 (table name)
    "WHERE lower(c) = lower(%s))"
)

SORTS: dict[str, tuple[Any, ...]] = {
    "rating": (F("rating_average").desc(), F("rating_count").desc(), "id"),
    "fastest": ("avg_prep_time_minutes", "id"),
    "costLow": ("cost_for_two_paise", "id"),
    "costHigh": (F("cost_for_two_paise").desc(), "id"),
    "newest": (F("created_at").desc(), "id"),
    "distance": ("distance_m", "id"),
}


def list_public(query: dict[str, Any], page: Page) -> dict[str, Any]:
    qs = Restaurant.objects.filter(status=RestaurantStatus.APPROVED)
    # A name, cuisine, dish or place ("Park Street"); "Park Street, Kolkata" needs every part.
    for term in [t.strip() for t in (query.get("search") or "").split(",") if t.strip()]:
        dish_restaurants = FoodItem.objects.filter(
            name__icontains=term, deleted_at__isnull=True
        ).values("restaurant_id")
        qs = _text_search(qs, term, Q(id__in=dish_restaurants) | _place_match(term))
    if cuisines := [c.strip() for c in (query.get("cuisine") or "").split(",") if c.strip()]:
        # Any of them equals one of the restaurant's cuisines, ignoring case.
        qs = qs.extra(  # noqa: S610 (the values are bound parameters)
            where=["(" + " OR ".join([CUISINE_MATCH_SQL] * len(cuisines)) + ")"], params=cuisines
        )
    if (min_rating := query.get("min_rating")) is not None:
        qs = qs.filter(rating_average__gte=min_rating)
    if (cost_min := query.get("cost_min")) is not None:
        qs = qs.filter(cost_for_two_paise__gte=cost_min)
    if (cost_max := query.get("cost_max")) is not None:
        qs = qs.filter(cost_for_two_paise__lte=cost_max)
    if query.get("offers"):
        from apps.coupons.services import restaurants_with_offers

        qs = qs.filter(id__in=restaurants_with_offers())
    if query.get("open_now"):
        # The same rule as the card's "Open now" (weekly hours, time zone, overnight slots).
        qs = qs.filter(id__in=[r.pk for r in qs.filter(is_accepting_orders=True) if is_open_now(r)])
    if query.get("veg"):
        qs = qs.filter(is_pure_veg=True)
    if category := query.get("category"):
        qs = qs.filter(
            id__in=FoodItem.objects.filter(
                category_id=category, deleted_at__isnull=True, is_available=True
            ).values("restaurant_id")
        )

    geo = query.get("lat") is not None and query.get("lng") is not None
    sort = query.get("sort") or ("distance" if geo else "rating")
    if sort == "distance" and not geo:
        raise ApiError.bad_request("Sorting by distance needs lat and lng")
    if geo:
        near = point_sql(GeoPoint(lat=query["lat"], lng=query["lng"]))
        # The admin's delivery range: a client may ask for less, never more.
        limit = max_delivery_km()
        radius_m = min(float(query.get("radius_km") or limit), limit) * 1000
        qs = qs.filter(DWithin(F("location"), near, radius_m)).annotate(
            distance_m=Distance(F("location"), near)
        )

    items, meta = paginate(qs.order_by(*SORTS[sort]), page)
    # Each card's offer badge: the restaurant's best live offer (apps/coupons imports this module).
    from apps.coupons.services import best_offers

    offers = best_offers(r.pk for r in items)
    return {
        "items": [
            {
                **restaurant_json(r, owner="public", distance_m=getattr(r, "distance_m", None)),
                "photos": [],  # the gallery has no limit: only the restaurant's page loads it
                "offer": offers.get(str(r.pk)),
            }
            for r in items
        ],
        "pagination": meta,
    }


def list_cuisines() -> list[str]:
    names: set[str] = set()
    for cuisines in Restaurant.objects.filter(status=RestaurantStatus.APPROVED).values_list(
        "cuisines", flat=True
    ):
        names.update(c.strip() for c in cuisines or [] if c and c.strip())
    return sorted(names, key=lambda c: (c.casefold(), c))


def get_public(slug_or_id: str) -> Restaurant:
    try:
        lookup: dict[str, Any] = {"pk": uuid.UUID(slug_or_id)}
    except ValueError:
        lookup = {"slug": slug_or_id.lower()}
    restaurant = Restaurant.objects.filter(status=RestaurantStatus.APPROVED, **lookup).first()
    if restaurant is None:
        raise ApiError.not_found("Restaurant not found")
    return restaurant
