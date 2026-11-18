"""
Placing orders and what each role may do with them (Node: services/order.service.js and
services/order-management.service.js). Status changes always go through `workflow.transition`.
"""

import functools
import logging
import secrets
import uuid
from datetime import timedelta
from typing import Any
from zoneinfo import ZoneInfo

from django.conf import settings
from django.db import IntegrityError, transaction
from django.db.models import Count, ExpressionWrapper, F, IntegerField, Q, QuerySet, Sum
from django.utils import timezone

from apps.accounts.models import User, UserStatus
from apps.cart import services as cart_services
from apps.cart.models import Cart
from apps.coins import events as reward_events
from apps.coins import orders as coin_hooks
from apps.coupons.models import Coupon, CouponRedemption
from apps.coupons.services import assert_eligible
from apps.customers.services import get_own
from apps.delivery.models import DeliveryPartner
from apps.dispatch.models import AssignmentStatus, DeliveryAssignment
from apps.menus.models import FoodItem
from apps.payments.models import Payment
from apps.rbac.roles import Role
from apps.restaurants.models import Restaurant
from apps.restaurants.presenters import geo_json
from apps.reviews.models import Review, ReviewStatus, ReviewTarget
from common.api import ApiError
from common.filters import Facet, apply_facets, days_between, text_search, with_facets
from common.geo import haversine_m
from common.pagination import Page, paginate

from . import presenters
from .models import (
    ACTIVE_STATUSES,
    FINAL_STATUSES,
    CoinState,
    Order,
    OrderItem,
    OrderStatus,
    OrderStatusHistory,
    PaymentMethod,
    PaymentStatus,
)
from .notifications import notify_new_delivery_otp, notify_new_order
from .workflow import Actor, new_delivery_otp, release_rider, transition

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


def _by_idempotency_key(user: User, key: str | None) -> Order | None:
    """The order an earlier request with this Idempotency-Key placed, ready to present."""
    existing = Order.objects.filter(customer=user, idempotency_key=key).first() if key else None
    return presenters.reload(existing) if existing else None


def _load(order_id: uuid.UUID, **scope: Any) -> Order:
    order = presenters.load(order_id, **scope)
    if order is None:
        raise ApiError.not_found("Order not found")
    return order


def _own_restaurant(owner: User) -> Restaurant:
    restaurant = Restaurant.objects.filter(owner=owner).first()
    if restaurant is None:
        raise ApiError.not_found("Create your restaurant first")
    return restaurant


# ---------------------------------------------------------------------------
# Customer
# ---------------------------------------------------------------------------
# What an order keeps of each discount (the quote's lines, minus display-only fields).
SNAPSHOT_KEYS = (
    "kind",
    "code",
    "name",
    "discount_type",
    "discount_value",
    "food_paise",
    "delivery_paise",
    "funded_by",
)


def place_order(
    user: User, data: dict[str, Any], idempotency_key: str | None
) -> tuple[Order, bool]:
    """Returns (order, created). The same Idempotency-Key returns the first order."""
    from apps.payments.services import provider_for

    if existing := _by_idempotency_key(user, idempotency_key):
        return existing, False
    method = data["payment_method"]
    provider = provider_for(method)
    # The online channel decides the payment offer; cash orders have none.
    channel = data.get("payment_channel") if method == PaymentMethod.ONLINE else None

    address = get_own(user, data["address_id"])
    quote = cart_services.build_quote(user, data["address_id"], channel)
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
    if coins.get("applied") and method not in coins.get("payment_methods", []):
        raise _conflict(
            "Coins can't be used with this payment method. Remove the coins or pay another way.",
            "COINS_NOT_ALLOWED",
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
                    "delivery_discount_paise": pricing["delivery_discount_paise"],
                    "coins_redeemed": coins.get("applied") or 0,
                    # Cash orders spend the coins now; online orders hold them until paid.
                    "coins_state": (
                        None
                        if not coins.get("applied")
                        else CoinState.COMMITTED
                        if method == PaymentMethod.COD
                        else CoinState.RESERVED
                    ),
                    "total_paise": pricing["total_paise"],
                    "coupon_code": quote["coupon"]["code"] if quote["coupon"] else "",
                    "payment_channel": channel or "",
                    "restaurant_discount_paise": sum(
                        d["food_paise"]
                        for d in quote["discounts"]
                        if d["funded_by"] == "restaurant"
                    ),
                    "discounts": [{k: d[k] for k in SNAPSHOT_KEYS} for d in quote["discounts"]],
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
        if existing := _by_idempotency_key(user, idempotency_key):
            return existing, False
        raise

    logger.info(
        "Order placed", extra={"order_id": str(order.pk), "order_number": order.order_number}
    )
    reward_events.order_placed(order)
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

    # 2. Reserve one use of every discount atomically (respecting usage limits); the coupon
    # code's per-user use is checked again.
    if quote["coupon"]:
        assert_eligible(
            quote["coupon"]["code"],
            user_id=user.pk,
            restaurant_id=cart["restaurant"]["id"],
            subtotal_paise=quote["pricing"]["subtotal_paise"],
        )
    discounts = quote["discounts"]
    ids = dict(
        Coupon.objects.filter(code__in=[d["code"] for d in discounts]).values_list("code", "pk")
    )
    for d in discounts:
        reserved = d["code"] in ids and (
            Coupon.objects.filter(pk=ids[d["code"]], is_active=True)
            .filter(Q(usage_limit__isnull=True) | Q(used_count__lt=F("usage_limit")))
            .update(used_count=F("used_count") + 1)
        )
        if not reserved:
            raise _conflict(
                f"{d['name'] or d['code']} has just run out. Please review your order.",
                "COUPON_EXHAUSTED",
            )

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
    # One redemption per discount: what it saved, including any delivery fee it waived.
    CouponRedemption.objects.bulk_create(
        [
            CouponRedemption(
                coupon_id=ids[d["code"]], user=user, order=order, discount_paise=d["saving_paise"]
            )
            for d in discounts
        ]
    )

    # 4. Hold the redeemed coins (cash orders spend them straight away); a short balance stops
    # the whole order.
    coin_hooks.reserve_for_order(order, cash=method == PaymentMethod.COD)
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
    return presenters.present_with_rider(_load(order_id, customer=user), for_customer=True)


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
    return presenters.present_with_rider(result.order, for_customer=True)


# ---------------------------------------------------------------------------
# Restaurant
# ---------------------------------------------------------------------------
# The restaurant's order history (view=history): its Filters panel.
# Node: order-management.service.js#HISTORY_FACETS.
HISTORY_FACETS = (
    Facet("status", values=FINAL_STATUSES),
    Facet("payment_method", values=PaymentMethod.values),
)


def _in_view(query: dict[str, Any], statuses: tuple[str, ...]) -> dict[str, Any]:
    """`status` narrowed to the view's statuses (others are ignored, as a single status was)."""
    wanted = [s for s in query.get("status") or () if s in statuses]
    return {**query, "status": wanted or None}


def _restaurant_history(restaurant: Restaurant, query: dict[str, Any]) -> QuerySet[Order]:
    """The restaurant's finished orders matching every filter: status, payment method, the day
    placed and a search over the order number and the recipient's name (what the restaurant
    sees of the customer)."""
    qs = Order.objects.filter(
        restaurant=restaurant, submitted_at__isnull=False, status__in=FINAL_STATUSES
    )
    return apply_facets(qs, query, HISTORY_FACETS).filter(
        days_between(query, "placed"),
        text_search(query.get("search"), "order_number", "delivery_address__recipient_name"),
    )


def restaurant_list(owner: User, query: dict[str, Any], page: Page) -> dict[str, Any]:
    """
    view=active: the orders in progress (at most 200, oldest first) with counts per status.
    view=history: the finished ones, newest first, paged, filterable (HISTORY_FACETS, placed days,
    search); `?facets=1` adds the Filters panel's counts, all within the partner's restaurant.
    """
    restaurant = _own_restaurant(owner)
    view = query.get("view") or "active"
    statuses = FINAL_STATUSES if view == "history" else ACTIVE_STATUSES
    query = _in_view(query, statuses)
    if view == "history":
        build = functools.partial(_restaurant_history, restaurant)
        rows, meta = paginate(presenters.with_details(build(query)).order_by("-created_at"), page)
        result = {"items": [presenters.present_for_restaurant(o) for o in rows], "pagination": meta}
        return with_facets(result, query, build, HISTORY_FACETS)
    base = Order.objects.filter(restaurant=restaurant, submitted_at__isnull=False)
    wanted = query.get("status") or statuses
    items = list(
        presenters.with_details(base.filter(status__in=wanted)).order_by("created_at")[:200]
    )
    counts = (
        base.filter(status__in=ACTIVE_STATUSES).values("status").annotate(n=Count("pk")).order_by()
    )
    return {
        "items": [presenters.present_for_restaurant(o) for o in items],
        "counts": {c["status"]: c["n"] for c in counts},
    }


def restaurant_get(owner: User, order_id: uuid.UUID) -> dict[str, Any]:
    restaurant = _own_restaurant(owner)
    order = _load(order_id, restaurant_id=restaurant.pk, submitted_at__isnull=False)
    return presenters.present_for_restaurant(order)


def restaurant_set_status(
    owner: User,
    order_id: uuid.UUID,
    status: str,
    reason: str | None,
    prep_minutes: int | None = None,
) -> dict[str, Any]:
    """
    Accept (with a preparation time; the restaurant's usual one when not given), reject, start
    preparing, mark ready. "Ready" immediately looks for a rider.
    """
    from apps.dispatch.services import dispatch_safely

    restaurant = _own_restaurant(owner)
    if status == S.REJECTED and not reason:
        raise ApiError.bad_request("Tell the customer why the order is rejected")
    update: dict[str, Any] = {}
    if status == S.CONFIRMED:
        minutes = prep_minutes or restaurant.avg_prep_time_minutes
        update = {"prep_minutes": minutes, "ready_by": timezone.now() + timedelta(minutes=minutes)}
    result = transition(
        order_id,
        to=status,
        actor=Actor.RESTAURANT,
        user=owner,
        scope=Q(restaurant_id=restaurant.pk, submitted_at__isnull=False),
        reason=reason if status == S.REJECTED else None,
        update=update,
    )
    order = result.order
    if result.changed and status == S.READY_FOR_PICKUP and dispatch_safely(order.pk):
        order = presenters.reload(order)
    return presenters.present_for_restaurant(order)


# ---------------------------------------------------------------------------
# Rider
# ---------------------------------------------------------------------------
RIDER_STATUSES = (S.ARRIVED_AT_RESTAURANT, S.PICKED_UP, S.ON_THE_WAY, S.DELIVERED)


def _check_delivery_otp(user: User, order_id: uuid.UUID, otp: str | None) -> None:
    """
    "Delivered" needs the code the customer got at pickup. Wrong tries are counted (in their own
    committed transaction, so they stick) and capped; then only support can complete the order.
    """
    order = (
        Order.objects.filter(pk=order_id, delivery_partner=user)
        .values("status", "delivery_otp", "delivery_otp_attempts")
        .first()
    )
    if order is None:
        raise ApiError.not_found("Order not found")
    if order["status"] == S.DELIVERED or not order["delivery_otp"]:
        return  # a repeat (no-op), or picked up before codes existed
    if order["delivery_otp_attempts"] >= settings.DELIVERY_OTP_MAX_ATTEMPTS:
        raise _conflict(
            "Too many wrong codes. Contact BiteBox support to complete this delivery.", "OTP_LOCKED"
        )
    if otp and secrets.compare_digest(otp, order["delivery_otp"]):
        return
    with transaction.atomic():
        Order.objects.filter(pk=order_id).update(
            delivery_otp_attempts=F("delivery_otp_attempts") + 1
        )
    left = settings.DELIVERY_OTP_MAX_ATTEMPTS - order["delivery_otp_attempts"] - 1
    raise ApiError(
        422,
        "Validation failed",
        code="VALIDATION_ERROR",
        details=[
            {
                "field": "otp",
                "message": "Ask the customer for their delivery code"
                if not otp
                else f"That code is not right. {left} {'try' if left == 1 else 'tries'} left.",
            }
        ],
    )


def rider_set_status(
    user: User, order_id: uuid.UUID, status: str, otp: str | None = None
) -> dict[str, Any]:
    """Arrived → picked up → on the way → delivered (with the customer's code), own orders only."""
    if status not in RIDER_STATUSES:
        raise ApiError.bad_request("Unknown delivery status")
    if status == S.DELIVERED:
        _check_delivery_otp(user, order_id, otp)
    update = (
        {"arrival_distance_m": _distance_to_restaurant(user, order_id)}
        if status == S.ARRIVED_AT_RESTAURANT
        else None
    )
    result = transition(
        order_id,
        to=status,
        actor=Actor.DELIVERY,
        user=user,
        scope=Q(delivery_partner=user),
        update=update,
    )
    return presenters.present_for_rider(result.order, user.pk)


def _distance_to_restaurant(user: User, order_id: uuid.UUID) -> int | None:
    """Straight-line metres from the rider's last fix to the restaurant (None if unknown)."""
    fix = DeliveryPartner.objects.filter(user=user).values_list("location", flat=True).first()
    snapshot = (
        Order.objects.filter(pk=order_id).values_list("restaurant_snapshot", flat=True).first()
    )
    restaurant = presenters.restaurant_point(snapshot)
    if fix is None or restaurant is None:
        return None
    return haversine_m(fix, restaurant)


# The rider's delivery history: its Filters panel (Node: order-management.service.js#RIDER_FACETS).
RIDER_HISTORY_STATUSES = (S.DELIVERED, S.CANCELLED)
RIDER_FACETS = (
    Facet("status", values=RIDER_HISTORY_STATUSES),
    Facet("restaurant", label="restaurant__name"),  # the restaurants they delivered for
)


def _rider_history(user: User, query: dict[str, Any]) -> QuerySet[Order]:
    """The rider's delivered and cancelled orders matching RIDER_FACETS, the day placed and a
    search over the order number."""
    qs = Order.objects.filter(delivery_partner=user, status__in=RIDER_HISTORY_STATUSES)
    return apply_facets(qs, query, RIDER_FACETS).filter(
        days_between(query, "placed"), text_search(query.get("search"), "order_number")
    )


def rider_history(user: User, page: Page, query: dict[str, Any]) -> dict[str, Any]:
    """Newest first; `?facets=1` adds the Filters panel's counts (only this rider's orders)."""
    build = functools.partial(_rider_history, user)
    rows, meta = paginate(presenters.with_details(build(query)).order_by("-updated_at"), page)
    result = {"items": [presenters.present_for_rider(o, user.pk) for o in rows], "pagination": meta}
    return with_facets(result, query, build, RIDER_FACETS)


# ---------------------------------------------------------------------------
# Admin
# ---------------------------------------------------------------------------
def _statuses(values: list[str]) -> Q:
    """The statuses asked for; "active" stands for every in-progress status."""
    wanted = {s for s in values if s != "active"}
    if "active" in values:
        wanted.update(ACTIVE_STATUSES)
    return Q(status__in=wanted)


# The filters the status `counts` ignore (restaurant is in the scope, _admin_scope).
ORDER_FACETS = (
    Facet("status", values=S.values, match=_statuses),
    Facet("payment_method", values=PaymentMethod.values),
    Facet("payment_status", values=PaymentStatus.values),
)
# The restaurants that occur, by count.
ADMIN_FACETS = (*ORDER_FACETS, Facet("restaurant", label="restaurant__name"))


def _admin_scope(query: dict[str, Any]) -> QuerySet[Order]:
    """The customer, restaurant and rider filters (the status `counts` follow these only)."""
    scope = Order.objects.all()
    if customer := query.get("customer"):
        scope = scope.filter(customer_id=customer)
    if query.get("restaurant"):
        scope = scope.filter(restaurant_id__in=query["restaurant"])
    if rider := query.get("rider"):
        scope = scope.filter(delivery_partner_id=rider)
    return scope


def _admin_orders(query: dict[str, Any]) -> QuerySet[Order]:
    """The orders matching every filter; each list-valued filter matches any of its values."""
    qs = apply_facets(_admin_scope(query), query, ORDER_FACETS)
    qs = qs.filter(days_between(query, "placed"))
    if search := (query.get("search") or "").strip():
        qs = qs.filter(order_number__icontains=search.upper())
    return qs


def admin_list(query: dict[str, Any], page: Page) -> dict[str, Any]:
    """
    All orders, filterable by status (or "active"), payment method and status, restaurant,
    customer, rider and the day placed, and searchable by order number. The status counts follow
    the customer, restaurant and rider filters only; `?facets=1` adds the filter panel's counts.
    """
    qs = _admin_orders(query)
    rows, meta = paginate(qs.prefetch_related("items").order_by("-created_at"), page)
    counts = _admin_scope(query).values("status").annotate(n=Count("pk")).order_by()
    result = {
        "items": [presenters.list_json(o) for o in rows],
        "pagination": meta,
        "counts": {c["status"]: c["n"] for c in counts},
    }
    return with_facets(result, query, _admin_orders, ADMIN_FACETS)


def admin_get(order_id: uuid.UUID) -> dict[str, Any]:
    order = _load(order_id)
    data = presenters.present_with_rider(order)
    offer = presenters.open_offer(order)
    data["offer"] = (
        {"rider": presenters.rider_card(offer.rider_id), "expires_at": offer.expires_at}
        if offer
        else None
    )
    # Manual assignment (master prompt §3D) is possible while the order waits for a rider.
    data["can_assign"] = order.status == S.READY_FOR_PICKUP
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
    restaurant = _own_restaurant(owner)
    received = Order.objects.filter(restaurant=restaurant, submitted_at__isnull=False)
    tz = ZoneInfo(settings.REPORT_TIMEZONE)
    start_of_today = (
        timezone.now().astimezone(tz).replace(hour=0, minute=0, second=0, microsecond=0)
    )
    counts = dict(received.values("status").annotate(n=Count("pk")).values_list("status", "n"))
    sales = (
        received.filter(status=S.DELIVERED).aggregate(
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


def admin_assign(admin: User, order_id: uuid.UUID, rider_id: uuid.UUID) -> dict[str, Any]:
    """
    Gives a ready order to a chosen rider directly (manual assignment; also how support reassigns
    after an unassign). The rider must be active, online and free; any open offer is withdrawn.
    """
    rider = DeliveryPartner.objects.filter(
        user_id=rider_id, user__role=Role.DELIVERY, user__status=UserStatus.ACTIVE
    ).first()
    if rider is None:
        raise ApiError.not_found("Delivery partner not found")
    now = timezone.now()
    with transaction.atomic():
        order = Order.objects.select_for_update().filter(pk=order_id).first()
        if order is None:
            raise ApiError.not_found("Order not found")
        if order.status != S.READY_FOR_PICKUP:
            raise _conflict("Only orders waiting for a rider can be assigned", "INVALID_TRANSITION")
        # Withdraw an open offer (and free that rider) before taking the order.
        offers = DeliveryAssignment.objects.filter(order=order, status=AssignmentStatus.OFFERED)
        offered_riders = list(offers.values_list("rider_id", flat=True))
        offers.update(status=AssignmentStatus.CANCELLED, responded_at=now)
        DeliveryPartner.objects.filter(user_id__in=offered_riders, current_offer=order).update(
            current_offer=None
        )
        locked = DeliveryPartner.objects.filter(
            pk=rider.pk, is_online=True, active_order__isnull=True, current_offer__isnull=True
        ).update(active_order=order, last_assigned_at=now, updated_at=now)
        if not locked:
            raise _conflict(
                "This rider is offline or already busy. Choose another rider.", "RIDER_UNAVAILABLE"
            )

        def record(o: Order) -> None:
            DeliveryAssignment.objects.create(
                order=o,
                rider_id=rider_id,
                status=AssignmentStatus.ACCEPTED,
                responded_at=now,
                assigned_by=admin,
            )

        transition(
            order.pk,
            to=S.ASSIGNED,
            actor=Actor.ADMIN,
            user=admin,
            update={"delivery_partner_id": rider_id},
            note="Assigned by BiteBox support",
            on_change=record,
        )
    return admin_get(order_id)


def admin_reset_delivery_otp(admin: User, order_id: uuid.UUID) -> dict[str, Any]:
    """A new delivery code for an order whose rider ran out of tries; the customer gets it."""
    with transaction.atomic():
        order = Order.objects.select_for_update().filter(pk=order_id).first()
        if order is None:
            raise ApiError.not_found("Order not found")
        if order.status not in (S.PICKED_UP, S.ON_THE_WAY) or not order.delivery_otp:
            raise _conflict("This order has no delivery code to reset", "INVALID_TRANSITION")
        order.delivery_otp = new_delivery_otp()
        order.delivery_otp_attempts = 0
        order.save(update_fields=["delivery_otp", "delivery_otp_attempts", "updated_at"])
    notify_new_delivery_otp(presenters.reload(order))
    return admin_get(order_id)


# ---------------------------------------------------------------------------
# Timeline (master prompt §7: GET /orders/{id}/timeline)
# ---------------------------------------------------------------------------
TIMELINE_LABEL: dict[str, str] = {
    S.PENDING: "Order placed",
    S.CONFIRMED: "Accepted by the restaurant",
    S.REJECTED: "Rejected by the restaurant",
    S.PREPARING: "Being prepared",
    S.READY_FOR_PICKUP: "Ready for pickup",
    S.ASSIGNED: "Rider assigned",
    S.ARRIVED_AT_RESTAURANT: "Rider at the restaurant",
    S.PICKED_UP: "Picked up",
    S.ON_THE_WAY: "On the way",
    S.DELIVERED: "Delivered",
    S.CANCELLED: "Cancelled",
}


def timeline(order: Order) -> dict[str, Any]:
    events = [
        {
            "status": h.to_status,
            "label": TIMELINE_LABEL.get(h.to_status, h.to_status),
            "at": h.created_at,
            "by": h.actor_role or None,
            **({"note": h.note} if h.note else {}),
        }
        for h in order.status_history.all()
    ]
    return {
        "order": str(order.pk),
        "order_number": order.order_number,
        "status": order.status,
        "ready_by": order.ready_by,
        "events": events,
    }


def customer_timeline(user: User, order_id: uuid.UUID) -> dict[str, Any]:
    return timeline(_load(order_id, customer=user))


def admin_timeline(order_id: uuid.UUID) -> dict[str, Any]:
    return timeline(_load(order_id))
