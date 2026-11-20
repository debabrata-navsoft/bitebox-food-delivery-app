"""
The cart and its server-side quote (Node: services/cart.service.js). Prices always come from the
database; a client never sends a price. One cart per customer, from one restaurant.
"""

import uuid
from typing import Any

from django.db import IntegrityError, transaction

from apps.accounts.models import User
from apps.coins import quote as coins
from apps.coupons.models import Coupon, Kind
from apps.coupons.services import Line as CouponLine
from apps.coupons.services import assert_eligible
from apps.customers.models import Address
from apps.customers.services import address_json
from apps.dispatch.tunables import max_delivery_km
from apps.menus.models import FoodItem
from apps.restaurants.models import Restaurant, RestaurantStatus
from apps.restaurants.presenters import is_open_now
from common.api import ApiError
from common.geo import haversine_m

from .discounts import Stack, discount_lines, summary
from .models import MAX_ITEM_QUANTITY, Cart, CartItem
from .pricing import PRICING, compute_pricing, js_round


def _cart_for_update(user: User) -> Cart:
    """The customer's cart, locked for this transaction (created on first use)."""
    try:
        with transaction.atomic():
            cart, _ = Cart.objects.select_for_update().get_or_create(user=user)
    except IntegrityError:  # created concurrently by another request
        cart = Cart.objects.select_for_update().get(user=user)
    return cart


def _finish(cart: Cart) -> None:
    if not cart.items.exists():
        cart.restaurant = None
        cart.coupon_code = ""
        cart.offer_code = ""
        cart.coins_to_redeem = 0
    cart.save()


def _set_on_cart(user: User, **fields: Any) -> None:
    """Sets these cart fields under the cart's lock."""
    with transaction.atomic():
        cart = _cart_for_update(user)
        for name, value in fields.items():
            setattr(cart, name, value)
        _finish(cart)


def _filled_quote(user: User) -> dict[str, Any]:
    quote = build_quote(user)
    if quote["cart"] is None:
        raise ApiError.bad_request("Add dishes to your cart first")
    return quote


def _orderable_item(food_item_id: uuid.UUID) -> FoodItem:
    item = (
        FoodItem.objects.select_related("restaurant")
        .filter(pk=food_item_id, deleted_at__isnull=True)
        .first()
    )
    if item is None or item.restaurant.status != RestaurantStatus.APPROVED:
        raise ApiError.not_found("This dish is not available")
    if not item.is_available:
        raise ApiError(409, f"{item.name} is currently unavailable", code="ITEM_UNAVAILABLE")
    return item


@transaction.atomic
def add_item(user: User, food_item_id: uuid.UUID, quantity: int = 1, replace: bool = False) -> None:
    item = _orderable_item(food_item_id)
    cart = _cart_for_update(user)
    if cart.restaurant_id and cart.restaurant_id != item.restaurant_id and cart.items.exists():
        if not replace:
            current = (
                Restaurant.objects.filter(pk=cart.restaurant_id)
                .values_list("name", flat=True)
                .first()
            )
            raise ApiError(
                409,
                f"Your cart has dishes from {current or 'another restaurant'}. Start a new cart?",
                code="CART_RESTAURANT_CONFLICT",
                details=[{"field": "restaurant", "message": current or ""}],
            )
        cart.items.all().delete()
        cart.coupon_code = ""
        cart.offer_code = ""
    cart.restaurant_id = item.restaurant_id
    line = cart.items.filter(food_item=item).first()
    if line:
        line.quantity = min(MAX_ITEM_QUANTITY, line.quantity + quantity)
        line.save(update_fields=["quantity", "updated_at"])
    else:
        CartItem.objects.create(
            cart=cart, food_item=item, quantity=min(MAX_ITEM_QUANTITY, quantity)
        )
    _finish(cart)


@transaction.atomic
def set_quantity(user: User, food_item_id: uuid.UUID, quantity: int) -> None:
    cart = _cart_for_update(user)
    line = cart.items.filter(food_item_id=food_item_id).first()
    if line is None:
        raise ApiError.not_found("This dish is not in your cart")
    if quantity == 0:
        line.delete()
    else:
        if quantity > line.quantity:
            _orderable_item(food_item_id)  # only when adding more
        line.quantity = quantity
        line.save(update_fields=["quantity", "updated_at"])
    _finish(cart)


def remove_item(user: User, food_item_id: uuid.UUID) -> None:
    set_quantity(user, food_item_id, 0)


def clear(user: User) -> None:
    Cart.objects.filter(user=user).delete()


def apply_coupon(user: User, code: str) -> None:
    quote = _filled_quote(user)
    # The engine needs each orderable line's dish and category (for category and dish coupons).
    items = [i for i in quote["cart"]["items"] if i["is_available"]]
    category_of = {
        str(pk): category
        for pk, category in FoodItem.objects.filter(
            pk__in=[i["food_item_id"] for i in items]
        ).values_list("pk", "category_id")
    }
    # A coupon code, or one of the restaurant's offers chosen instead of the best one.
    found = assert_eligible(
        code,
        kinds=(Kind.COUPON, Kind.RESTAURANT_OFFER),
        user_id=user.pk,
        restaurant_id=quote["cart"]["restaurant"]["id"],
        subtotal_paise=quote["pricing"]["subtotal_paise"],
        lines=[
            CouponLine(i["food_item_id"], category_of.get(i["food_item_id"]), i["line_total_paise"])
            for i in items
        ],
    )
    field = "offer_code" if found.kind == Kind.RESTAURANT_OFFER else "coupon_code"
    _set_on_cart(user, **{field: found.code})


def remove_coupon(user: User) -> None:
    _set_on_cart(user, coupon_code="")


def set_coins(user: User, amount: int) -> None:
    if amount == 0:
        remove_coins(user)
        return
    quote = _filled_quote(user)
    coins.assert_redeemable(quote["coins"], amount)
    _set_on_cart(user, coins_to_redeem=min(amount, quote["coins"]["max_redeemable"]))


def remove_coins(user: User) -> None:
    _set_on_cart(user, coins_to_redeem=0)


def _restaurant_summary(r: Restaurant) -> dict[str, Any]:
    data = {
        "id": str(r.pk),
        "name": r.name,
        "slug": r.slug,
        "is_open_now": is_open_now(r),
        "min_order_paise": r.min_order_paise,
        "avg_prep_time_minutes": r.avg_prep_time_minutes,
    }
    if r.image_url:
        data["image_url"] = r.image_url
    return data


def build_quote(
    user: User, address_id: uuid.UUID | None = None, payment: str | None = None
) -> dict[str, Any]:
    """
    Everything the checkout shows, computed from the database, plus what blocks checkout.
    `payment` is the online channel the customer picked (upi, card, ...; None for cash): the
    payment offer for it joins the stack (apps/cart/discounts.py).
    """
    cart = Cart.objects.filter(user=user).first()
    lines_qs = list(cart.items.select_related("food_item").order_by("created_at")) if cart else []
    if cart is None or not lines_qs:
        return {
            "cart": None,
            "coupon": None,
            "coupon_error": None,
            "best_coupon": None,
            "discounts": [],
            "payment_offers": [],
            "restaurant_offers": [],
            "payment_channel": None,
            "coins": None,
            "address": None,
            "delivery": None,
            "pricing": compute_pricing(0).as_dict(),
            "issues": [],
            "can_checkout": False,
        }

    restaurant = (
        Restaurant.objects.filter(pk=cart.restaurant_id).first() if cart.restaurant_id else None
    )
    addresses = Address.objects.filter(user=user)
    address = (
        addresses.filter(pk=address_id) if address_id else addresses.filter(is_default=True)
    ).first()
    if address_id and address is None:
        raise ApiError.not_found("Address not found")

    issues: list[dict[str, str]] = []
    lines = []
    for line in lines_qs:
        food = line.food_item
        orderable = (
            food.deleted_at is None
            and food.is_available
            and food.restaurant_id == cart.restaurant_id
        )
        entry: dict[str, Any] = {
            "food_item_id": str(food.pk),
            "name": food.name,
            "is_veg": food.is_veg,
            "unit_price_paise": food.price_paise,
            "quantity": line.quantity,
            "line_total_paise": food.price_paise * line.quantity if orderable else 0,
            "is_available": orderable,
        }
        if food.image_url:
            entry["image_url"] = food.image_url
        lines.append(entry)
    if any(not entry["is_available"] for entry in lines):
        issues.append(
            {
                "code": "ITEMS_UNAVAILABLE",
                "message": "Some dishes are no longer available. Remove them to continue.",
            }
        )

    if restaurant is None or restaurant.status != RestaurantStatus.APPROVED:
        issues.append(
            {
                "code": "RESTAURANT_UNAVAILABLE",
                "message": "This restaurant is not taking orders on BiteBox right now.",
            }
        )
    elif not is_open_now(restaurant):
        issues.append(
            {
                "code": "RESTAURANT_CLOSED",
                "message": (
                    f"{restaurant.name} is closed now. It opens at {restaurant.opening_time}."
                )
                if restaurant.is_accepting_orders
                else f"{restaurant.name} has paused orders for now.",
            }
        )

    subtotal = sum(entry["line_total_paise"] for entry in lines)
    if restaurant and subtotal < restaurant.min_order_paise:
        more = js_round((restaurant.min_order_paise - subtotal) / 100)
        issues.append(
            {
                "code": "BELOW_MINIMUM",
                "message": (
                    f"Minimum order is ₹{restaurant.min_order_paise / 100:g}. Add ₹{more} more."
                ),
            }
        )

    # What the coupon engine sees: each orderable line's dish, category and total.
    engine_lines = [
        CouponLine(line.food_item_id, line.food_item.category_id, entry["line_total_paise"])
        for line, entry in zip(lines_qs, lines, strict=True)
        if entry["is_available"]
    ]
    coupon: Coupon | None = None
    coupon_error = None
    if cart.coupon_code:
        try:
            coupon = assert_eligible(
                cart.coupon_code,
                user_id=user.pk,
                restaurant_id=cart.restaurant_id,
                subtotal_paise=subtotal,
                lines=engine_lines,
            )
        except ApiError as error:
            coupon_error = {"code": cart.coupon_code, "message": error.message}

    distance_m: int | None = None
    if address is None:
        issues.append({"code": "NO_ADDRESS", "message": "Add a delivery address."})
    elif restaurant is not None:
        distance_m = haversine_m(restaurant.location, address.location)
        max_km = max_delivery_km()  # the admin's delivery range (default PRICING)
        if distance_m > max_km * 1000:
            issues.append(
                {
                    "code": "OUT_OF_RANGE",
                    "message": (
                        f"This address is {distance_m / 1000:.1f} km away. "
                        f"{restaurant.name} delivers within {max_km} km."
                    ),
                }
            )

    # The discounts: the best automatic offers, the coupon, then the payment offer.
    stack = Stack(user, cart.restaurant_id, subtotal, engine_lines, distance_m)
    chosen: list[Coupon] = []
    # The restaurant offer the customer picked (while it still applies), else the best one.
    picked = next(
        (
            c
            for c in stack.coupons
            if c.code == cart.offer_code and c.kind == Kind.RESTAURANT_OFFER and stack.usable(c)
        ),
        None,
    )
    if offer := picked or stack.best(Kind.RESTAURANT_OFFER, chosen):
        chosen.append(offer)
    if offer := stack.best(Kind.PLATFORM_OFFER, chosen):
        chosen.append(offer)
    if coupon:
        chosen.append(coupon)
    before_payment = list(chosen)
    if payment and (offer := stack.best(Kind.PAYMENT_OFFER, chosen, payment)):
        chosen.append(offer)
    # The best coupon code the customer could add (what it saves next to the automatic offers).
    others = [c for c in chosen if c.kind != Kind.COUPON]
    best_code = stack.best(Kind.COUPON, others)

    wallet = coins.load_cart_coins(user.pk)
    coin_quote = coins.redemption_quote(
        wallet["config"],
        wallet["available"],
        cart.coins_to_redeem or 0,
        subtotal - stack.price(chosen)[0].discount_paise,
    )
    pricing, parts = stack.price(chosen, coin_quote["discount_paise"])
    lines_out = discount_lines(chosen, parts)
    applied = next((d for d in lines_out if d["kind"] == Kind.COUPON), None)

    return {
        "cart": {
            "id": str(cart.pk),
            "version": int(cart.updated_at.timestamp() * 1000),
            "restaurant": _restaurant_summary(restaurant) if restaurant else None,
            "items": lines,
            "item_count": sum(entry["quantity"] for entry in lines),
        },
        "coupon": {
            "code": applied["code"],
            "description": applied["description"],
            "discount_type": applied["discount_type"],
            # What the coupon saves: food discount plus any delivery fee it waived.
            "discount_paise": applied["saving_paise"],
        }
        if applied
        else None,
        "coupon_error": coupon_error,
        # Every discount on the bill, in the order it applied.
        "discounts": lines_out,
        # The best coupon code for this cart, so checkout can suggest it (null when none saves).
        "best_coupon": {**summary(best_code), "saving_paise": stack.saving(best_code, others)}
        if best_code
        else None,
        # Every restaurant offer this cart can use (only one applies), best first.
        "restaurant_offers": stack.restaurant_offers(chosen),
        # The best payment offer for each online channel, for the payment step.
        "payment_offers": stack.payment_offers(before_payment),
        "payment_channel": payment,
        "coins": coin_quote,
        "address": address_json(address) if address else None,
        "delivery": None
        if distance_m is None
        else {
            "distance_meters": distance_m,
            "distance_kind": "straight_line",
            "free_delivery": pricing.delivery_fee_paise == 0,
            "free_delivery_threshold_paise": PRICING["free_delivery_threshold_paise"],
        },
        "pricing": pricing.as_dict(),
        "issues": issues,
        "can_checkout": not issues and coupon_error is None,
    }
