"""
Restaurant accounts in the admin panel (Account management phase 3; Node:
services/restaurant-accounts.service.js): the list with order totals, rating, commission and
verification state, one restaurant's account page, and the admin's edits, status changes and
closing for orders. Status changes go through the existing admin review (services.admin_set_status)
and edits through the partner's own update (services.apply_update).
"""

import uuid
from typing import Any

from django.db import transaction
from django.db.models import (
    Case,
    Count,
    IntegerField,
    OuterRef,
    Q,
    QuerySet,
    Subquery,
    Value,
    When,
)
from django.db.models.functions import Coalesce, Trim

from apps.accounts.admin_services import (
    ACCOUNT_SORTS,
    distinct_names,
    id_search,
    joined_between,
    order_totals,
    person_search,
)
from apps.accounts.models import User
from apps.accounts.serializers import user_json
from apps.audit.services import change
from apps.finance.earnings import commissions_for
from apps.kyc import services as kyc
from apps.kyc.models import DocumentKind, KycDocument
from apps.orders.models import Order
from apps.rbac.roles import Permission, Role, has_permission
from common.api import ApiError
from common.pagination import Page, paginate
from common.permissions import NO_ACCESS

from . import services
from .models import Restaurant, RestaurantStatus
from .presenters import geo_json, restaurant_json

Changes = dict[str, Any]

SORTS: dict[str, tuple[Any, ...]] = {
    **ACCOUNT_SORTS,
    "orders": ("-stat_orders", "-created_at", "-id"),
    "rating": ("-rating_average", "-rating_count", "-created_at", "-id"),
}

# The restaurant checklist (kyc.KINDS_FOR / required_kinds): GST only when GST-registered.
GST = DocumentKind.GST_CERTIFICATE
ALWAYS = [k for k in kyc.KINDS_FOR[Role.RESTAURANT] if k != GST]


# --- verification state, worked out in the database ---------------------------------------------
def _with_kyc(qs: QuerySet[Restaurant]) -> QuerySet[Restaurant]:
    """`kyc_state` (kyc.with_state) over the owner's checklist."""
    required = KycDocument.objects.filter(user=OuterRef("owner_id")).filter(
        Q(kind__in=ALWAYS) | Q(kind=GST, user__restaurant__gst_registered=True)
    )
    needed = Case(
        When(gst_registered=True, then=Value(len(ALWAYS) + 1)),
        default=Value(len(ALWAYS)),
        output_field=IntegerField(),
    )
    return kyc.with_state(qs, "owner_id", required, needed)


def kyc_status(restaurant: Restaurant) -> dict[str, Any]:
    row = _with_kyc(Restaurant.objects.filter(pk=restaurant.pk)).first()
    return kyc.state_json(getattr(row, "kyc_state", None), restaurant.owner)


# --- list -----------------------------------------------------------------------------------------
def _search(search: str) -> Q:
    """Name or slug, the owner's name, email or phone, or the restaurant's id (or its end)."""
    return (
        Q(name__icontains=search)
        | Q(slug__icontains=search)
        | person_search(search, "owner__")
        | id_search(search)
    )


def _restaurants(query: dict[str, Any]) -> QuerySet[Restaurant]:
    qs = _with_kyc(Restaurant.objects.select_related("owner"))
    if query.get("status"):
        qs = qs.filter(status=query["status"])
    if query.get("account_status"):
        qs = qs.filter(owner__status=query["account_status"])
    if query.get("kyc"):
        qs = qs.filter(kyc_state=query["kyc"])  # type: ignore[misc]
    if city := (query.get("city") or "").strip():
        qs = qs.annotate(city_trimmed=Trim("city")).filter(city_trimmed__iexact=city)
    qs = qs.filter(joined_between(query))
    if search := (query.get("search") or "").strip():
        qs = qs.filter(_search(search))
    return qs


def _orders_count() -> Coalesce:
    return Coalesce(
        Subquery(
            Order.objects.filter(restaurant=OuterRef("pk"))
            .order_by()
            .values("restaurant")
            .annotate(n=Count("pk"))
            .values("n"),
            output_field=IntegerField(),
        ),
        Value(0),
    )


def _owner_card(owner: User | None) -> dict[str, Any] | None:
    if owner is None:
        return None
    return {
        "id": str(owner.pk),
        "name": owner.name,
        "email": owner.email,
        "phone": owner.phone or None,
        "status": owner.status,
        "avatar_url": owner.avatar_url or None,
    }


def _percent(basis_points: int) -> float | int:
    """1800 → 18, 1750 → 17.5."""
    percent = basis_points / 100
    return int(percent) if percent.is_integer() else percent


def _rating(r: Restaurant) -> dict[str, Any]:
    return {"average": float(r.rating_average), "count": r.rating_count}


def list_accounts(query: dict[str, Any], page: Page) -> dict[str, Any]:
    qs = _restaurants(query).annotate(stat_orders=_orders_count())
    rows, meta = paginate(qs.order_by(*SORTS[query.get("sort") or "newest"]), page)
    commissions = commissions_for(r.pk for r in rows)
    items = [
        {
            "id": str(r.pk),
            "name": r.name,
            "slug": r.slug,
            "image_url": r.image_url or None,
            "city": r.city,
            "status": r.status,
            "status_reason": r.status_reason or None,
            "is_accepting_orders": r.is_accepting_orders,
            "created_at": r.created_at,
            "owner": _owner_card(r.owner),
            "stats": {"orders": r.stat_orders, "rating": _rating(r)},
            "commission_percent": _percent(commissions[r.pk][0]),
            "kyc_status": r.kyc_state,
        }
        for r in rows
    ]
    return {"items": items, "pagination": meta}


def cities() -> list[str]:
    return distinct_names(Restaurant.objects.values_list("city", flat=True))


# --- one restaurant -------------------------------------------------------------------------------
def get(restaurant_id: uuid.UUID) -> Restaurant:
    return services.admin_get(restaurant_id)  # 404 "Restaurant not found"


def restaurant_out(r: Restaurant) -> dict[str, Any]:
    """The partner's own restaurant JSON (GET /my/restaurant), with the review fields always
    present (null when empty)."""
    return {
        **restaurant_json(r),
        "status": r.status,
        "status_reason": r.status_reason or None,
        "reviewed_at": r.reviewed_at,
    }


def detail(r: Restaurant) -> dict[str, Any]:
    stats = order_totals(Order.objects.filter(restaurant=r), "gross_paise")
    basis_points, source = commissions_for([r.pk])[r.pk]
    return {
        "restaurant": restaurant_out(r),
        "owner": user_json(r.owner) if r.owner_id else None,
        "stats": {**stats, "rating": _rating(r)},
        "commission": {"percent": _percent(basis_points), "source": source},
        "kyc": kyc_status(r),
    }


# --- edits ----------------------------------------------------------------------------------------
# Address field → its API name in the audit changes (riders' home address too).
ADDRESS_NAMES = {
    "line1": "address.line1",
    "line2": "address.line2",
    "area": "address.area",
    "city": "address.city",
    "state": "address.state",
    "postal_code": "address.postalCode",
}
# Field → its API (camelCase) name in the audit changes.
AUDIT_NAMES = {
    "name": "name",
    "description": "description",
    "cuisines": "cuisines",
    "phone": "phone",
    "email": "email",
    "image_url": "imageUrl",
    "is_pure_veg": "isPureVeg",
    "cost_for_two_paise": "costForTwoPaise",
    "min_order_paise": "minOrderPaise",
    "avg_prep_time_minutes": "avgPrepTimeMinutes",
    "opening_time": "openingTime",
    "closing_time": "closingTime",
    "owner_name": "ownerName",
    "gst_registered": "gstRegistered",
    "gstin": "gstin",
    "fssai_number": "fssaiNumber",
    "fssai_valid_until": "fssaiValidUntil",
    "photos": "photos",
    "weekly_hours": "weeklyHours",
    **ADDRESS_NAMES,
}
# A new number on an approved document means the document has to be checked again.
REVERIFY = {"gstin": DocumentKind.GST_CERTIFICATE, "fssai_number": DocumentKind.FSSAI_LICENCE}


def _snapshot(r: Restaurant) -> dict[str, Any]:
    values: dict[str, Any] = {f: getattr(r, f) for f in AUDIT_NAMES}
    values["location"] = geo_json(r.location)
    return values


def update(r: Restaurant, data: dict[str, Any]) -> tuple[Restaurant, Changes]:
    """
    The partner's editable details (same rules as PATCH /my/restaurant), but never the status: a
    rejected application stays rejected. A changed GSTIN or FSSAI number sends the matching
    approved document back for review. Returns what changed ({} when nothing did).
    """
    before = _snapshot(r)
    services.apply_update(r, data)
    after = _snapshot(r)
    changed = [f for f in after if after[f] != before[f]]
    if not changed:
        return r, {}
    changes: Changes = {AUDIT_NAMES.get(f, f): change(before[f], after[f]) for f in changed}
    with transaction.atomic():
        r.save()
        reverified = kyc.reverify(r.owner_id, [k for f, k in REVERIFY.items() if f in changed])
    if reverified:
        changes["reverified"] = reverified
    return r, changes


# --- status ---------------------------------------------------------------------------------------
STATUS_MESSAGES = {
    RestaurantStatus.APPROVED: "Restaurant approved",
    RestaurantStatus.REJECTED: "Restaurant rejected",
    RestaurantStatus.SUSPENDED: "Restaurant suspended",
    RestaurantStatus.RESUBMISSION_REQUESTED: "Asked for resubmission",
}


def status_permission(current: str, status: str) -> Permission:
    """Suspending, and lifting a suspension, is restaurants:status; reviewing is :approve."""
    if status == RestaurantStatus.SUSPENDED or (
        status == RestaurantStatus.APPROVED and current == RestaurantStatus.SUSPENDED
    ):
        return Permission.RESTAURANTS_STATUS
    return Permission.RESTAURANTS_APPROVE


def set_status(
    actor: User, restaurant_id: uuid.UUID, status: str, reason: str | None
) -> tuple[Restaurant, Changes, str]:
    """The existing admin review (transitions, KYC check, notifications); the same status again
    changes nothing. Returns the restaurant, the changes and the message."""
    r = get(restaurant_id)
    if not has_permission(actor, status_permission(r.status, status)):
        raise ApiError.forbidden(NO_ACCESS)
    previous = r.status
    if previous == status:
        return r, {}, STATUS_MESSAGES[RestaurantStatus(status)]
    r = services.admin_set_status(restaurant_id, status, reason or "", actor)
    message = (
        "Restaurant reactivated"
        if previous == RestaurantStatus.SUSPENDED and status == RestaurantStatus.APPROVED
        else STATUS_MESSAGES[RestaurantStatus(status)]
    )
    return r, {"status": change(previous, status)}, message


def set_accepting_orders(r: Restaurant, accepting: bool) -> Changes:
    """Close the restaurant for new orders (or reopen it); the partner can reopen it too."""
    if r.is_accepting_orders == accepting:
        return {}
    services.set_accepting(r, accepting)
    return {"isAcceptingOrders": change(not accepting, accepting)}
