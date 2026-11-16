"""
Prices, fees, tax and totals (Node: config/pricing.js, services/pricing.service.js). Integer paise
throughout. These values become admin-editable settings in release 2 (orders keep a snapshot).
"""

import math
from dataclasses import asdict, dataclass
from typing import Any

PRICING = {
    # A base fee covers the first few km, then a per-km charge (whole km, rounded up), capped.
    "delivery_base_fee_paise": 2500,  # ₹25
    "delivery_base_km": 2,
    "delivery_per_km_paise": 800,  # ₹8 per extra km
    "delivery_max_fee_paise": 9900,  # ₹99
    # Orders at or above this (after the coupon) deliver free.
    "free_delivery_threshold_paise": 49900,  # ₹499
    # Restaurants deliver within this straight-line distance.
    "max_delivery_distance_km": 15,
    "platform_fee_paise": 500,  # ₹5 per order
    # GST on food, on the subtotal after the coupon, in basis points (500 = 5%).
    "food_tax_basis_points": 500,
}


def js_round(value: float) -> int:
    """JavaScript's Math.round (halves round up), not Python's round-half-to-even."""
    return math.floor(value + 0.5)


def coupon_discount(coupon: Any, subtotal_paise: int, base_paise: int | None = None) -> int:
    """
    The food discount. `base_paise` is what the coupon applies to (the lines in its categories or
    dishes; the whole subtotal by default). Never more than that base; percentages are capped by
    max_discount_paise; free-delivery coupons take nothing off the food.
    """
    if coupon is None or coupon.discount_type == "free_delivery":
        return 0
    base = subtotal_paise if base_paise is None else min(base_paise, subtotal_paise)
    if coupon.discount_type == "percent":
        discount = (base * coupon.discount_value) // 100
    else:
        discount = coupon.discount_value
    if coupon.max_discount_paise:
        discount = min(discount, coupon.max_discount_paise)
    return max(0, min(discount, base))


def delivery_fee(distance_m: float, discounted_subtotal_paise: int) -> int:
    if discounted_subtotal_paise >= PRICING["free_delivery_threshold_paise"]:
        return 0
    extra_km = max(0, math.ceil(distance_m / 1000 - PRICING["delivery_base_km"]))
    return min(
        PRICING["delivery_base_fee_paise"] + extra_km * PRICING["delivery_per_km_paise"],
        PRICING["delivery_max_fee_paise"],
    )


@dataclass(frozen=True)
class Pricing:
    subtotal_paise: int
    discount_paise: int
    delivery_fee_paise: int
    platform_fee_paise: int
    tax_paise: int
    coin_discount_paise: int
    total_paise: int
    # The delivery fee a free-delivery coupon waived (already left out of delivery_fee_paise).
    delivery_discount_paise: int = 0

    def as_dict(self) -> dict[str, int]:
        return asdict(self)


def compute_pricing(
    subtotal_paise: int,
    coupon: Any = None,
    distance_m: float | None = None,
    coin_discount_paise: int = 0,
    coupon_base_paise: int | None = None,
) -> Pricing:
    discount = coupon_discount(coupon, subtotal_paise, coupon_base_paise)
    discounted = subtotal_paise - discount
    fee = 0 if distance_m is None else delivery_fee(distance_m, discounted)
    waived = fee if coupon is not None and coupon.discount_type == "free_delivery" else 0
    fee -= waived
    tax = js_round(discounted * PRICING["food_tax_basis_points"] / 10_000)
    platform = PRICING["platform_fee_paise"] if subtotal_paise > 0 else 0
    before_coins = discounted + fee + platform + tax
    # Coins pay part of the bill; they never change tax, fees or the free-delivery threshold.
    coins = max(0, min(coin_discount_paise, before_coins))
    return Pricing(
        subtotal_paise, discount, fee, platform, tax, coins, before_coins - coins, waived
    )
