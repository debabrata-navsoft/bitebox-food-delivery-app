"""
Coupons and restaurant offers (Node: services/coupon.service.js): the eligibility engine used by the
cart and order placement, what customers see, admin management and analytics, restaurant partners'
own offers, and the approval queue.

One engine decides everything: `problem()` says why a coupon cannot be used on a cart (or None),
`assert_eligible()` raises it, and `coupon_base()` is the part of the cart a category or dish
coupon applies to. Prices are always computed here and in apps/cart/pricing.py, never by clients.
"""

import secrets
import uuid
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from django.conf import settings
from django.db import IntegrityError, transaction
from django.db.models import Count, F, Q, QuerySet, Sum
from django.utils import timezone

from apps.accounts.models import User
from apps.cart.pricing import coupon_discount, js_round
from apps.menus.models import FoodItem
from apps.restaurants.models import Restaurant
from common.api import ApiError
from common.pagination import Page, paginate

from .models import ApprovalStatus, Audience, Coupon, CouponRedemption, DiscountType, Source

FIELDS = (
    "code",
    "name",
    "description",
    "terms",
    "discount_type",
    "discount_value",
    "max_discount_paise",
    "min_order_paise",
    "valid_from",
    "valid_until",
    "is_active",
    "usage_limit",
    "per_user_limit",
    "restaurant",
    "audience",
    "banner_url",
)
SCOPES = ("restaurants", "categories", "food_items")
# A typical basket for ranking offers on restaurant cards (what each would save on it).
REFERENCE_ORDER_PAISE = 50_000
FREE_DELIVERY_VALUE_PAISE = 4_000
PLATFORM_WIDE = Q(restaurant__isnull=True, restaurants__isnull=True)


# ---------------------------------------------------------------------------
# Eligibility engine
# ---------------------------------------------------------------------------
@dataclass(frozen=True)
class Line:
    """One cart line as the engine sees it."""

    food_item_id: Any
    category_id: Any
    total_paise: int


def _invalid(message: str, code: str = "COUPON_INVALID") -> ApiError:
    return ApiError(422, message, code=code)


def _validation_error(*details: dict[str, str]) -> ApiError:
    return ApiError(422, "Validation failed", code="VALIDATION_ERROR", details=list(details))


def _with_scopes(qs: QuerySet[Coupon]) -> QuerySet[Coupon]:
    """The owner and the scope lists, loaded up front (offer_json and coupon_json read them)."""
    return qs.select_related("restaurant").prefetch_related(*SCOPES)


def visible(now: datetime | None = None) -> QuerySet[Coupon]:
    """Coupons a customer may see now: approved, switched on, inside their dates, not used up."""
    now = now or timezone.now()
    return Coupon.objects.filter(
        approval_status=ApprovalStatus.APPROVED,
        is_active=True,
        valid_from__lte=now,
        valid_until__gte=now,
    ).filter(Q(usage_limit__isnull=True) | Q(used_count__lt=F("usage_limit")))


def is_new_customer(user_id: Any) -> bool:
    """No orders yet, other than ones that were cancelled or rejected."""
    from apps.orders.models import Order, OrderStatus  # orders imports this module

    return (
        not Order.objects.filter(customer_id=user_id)
        .exclude(status__in=[OrderStatus.CANCELLED, OrderStatus.REJECTED])
        .exists()
    )


def redemption_counts(user_id: Any, coupons: Iterable[Coupon]) -> dict[Any, int]:
    """How many times this customer has used each coupon (one query for a whole list)."""
    return dict(
        CouponRedemption.objects.filter(user_id=user_id, coupon__in=list(coupons))
        .values_list("coupon")
        .annotate(n=Count("id"))
    )


def _restaurant_ids(c: Coupon) -> set[str]:
    ids = {str(r.pk) for r in c.restaurants.all()}
    if c.restaurant_id:
        ids.add(str(c.restaurant_id))
    return ids


def coupon_base(c: Coupon, lines: Iterable[Line] | None) -> int | None:
    """What a category or dish coupon applies to: those lines' total (None: the whole cart)."""
    categories = {str(x.pk) for x in c.categories.all()}
    items = {str(x.pk) for x in c.food_items.all()}
    if (not categories and not items) or lines is None:
        return None
    return sum(
        line.total_paise
        for line in lines
        if str(line.food_item_id) in items or str(line.category_id) in categories
    )


def problem(
    c: Coupon,
    *,
    user_id: Any,
    restaurant_id: Any,
    subtotal_paise: int,
    lines: Iterable[Line] | None = None,
    new_customer: bool | None = None,
    used: int | None = None,
    now: datetime | None = None,
) -> ApiError | None:
    """
    Why this coupon cannot be used on this cart, or None. The one place the rules live.
    `new_customer` and `used` (this customer's redemptions of it) can be passed in when checking
    many coupons at once; they are looked up otherwise.
    """
    now = now or timezone.now()
    if not c.is_active or c.approval_status != ApprovalStatus.APPROVED:
        return _invalid("This coupon code is not valid")
    if now < c.valid_from:
        return _invalid("This coupon is not active yet", "COUPON_NOT_STARTED")
    if now > c.valid_until:
        return _invalid("This coupon has expired", "COUPON_EXPIRED")
    restaurants = _restaurant_ids(c)
    if restaurants and str(restaurant_id) not in restaurants:
        return _invalid("This coupon is not valid at this restaurant", "COUPON_NOT_APPLICABLE")
    if c.audience != Audience.ALL:
        new = is_new_customer(user_id) if new_customer is None else new_customer
        if c.audience == Audience.NEW and not new:
            return _invalid("This coupon is only for new customers", "COUPON_NEW_CUSTOMERS")
        if c.audience == Audience.EXISTING and new:
            return _invalid(
                "This coupon is for customers who have ordered before", "COUPON_EXISTING_CUSTOMERS"
            )
    if subtotal_paise < c.min_order_paise:
        more = js_round((c.min_order_paise - subtotal_paise) / 100)
        return _invalid(f"Add items worth ₹{more} more to use this coupon", "COUPON_MIN_ORDER")
    if coupon_base(c, lines) == 0:
        return _invalid(
            "This coupon does not apply to the dishes in your cart", "COUPON_NOT_APPLICABLE"
        )
    if c.usage_limit is not None and c.used_count >= c.usage_limit:
        return _invalid("This coupon has been fully redeemed", "COUPON_EXHAUSTED")
    if used is None:
        used = CouponRedemption.objects.filter(coupon=c, user_id=user_id).count()
    if used >= c.per_user_limit:
        return _invalid("You have already used this coupon", "COUPON_USED")
    return None


def assert_eligible(
    code: str,
    *,
    user_id: Any,
    restaurant_id: Any,
    subtotal_paise: int,
    lines: Iterable[Line] | None = None,
) -> Coupon:
    coupon = _with_scopes(Coupon.objects.filter(code=str(code).strip().upper())).first()
    if coupon is None:
        raise _invalid("This coupon code is not valid")
    error = problem(
        coupon,
        user_id=user_id,
        restaurant_id=restaurant_id,
        subtotal_paise=subtotal_paise,
        lines=lines,
    )
    if error:
        raise error
    return coupon


def offer_value(c: Coupon) -> int:
    """What the offer saves on a typical order, to rank offers against each other."""
    if c.discount_type == DiscountType.FREE_DELIVERY:
        return FREE_DELIVERY_VALUE_PAISE
    basket = max(c.min_order_paise, REFERENCE_ORDER_PAISE)
    return coupon_discount(c, basket)


# ---------------------------------------------------------------------------
# What customers see
# ---------------------------------------------------------------------------
def _restaurant_ref(r: Restaurant | None) -> dict[str, Any] | None:
    return {"id": str(r.pk), "name": r.name, "slug": r.slug} if r else None


def _scope_json(c: Coupon) -> dict[str, Any]:
    return {
        "restaurants": [_restaurant_ref(r) for r in c.restaurants.all()],
        "categories": [{"id": str(x.pk), "name": x.name} for x in c.categories.all()],
        "food_items": [{"id": str(x.pk), "name": x.name} for x in c.food_items.all()],
    }


def offer_json(c: Coupon) -> dict[str, Any]:
    """A coupon as customers see it (no usage counts or internal fields)."""
    return {
        "id": str(c.pk),
        "code": c.code,
        "name": c.name or None,
        "description": c.description or None,
        "terms": c.terms or None,
        "discount_type": c.discount_type,
        "discount_value": c.discount_value,
        "max_discount_paise": c.max_discount_paise,
        "min_order_paise": c.min_order_paise,
        "valid_until": c.valid_until,
        "audience": c.audience,
        "source": c.source,
        "banner_url": c.banner_url or None,
        "restaurant": _restaurant_ref(c.restaurant),
        **_scope_json(c),
    }


def _for_restaurant(restaurant_id: Any) -> Q:
    """Coupons usable at this restaurant: its own, ones listing it, and platform-wide ones."""
    return Q(restaurant_id=restaurant_id) | Q(restaurants=restaurant_id) | PLATFORM_WIDE


def _live(scope: Q) -> QuerySet[Coupon]:
    return _with_scopes(visible().filter(scope).distinct())


def _usable_by(user: User | None, coupons: Iterable[Coupon]) -> list[Coupon]:
    """Drops coupons this customer cannot use (wrong audience, or their uses are spent)."""
    coupons = list(coupons)
    if user is None:
        return coupons
    new = is_new_customer(user.pk)
    used = redemption_counts(user.pk, coupons)
    return [
        c
        for c in coupons
        if (c.audience == Audience.ALL or (c.audience == Audience.NEW) == new)
        and used.get(c.pk, 0) < c.per_user_limit
    ]


def usable_at(restaurant_id: Any = None) -> QuerySet[Coupon]:
    """Live coupons for an order from this restaurant (platform-wide only when none is given)."""
    scope = _for_restaurant(restaurant_id) if restaurant_id else PLATFORM_WIDE
    return _live(scope).order_by("valid_until")[:30]


def _best_first(user: User | None, coupons: Iterable[Coupon]) -> list[dict[str, Any]]:
    usable = sorted(_usable_by(user, coupons), key=offer_value, reverse=True)
    return [offer_json(c) for c in usable]


def list_available(restaurant_id: Any = None, user: User | None = None) -> list[dict[str, Any]]:
    """Checkout: platform-wide coupons, plus this restaurant's, that the customer can use."""
    return _best_first(user, usable_at(restaurant_id))


OFFER_KINDS = {
    "percent": Q(discount_type=DiscountType.PERCENT),
    "flat": Q(discount_type=DiscountType.FLAT),
    "free_delivery": Q(discount_type=DiscountType.FREE_DELIVERY),
    "first_order": Q(audience=Audience.NEW),
    "restaurant": Q(source=Source.RESTAURANT),
    "category": Q(categories__isnull=False) | Q(food_items__isnull=False),
}


def customer_offers(user: User | None, kind: str | None = None) -> list[dict[str, Any]]:
    """The Offers page: every offer the customer can use, best first, optionally of one kind."""
    return _best_first(user, _live(OFFER_KINDS.get(kind or "", Q()))[:100])


def restaurant_offers(restaurant: Restaurant) -> list[dict[str, Any]]:
    """A restaurant page's "Offers & deals": its own offers first, then platform-wide ones."""
    ordered = sorted(
        _live(_for_restaurant(restaurant.pk)),
        key=lambda c: (not _restaurant_ids(c), -offer_value(c)),
    )
    return [offer_json(c) for c in ordered]


def best_offers(restaurant_ids: Iterable[Any]) -> dict[str, dict[str, Any]]:
    """Restaurant cards: each restaurant's best own offer (most saved on a typical order)."""
    ids = [str(i) for i in restaurant_ids]
    if not ids:
        return {}
    coupons = (
        visible()
        .filter(Q(restaurant_id__in=ids) | Q(restaurants__in=ids))
        .distinct()
        .prefetch_related("restaurants")
    )
    by_restaurant: dict[str, list[Coupon]] = {}
    for c in coupons:
        for rid in _restaurant_ids(c) & set(ids):
            by_restaurant.setdefault(rid, []).append(c)
    result = {}
    for rid, offers in by_restaurant.items():
        best = max(offers, key=offer_value)
        result[rid] = {
            "code": best.code,
            "name": best.name or None,
            "discount_type": best.discount_type,
            "discount_value": best.discount_value,
            "max_discount_paise": best.max_discount_paise,
            "min_order_paise": best.min_order_paise,
            "audience": best.audience,
            "count": len(offers),
        }
    return result


# ---------------------------------------------------------------------------
# Management (admins and restaurant partners)
# ---------------------------------------------------------------------------
def status_of(c: Coupon, now: datetime | None = None) -> str:
    """One word for lists: draft, pending, rejected, paused, scheduled, expired or active."""
    now = now or timezone.now()
    if c.approval_status != ApprovalStatus.APPROVED:
        return str(c.approval_status)
    if not c.is_active:
        return "paused"
    if now < c.valid_from:
        return "scheduled"
    if now > c.valid_until or (c.usage_limit is not None and c.used_count >= c.usage_limit):
        return "expired"
    return "active"


def coupon_json(c: Coupon) -> dict[str, Any]:
    """A coupon or offer as admins and its restaurant see it."""
    data = {
        "id": str(c.pk),
        "code": c.code,
        "name": c.name or None,
        "terms": c.terms or None,
        "discount_type": c.discount_type,
        "discount_value": c.discount_value,
        "max_discount_paise": c.max_discount_paise,
        "min_order_paise": c.min_order_paise,
        "valid_from": c.valid_from,
        "valid_until": c.valid_until,
        "is_active": c.is_active,
        "usage_limit": c.usage_limit,
        "used_count": c.used_count,
        "per_user_limit": c.per_user_limit,
        "restaurant": _restaurant_ref(c.restaurant),
        "audience": c.audience,
        "source": c.source,
        "approval_status": c.approval_status,
        "rejection_reason": c.rejection_reason or None,
        "status": status_of(c),
        "banner_url": c.banner_url or None,
        "created_by": str(c.created_by_id) if c.created_by_id else None,
        "created_at": c.created_at,
        "updated_at": c.updated_at,
        **_scope_json(c),
    }
    if c.description:
        data["description"] = c.description
    return data


STATUS_FILTERS = {
    "active": lambda now: Q(
        approval_status=ApprovalStatus.APPROVED,
        is_active=True,
        valid_from__lte=now,
        valid_until__gte=now,
    ),
    "scheduled": lambda now: Q(approval_status=ApprovalStatus.APPROVED, valid_from__gt=now),
    "expired": lambda now: Q(valid_until__lt=now),
    "paused": lambda now: Q(approval_status=ApprovalStatus.APPROVED, is_active=False),
    "draft": lambda now: Q(approval_status=ApprovalStatus.DRAFT),
    "pending": lambda now: Q(approval_status=ApprovalStatus.PENDING),
    "rejected": lambda now: Q(approval_status=ApprovalStatus.REJECTED),
}
SORTS = {
    "newest": "-created_at",
    "oldest": "created_at",
    "expiring": "valid_until",
    "most_used": "-used_count",
    "code": "code",
}


def _list(qs: QuerySet[Coupon], query: dict[str, Any], page: Page) -> dict[str, Any]:
    now = timezone.now()
    if search := (query.get("search") or "").strip():
        qs = qs.filter(Q(code__icontains=search) | Q(name__icontains=search))
    if query.get("active") is not None:
        qs = qs.filter(is_active=query["active"])
    if status := query.get("status"):
        qs = qs.filter(STATUS_FILTERS[status](now))
    if owner := query.get("owner"):
        qs = qs.filter(source=owner)
    if query.get("from"):
        qs = qs.filter(valid_until__gte=query["from"])
    if query.get("to"):
        qs = qs.filter(valid_from__lte=query["to"])
    items, meta = paginate(
        _with_scopes(qs).order_by(SORTS.get(query.get("sort") or "", "-created_at")), page
    )
    return {"items": [coupon_json(c) for c in items], "pagination": meta}


def admin_list(query: dict[str, Any], page: Page) -> dict[str, Any]:
    return _list(Coupon.objects.all(), query, page)


def _summary(qs: QuerySet[Coupon]) -> dict[str, Any]:
    """Counts by status, redemptions and the discount given (aggregates only, no customers)."""
    now = timezone.now()
    counts = qs.aggregate(
        total=Count("id"),
        **{key: Count("id", filter=rule(now)) for key, rule in STATUS_FILTERS.items()},
    )
    redemptions = CouponRedemption.objects.filter(coupon__in=qs)
    used = redemptions.aggregate(n=Count("id"), s=Sum("discount_paise"))
    return {
        **counts,
        "redemptions": used["n"],
        "discount_given_paise": used["s"] or 0,
        "top": [
            {
                "id": str(row["coupon"]),
                "code": row["coupon__code"],
                "redemptions": row["n"],
                "discount_paise": row["d"] or 0,
            }
            for row in redemptions.values("coupon", "coupon__code")
            .annotate(n=Count("id"), d=Sum("discount_paise"))
            .order_by("-n")[:5]
        ],
    }


def admin_analytics() -> dict[str, Any]:
    return _summary(Coupon.objects.all())


def _check(coupon: Coupon) -> None:
    """Cross-field rules (422, not a database error); the same as the Node model's checks."""
    details = []
    if coupon.discount_type == DiscountType.FREE_DELIVERY:
        coupon.discount_value = 0
        coupon.max_discount_paise = None
    elif not coupon.discount_value or coupon.discount_value < 1:
        details.append(
            {"field": "discountValue", "message": "Discount must be a positive whole number"}
        )
    if coupon.discount_type == DiscountType.PERCENT and coupon.discount_value > 100:
        details.append(
            {"field": "discountValue", "message": "A percentage discount cannot exceed 100"}
        )
    if coupon.valid_from and coupon.valid_until and coupon.valid_until <= coupon.valid_from:
        details.append({"field": "validUntil", "message": "End date must be after the start date"})
    if details:
        raise _validation_error(*details)


def generate_code(prefix: str = "BB") -> str:
    """A fresh code nobody has, e.g. BB7K2QX9 (letters and digits that are hard to misread)."""
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    while True:
        code = prefix + "".join(secrets.choice(alphabet) for _ in range(6))
        if not Coupon.objects.filter(code=code).exists():
            return code


def _save(coupon: Coupon, scopes: dict[str, Any] | None = None) -> Coupon:
    _check(coupon)
    if not coupon.code:
        coupon.code = generate_code()
    if Coupon.objects.filter(code=coupon.code).exclude(pk=coupon.pk).exists():
        raise ApiError.conflict("A record with this code already exists")
    try:
        with transaction.atomic():
            coupon.save()
            for field, values in (scopes or {}).items():
                getattr(coupon, field).set(values)
    except IntegrityError:
        raise ApiError.conflict("A record with this code already exists") from None
    return _with_scopes(Coupon.objects.all()).get(pk=coupon.pk)


def _apply(coupon: Coupon, data: dict[str, Any]) -> dict[str, Any]:
    """Copies the plain fields; returns the many-to-many scopes to set after saving."""
    for field in FIELDS:
        if field not in data:
            continue
        if field == "restaurant":
            coupon.restaurant_id = data["restaurant"]
        elif field in ("description", "name", "terms", "banner_url"):
            setattr(coupon, field, data[field] or "")
        else:
            setattr(coupon, field, data[field])
    return {field: data[field] for field in SCOPES if field in data}


def create(data: dict[str, Any], by: User | None = None) -> Coupon:
    coupon = Coupon(source=Source.PLATFORM, approval_status=ApprovalStatus.APPROVED, created_by=by)
    return _save(coupon, _apply(coupon, data))


def _one(qs: QuerySet[Coupon], message: str) -> Coupon:
    coupon = _with_scopes(qs).first()
    if coupon is None:
        raise ApiError.not_found(message)
    return coupon


def _set_active(coupon: Coupon, active: bool) -> Coupon:
    coupon.is_active = active
    coupon.save(update_fields=["is_active", "updated_at"])
    return coupon


def admin_get(coupon_id: uuid.UUID) -> Coupon:
    return _one(Coupon.objects.filter(pk=coupon_id), "Coupon not found")


def update(coupon_id: uuid.UUID, data: dict[str, Any]) -> Coupon:
    coupon = admin_get(coupon_id)
    return _save(coupon, _apply(coupon, data))


def set_active(coupon_id: uuid.UUID, active: bool) -> Coupon:
    return _set_active(admin_get(coupon_id), active)


def duplicate(coupon_id: uuid.UUID, by: User | None = None) -> Coupon:
    """A switched-off copy with a new code, to edit and start later."""
    original = admin_get(coupon_id)
    copy = Coupon(
        **{f: getattr(original, f) for f in FIELDS if f != "restaurant"},
        restaurant_id=original.restaurant_id,
        source=original.source,
        approval_status=original.approval_status,
        created_by=by,
    )
    copy.code = generate_code(original.code[:20] + "-")
    copy.is_active = False
    return _save(copy, {f: list(getattr(original, f).all()) for f in SCOPES})


def remove(coupon_id: uuid.UUID) -> None:
    if CouponRedemption.objects.filter(coupon_id=coupon_id).exists():
        raise ApiError.conflict("This coupon has been used. Deactivate it instead.")
    deleted, _ = Coupon.objects.filter(pk=coupon_id).delete()
    if not deleted:
        raise ApiError.not_found("Coupon not found")


# --- the approval queue -------------------------------------------------------------------------
def pending(page: Page) -> dict[str, Any]:
    return _list(
        Coupon.objects.filter(source=Source.RESTAURANT, approval_status=ApprovalStatus.PENDING),
        {},
        page,
    )


def review(coupon_id: uuid.UUID, approve: bool, reason: str, by: User) -> Coupon:
    """Approves or rejects a restaurant offer waiting for review; the partner is told."""
    from apps.notifications.services import notify

    coupon = admin_get(coupon_id)
    if coupon.source != Source.RESTAURANT or coupon.approval_status != ApprovalStatus.PENDING:
        raise ApiError.conflict("This offer is not waiting for review")
    if not approve and not reason.strip():
        raise _validation_error({"field": "reason", "message": "Say why the offer is rejected"})
    coupon.approval_status = ApprovalStatus.APPROVED if approve else ApprovalStatus.REJECTED
    coupon.rejection_reason = "" if approve else reason.strip()
    coupon.reviewed_by, coupon.reviewed_at = by, timezone.now()
    coupon.save(
        update_fields=[
            "approval_status",
            "rejection_reason",
            "reviewed_by",
            "reviewed_at",
            "updated_at",
        ]
    )
    owner_id = coupon.restaurant.owner_id if coupon.restaurant else None
    if owner_id:
        notify(
            owner_id,
            type="offer.approved" if approve else "offer.rejected",
            title=f"Offer {coupon.code} {'approved' if approve else 'not approved'}",
            body="It is live for customers within its dates."
            if approve
            else f"Reason: {coupon.rejection_reason}",
            link="/restaurant/offers",
        )
    return coupon


# --- restaurant partners' own offers ------------------------------------------------------------
def _own_offers(restaurant: Restaurant) -> QuerySet[Coupon]:
    return Coupon.objects.filter(restaurant=restaurant, source=Source.RESTAURANT)


def _check_own_items(restaurant: Restaurant, data: dict[str, Any]) -> None:
    """Partners pick dishes from their own menu only, and cannot target other restaurants."""
    items = data.get("food_items") or []
    if items and FoodItem.objects.filter(pk__in=items).exclude(restaurant=restaurant).exists():
        raise _validation_error(
            {"field": "foodItems", "message": "Choose dishes from your own menu"}
        )
    data.pop("restaurants", None)
    data.pop("restaurant", None)


def _submit(coupon: Coupon, draft: bool) -> None:
    from apps.notifications.services import notify_admins
    from apps.rbac.roles import Permission

    if draft:
        coupon.approval_status = ApprovalStatus.DRAFT
        return
    if not settings.OFFER_APPROVAL_REQUIRED:
        coupon.approval_status = ApprovalStatus.APPROVED
        return
    coupon.approval_status = ApprovalStatus.PENDING
    coupon.rejection_reason = ""
    transaction.on_commit(
        lambda: notify_admins(
            Permission.CATALOG_MANAGE,
            type="offer.review",
            title=f"Offer to review: {coupon.code}",
            body=coupon.restaurant.name if coupon.restaurant else "",
            link="/admin/coupons/review",
        )
    )


def _save_own(restaurant: Restaurant, coupon: Coupon, data: dict[str, Any]) -> Coupon:
    draft = bool(data.pop("draft", False))
    _check_own_items(restaurant, data)
    scopes = _apply(coupon, data)
    _submit(coupon, draft)
    return _save(coupon, scopes)


def own_list(restaurant: Restaurant, query: dict[str, Any], page: Page) -> dict[str, Any]:
    return _list(_own_offers(restaurant), query, page)


def own_get(restaurant: Restaurant, offer_id: uuid.UUID) -> Coupon:
    return _one(_own_offers(restaurant).filter(pk=offer_id), "Offer not found")


def own_create(restaurant: Restaurant, data: dict[str, Any], by: User) -> Coupon:
    coupon = Coupon(source=Source.RESTAURANT, restaurant=restaurant, created_by=by)
    return _save_own(restaurant, coupon, data)


def own_update(restaurant: Restaurant, offer_id: uuid.UUID, data: dict[str, Any]) -> Coupon:
    """Any change to an offer sends it for review again (when approval is on)."""
    return _save_own(restaurant, own_get(restaurant, offer_id), data)


def own_set_active(restaurant: Restaurant, offer_id: uuid.UUID, active: bool) -> Coupon:
    """Pause or resume. Resuming never skips review: only approved offers reach customers."""
    return _set_active(own_get(restaurant, offer_id), active)


def own_remove(restaurant: Restaurant, offer_id: uuid.UUID) -> None:
    remove(own_get(restaurant, offer_id).pk)


def own_analytics(restaurant: Restaurant) -> dict[str, Any]:
    return _summary(_own_offers(restaurant))
