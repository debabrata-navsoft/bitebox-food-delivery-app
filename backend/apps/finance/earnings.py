"""
How a delivered order's money splits (Node: config/earnings.js, services/earnings.service.js).

The restaurant commission comes from `CommissionRule`: the restaurant's own open rule, else the
global one, else the default below. Rider pay is a base plus a rate per started straight-line km.
"""

import math
from typing import Any

from django.db.models import Q

from apps.cart.pricing import js_round

EARNINGS = {
    "restaurant_commission_basis_points": 1500,  # default: 15% of the food value after the coupon
    "rider_base_paise": 2000,  # ₹20 per delivery
    "rider_per_km_paise": 600,  # ₹6 per started km (straight line)
}


def commission_bp_for(restaurant_id: Any) -> int:
    """The commission rate in effect now for this restaurant."""
    from .models import CommissionRule

    rules: dict[Any, int] = dict(
        CommissionRule.objects.filter(
            Q(restaurant_id=restaurant_id) | Q(restaurant__isnull=True), effective_to__isnull=True
        ).values_list("restaurant_id", "basis_points")
    )
    return rules.get(restaurant_id, rules.get(None, EARNINGS["restaurant_commission_basis_points"]))


def settlement_for(order: Any, commission_bp: int | None = None) -> dict[str, int]:
    bp = commission_bp_for(order.restaurant_id) if commission_bp is None else commission_bp
    food = order.subtotal_paise - (order.discount_paise or 0)
    restaurant = js_round(food * (10_000 - bp) / 10_000)
    rider = (
        EARNINGS["rider_base_paise"]
        + math.ceil((order.distance_m or 0) / 1000) * EARNINGS["rider_per_km_paise"]
    )
    return {
        "restaurant_paise": restaurant,
        "rider_paise": rider,
        "platform_paise": order.total_paise - restaurant - rider,
        "commission_bp": bp,
    }
