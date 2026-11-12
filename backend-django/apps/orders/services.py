"""
Placing orders and what each role may do with them (Node: services/order.service.js and
services/order-management.service.js). Status changes always go through `workflow.transition`.
"""

import logging
import secrets
import uuid
from typing import Any

from django.db import IntegrityError, transaction
from django.db.models import Count, F, Q
from django.utils import timezone

from apps.accounts.models import User
from apps.cart import services as cart_services
from apps.cart.models import Cart
from apps.coupons.models import Coupon, CouponRedemption
from apps.coupons.services import assert_eligible
from apps.customers.services import get_own
from apps.menus.models import FoodItem
from apps.payments.models import Payment, Provider
from apps.restaurants.models import Restaurant
from apps.restaurants.presenters import geo_json
from apps.reviews.models import Review, ReviewStatus, ReviewTarget
from common.api import ApiError
from common.pagination import Page, paginate

from . import presenters
from .models import (
    ACTIVE_STATUSES,
    FINAL_STATUSES,
    Order,
    OrderItem,
    OrderStatus,
    OrderStatusHistory,
    PaymentMethod,
    PaymentStatus,
)
from .notifications import notify_new_order
from .workflow import Actor, release_rider, transition

logger = logging.getLogger("bitebox.orders")

S = OrderStatus
CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # no 0/O or 1/I


def _conflict(message: str, code: str, details: list[dict[str, str]] | None = None) -> ApiError:
    return ApiError(409, message, code=code, details=details)


def order_number(now: Any = None) -> str:
    """`BB-YYMMDD-XXXXXX` (Node: utils/codes.js#randomCode)."""
    now = now or timezone.now()
    suffix = "".join(secrets.choice(CODE_ALPHABET) for _ in range(6))
    return f"BB-{now:%y%m%d}-{suffix}"


def provider_for(method: str) -> str:
    """
    Cash on delivery only for now: the online providers (Razorpay, the simulated one) arrive with
    the payments phase, and until then online payment answers like Node without a provider.
    """
    if method == PaymentMethod.COD:
        return Provider.CASH_ON_DELIVERY
    raise ApiError.bad_request("Online payment is not available right now")


# ---------------------------------------------------------------------------
# Customer
# ---------------------------------------------------------------------------
def place_order(
    user: User, data: dict[str, Any], idempotency_key: str | None
) -> tuple[Order, bool]:
    """Returns (order, created). The same Idempotency-Key returns the first order."""
    if idempotency_key:
        existing = Order.objects.filter(customer=user, idempotency_key=idempotency_key).first()
        if existing:
            return presenters.reload(existing), False
    method = data["payment_method"]
    provider = provider_for(method)

    address = get_own(user, data["address_id"])
    quote = cart_services.build_quote(user, data["address_id"])
    if quote["cart"] is None:
        raise ApiError.bad_request("Your cart is empty")
    if quote["coupon_error"]:
        error = quote["coupon_error"]
        raise _conflict(
            f"Coupon {error['code']} can no longer be applied: {error['message']}",
            "COUPON_INVALID",
        )
    if not quote["can_checkout"]:
        issues = quote["issues"]
        raise _conflict(
            issues[0]["message"] if issues else "This order cannot be placed",
            "CHECKOUT_BLOCKED",
            [{"field": i["code"], "message": i["message"]} for i in issues],
        )
    pricing = quote["pricing"]
    expected = data.get("expected_total_paise")
    if expected is not None and expected != pricing["total_paise"]:
        raise _conflict(
            "Prices changed since you last looked. Please review your order.", "PRICE_CHANGED"
        )
    coins = quote["coins"] or {}
    if coins.get("applied"):
        if method not in coins.get("payment_methods", []):
            raise _conflict(
                "Coins can't be used with this payment method. "
                "Remove the coins or pay another way.",
                "COINS_NOT_ALLOWED",
            )
        # The coin wallet (reserve/commit) is ported with the rewards phase; never discount
        # coins that cannot be held.
        raise _conflict(
            "Coins can't be used right now. Remove them to continue.", "COINS_NOT_ALLOWED"
        )

    cart = quote["cart"]
    restaurant = Restaurant.objects.get(pk=cart["restaurant"]["id"])
    food_ids = [line["food_item_id"] for line in cart["items"]]
    if FoodItem.objects.filter(pk__in=food_ids).count() != len(food_ids):
        raise _conflict("Some dishes are no longer available", "CHECKOUT_BLOCKED")

    now = timezone.now()
    snapshot = {
        "name": restaurant.name,
        "slug": restaurant.slug,
        "phone": restaurant.phone,
        "address": ", ".join(p for p in (restaurant.line1, restaurant.area, restaurant.city) if p),
        "location": geo_json(restaurant.location),
    }
    delivery_address = {
        "label": address.label,
        "recipient_name": address.recipient_name,
        "phone": address.phone,
        "line1": address.line1,
        **{k: v for k in ("line2", "area", "landmark") if (v := getattr(address, k))},
        "city": address.city,
        "state": address.state,
        "postal_code": address.postal_code,
        "location": geo_json(address.location),
    }

    try:
        with transaction.atomic():
            order = _commit_order(
                user=user,
                quote=quote,
                method=method,
                provider=provider,
                fields={
                    "order_number": order_number(now),
                    "customer": user,
                    "restaurant": restaurant,
                    "restaurant_snapshot": snapshot,
                    "delivery_address": delivery_address,
                    "delivery_location": address.location,
                    "subtotal_paise": pricing["subtotal_paise"],
                    "discount_paise": pricing["discount_paise"],
                    "delivery_fee_paise": pricing["delivery_fee_paise"],
                    "platform_fee_paise": pricing["platform_fee_paise"],
                    "tax_paise": pricing["tax_paise"],
                    "coin_discount_paise": pricing["coin_discount_paise"],
                    "total_paise": pricing["total_paise"],
                    "coupon_code": quote["coupon"]["code"] if quote["coupon"] else "",
                    "distance_m": quote["delivery"]["distance_meters"],
                    "note": data.get("note") or "",
                    "status": S.PENDING,
                    "status_changed_at": now,
                    "payment_method": method,
                    "payment_status": PaymentStatus.PENDING,
                    # Cash orders reach the restaurant now; online ones once paid.
                    "submitted_at": now if method == PaymentMethod.COD else None,
                    "idempotency_key": idempotency_key or None,
                },
            )
    except IntegrityError:
        # A concurrent retry with the same Idempotency-Key won the race: return its order.
        if idempotency_key:
            existing = Order.objects.filter(customer=user, idempotency_key=idempotency_key).first()
            if existing:
                return presenters.reload(existing), False
        raise

    logger.info(
        "Order placed", extra={"order_id": str(order.pk), "order_number": order.order_number}
    )
    order = presenters.reload(order)
    if order.submitted_at:
        notify_new_order(order, "cash on delivery")
    return order, True


def _commit_order(
    *, user: User, quote: dict[str, Any], method: str, provider: str, fields: dict[str, Any]
) -> Order:
    cart = quote["cart"]
    # 1. Claim the cart. If it changed after it was priced (another tab or checkout), stop.
    claimed = Cart.objects.select_for_update().filter(pk=cart["id"], user=user).first()
    if claimed is None or int(claimed.updated_at.timestamp() * 1000) != cart["version"]:
        raise _conflict("Your cart changed. Please review it and try again.", "CART_CHANGED")
    claimed.delete()

    # 2. Reserve a coupon use atomically (respecting the usage limit); re-check per-user use.
    coupon: Coupon | None = None
    if quote["coupon"]:
        coupon = assert_eligible(
            quote["coupon"]["code"],
            user_id=user.pk,
            restaurant_id=cart["restaurant"]["id"],
            subtotal_paise=quote["pricing"]["subtotal_paise"],
        )
        reserved = (
            Coupon.objects.filter(pk=coupon.pk, is_active=True)
            .filter(Q(usage_limit__isnull=True) | Q(used_count__lt=F("usage_limit")))
            .update(used_count=F("used_count") + 1)
        )
        if not reserved:
            raise _conflict("This coupon has just been fully redeemed", "COUPON_EXHAUSTED")

    # 3. The order, its lines, its first history entry and its payment record.
    order = Order.objects.create(**fields)
    OrderItem.objects.bulk_create(
        [
            OrderItem(
                order=order,
                food_item_id=uuid.UUID(line["food_item_id"]),
                name=line["name"],
                is_veg=line["is_veg"],
                unit_price_paise=line["unit_price_paise"],
                quantity=line["quantity"],
                line_total_paise=line["line_total_paise"],
            )
            for line in cart["items"]
        ]
    )
    OrderStatusHistory.objects.create(
        order=order, from_status=None, to_status=S.PENDING, actor_role=Actor.CUSTOMER, actor=user
    )
    Payment.objects.create(
        order=order,
        user=user,
        method=method,
        provider=provider,
        amount_paise=order.total_paise,
        status=PaymentStatus.PENDING,
    )
    if coupon is not None:
        CouponRedemption.objects.create(
            coupon=coupon, user=user, order=order, discount_paise=order.discount_paise
        )
    return order


def list_mine(user: User, page: Page) -> dict[str, Any]:
    # Checkout attempts abandoned at the payment page never became orders for the customer.
    qs = (
        Order.objects.filter(customer=user)
        .exclude(payment_method=PaymentMethod.ONLINE, submitted_at__isnull=True, status=S.CANCELLED)
        .prefetch_related("items")
        .order_by("-created_at")
    )
    items, meta = paginate(qs, page)
    ratings = dict(
        Review.objects.filter(
            customer=user, target=ReviewTarget.RESTAURANT, order__in=[o.pk for o in items]
        )
        .exclude(status=ReviewStatus.DELETED)
        .values_list("order_id", "rating")
    )
    rows = []
    for o in items:
        row = presenters.list_json(o)
        row.pop("delivery_partner", None)
        row.pop("updated_at", None)
        row["my_rating"] = ratings.get(o.pk)
        rows.append(row)
    return {"items": rows, "pagination": meta}


def customer_get(user: User, order_id: uuid.UUID) -> dict[str, Any]:
    order = presenters.load(order_id, customer=user)
    if order is None:
        raise ApiError.not_found("Order not found")
    return presenters.present_with_rider(order)


def customer_cancel(user: User, order_id: uuid.UUID, reason: str | None) -> dict[str, Any]:
    """Customers may cancel only while the restaurant has not accepted yet."""
    result = transition(
        order_id,
        to=S.CANCELLED,
        actor=Actor.CUSTOMER,
        user=user,
        scope=Q(customer=user),
        reason=reason or "Cancelled by customer",
    )
    return presenters.present_with_rider(result.order)


# ---------------------------------------------------------------------------
# Restaurant
# ---------------------------------------------------------------------------
def _own_restaurant_id(owner: User) -> uuid.UUID:
    restaurant_id = Restaurant.objects.filter(owner=owner).values_list("pk", flat=True).first()
    if restaurant_id is None:
        raise ApiError.not_found("Create your restaurant first")
    return restaurant_id


def restaurant_list(owner: User, query: dict[str, Any], page: Page) -> dict[str, Any]:
    restaurant_id = _own_restaurant_id(owner)
    view = query.get("view") or "active"
    statuses = FINAL_STATUSES if view == "history" else ACTIVE_STATUSES
    status = query.get("status")
    base = Order.objects.filter(restaurant_id=restaurant_id, submitted_at__isnull=False)
    qs = presenters.with_details(
        base.filter(status=status) if status in statuses else base.filter(status__in=statuses)
    )
    if view == "active":
        items = list(qs.order_by("created_at")[:200])
        counts = (
            base.filter(status__in=ACTIVE_STATUSES)
            .values("status")
            .annotate(n=Count("pk"))
            .order_by()
        )
        return {
            "items": [presenters.present_for_restaurant(o) for o in items],
            "counts": {c["status"]: c["n"] for c in counts},
        }
    rows, meta = paginate(qs.order_by("-created_at"), page)
    return {"items": [presenters.present_for_restaurant(o) for o in rows], "pagination": meta}


def restaurant_get(owner: User, order_id: uuid.UUID) -> dict[str, Any]:
    restaurant_id = _own_restaurant_id(owner)
    order = presenters.load(order_id, restaurant_id=restaurant_id, submitted_at__isnull=False)
    if order is None:
        raise ApiError.not_found("Order not found")
    return presenters.present_for_restaurant(order)


def restaurant_set_status(
    owner: User, order_id: uuid.UUID, status: str, reason: str | None
) -> dict[str, Any]:
    """Accept, reject, start preparing, mark ready. "Ready" immediately looks for a rider."""
    from apps.dispatch.services import dispatch_safely

    restaurant_id = _own_restaurant_id(owner)
    if status == S.REJECTED and not reason:
        raise ApiError.bad_request("Tell the customer why the order is rejected")
    result = transition(
        order_id,
        to=status,
        actor=Actor.RESTAURANT,
        user=owner,
        scope=Q(restaurant_id=restaurant_id, submitted_at__isnull=False),
        reason=reason if status == S.REJECTED else None,
    )
    order = result.order
    if result.changed and status == S.READY_FOR_PICKUP and dispatch_safely(order.pk):
        order = presenters.reload(order)
    return presenters.present_for_restaurant(order)


# ---------------------------------------------------------------------------
# Rider
# ---------------------------------------------------------------------------
RIDER_STATUSES = (S.PICKED_UP, S.ON_THE_WAY, S.DELIVERED)


def rider_set_status(user: User, order_id: uuid.UUID, status: str) -> dict[str, Any]:
    """Picked up → on the way → delivered, only on the rider's own order."""
    if status not in RIDER_STATUSES:
        raise ApiError.bad_request("Unknown delivery status")
    result = transition(
        order_id, to=status, actor=Actor.DELIVERY, user=user, scope=Q(delivery_partner=user)
    )
    return presenters.present_for_rider(result.order, user.pk)


def rider_history(user: User, page: Page) -> dict[str, Any]:
    qs = presenters.with_details(
        Order.objects.filter(delivery_partner=user, status__in=[S.DELIVERED, S.CANCELLED])
    ).order_by("-updated_at")
    rows, meta = paginate(qs, page)
    return {"items": [presenters.present_for_rider(o, user.pk) for o in rows], "pagination": meta}


# ---------------------------------------------------------------------------
# Admin
# ---------------------------------------------------------------------------
def admin_list(query: dict[str, Any], page: Page) -> dict[str, Any]:
    """All orders, filterable by status (or "active") and searchable by order number."""
    qs = Order.objects.all()
    status = query.get("status")
    if status == "active":
        qs = qs.filter(status__in=ACTIVE_STATUSES)
    elif status:
        qs = qs.filter(status=status)
    if search := (query.get("search") or "").strip():
        qs = qs.filter(order_number__icontains=search.upper())
    rows, meta = paginate(qs.prefetch_related("items").order_by("-created_at"), page)
    counts = Order.objects.values("status").annotate(n=Count("pk")).order_by()
    return {
        "items": [presenters.list_json(o) for o in rows],
        "pagination": meta,
        "counts": {c["status"]: c["n"] for c in counts},
    }


def admin_get(order_id: uuid.UUID) -> dict[str, Any]:
    order = presenters.load(order_id)
    if order is None:
        raise ApiError.not_found("Order not found")
    data = presenters.present_with_rider(order)
    offer = presenters.open_offer(order)
    data["offer"] = (
        {"rider": presenters.rider_card(offer.rider_id), "expires_at": offer.expires_at}
        if offer
        else None
    )
    return data


def admin_cancel(admin: User, order_id: uuid.UUID, reason: str) -> dict[str, Any]:
    result = transition(order_id, to=S.CANCELLED, actor=Actor.ADMIN, user=admin, reason=reason)
    return admin_get(result.order.pk)


def admin_unassign(admin: User, order_id: uuid.UUID, reason: str | None) -> dict[str, Any]:
    """
    Takes an accepted order back from its rider (e.g. they cannot reach the restaurant) and
    re-dispatches it. That rider's assignment is cancelled, so the order is not offered to them
    again.
    """
    from apps.dispatch.models import AssignmentStatus, DeliveryAssignment
    from apps.dispatch.services import dispatch_safely

    def take_back(order: Order) -> None:
        DeliveryAssignment.objects.filter(order=order, status=AssignmentStatus.ACCEPTED).update(
            status=AssignmentStatus.CANCELLED, responded_at=timezone.now()
        )
        release_rider(order)

    result = transition(
        order_id,
        to=S.READY_FOR_PICKUP,
        actor=Actor.ADMIN,
        user=admin,
        update={"delivery_partner": None},
        note=reason or "Rider unassigned by admin",
        on_change=take_back,
    )
    if result.changed:
        dispatch_safely(result.order.pk)
    return admin_get(result.order.pk)


def restaurant_stats(owner: User) -> dict[str, Any]:
    """
    The partner dashboard's figures. Only orders the restaurant has received count (online
    orders appear once paid). Sales are the food value after the coupon on delivered orders;
    "today" is the current day in settings.REPORT_TIMEZONE.
    """
    from zoneinfo import ZoneInfo

    from django.conf import settings
    from django.db.models import ExpressionWrapper, IntegerField, Sum

    restaurant = Restaurant.objects.filter(owner=owner).first()
    if restaurant is None:
        raise ApiError.not_found("Create your restaurant first")
    received = Order.objects.filter(restaurant=restaurant, submitted_at__isnull=False)
    tz = ZoneInfo(settings.REPORT_TIMEZONE)
    start_of_today = (
        timezone.now().astimezone(tz).replace(hour=0, minute=0, second=0, microsecond=0)
    )
    counts = dict(received.values("status").annotate(n=Count("pk")).values_list("status", "n"))
    delivered = received.filter(status=S.DELIVERED)
    sales = (
        delivered.aggregate(
            total=Sum(
                ExpressionWrapper(
                    F("subtotal_paise") - F("discount_paise"), output_field=IntegerField()
                )
            )
        )["total"]
        or 0
    )
    completed = counts.get(S.DELIVERED, 0)
    return {
        "total_orders": sum(counts.values()),
        "today_orders": received.filter(submitted_at__gte=start_of_today).count(),
        "pending_orders": sum(counts.get(s, 0) for s in ACTIVE_STATUSES),
        "completed_orders": completed,
        "cancelled_orders": counts.get(S.CANCELLED, 0) + counts.get(S.REJECTED, 0),
        "sales_paise": sales,
        "average_order_paise": round(sales / completed) if completed else 0,
        "rating": {"average": float(restaurant.rating_average), "count": restaurant.rating_count},
    }
