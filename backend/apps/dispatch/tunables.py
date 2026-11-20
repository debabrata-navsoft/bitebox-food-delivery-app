"""
The distances admins can change (`DispatchSettings`): how far riders may be from the restaurant
(dispatch) and how far customers may be (the restaurant list and checkout). Defaults:
`config.DISPATCH` and `cart.pricing.PRICING`.
"""

from typing import Any

from apps.accounts.models import User
from apps.cart.pricing import PRICING

from .config import DISPATCH
from .models import DispatchSettings

MIN_PICKUP_KM = 1
MAX_PICKUP_KM = 50
DEFAULT_PICKUP_KM = int(DISPATCH["max_pickup_distance_km"])
DEFAULT_DELIVERY_KM = int(PRICING["max_delivery_distance_km"])
GLOBAL = DispatchSettings.objects.filter(key="global")


def _saved(column: str, default: int) -> int:
    """One saved distance (one small query), or its default until an admin sets it."""
    return GLOBAL.values_list(column, flat=True).first() or default


def max_pickup_km() -> int:
    """How far from the restaurant a rider may be to be offered its order."""
    return _saved("max_pickup_distance_km", DEFAULT_PICKUP_KM)


def max_delivery_km() -> int:
    """How far from a customer a restaurant may be to be listed and ordered from."""
    return _saved("max_delivery_distance_km", DEFAULT_DELIVERY_KM)


def current() -> dict[str, Any]:
    row = GLOBAL.select_related("updated_by").first()
    return {
        "max_pickup_distance_km": row.max_pickup_distance_km if row else DEFAULT_PICKUP_KM,
        "default_max_pickup_distance_km": DEFAULT_PICKUP_KM,
        "min_pickup_distance_km": MIN_PICKUP_KM,
        "max_allowed_pickup_distance_km": MAX_PICKUP_KM,
        "max_delivery_distance_km": (row and row.max_delivery_distance_km) or DEFAULT_DELIVERY_KM,
        "default_max_delivery_distance_km": DEFAULT_DELIVERY_KM,
        "updated_at": row.updated_at if row else None,
        "updated_by": row.updated_by.name if row and row.updated_by else None,
    }


def update(admin: User, changes: dict[str, int]) -> dict[str, Any]:
    """Saves the given distances (`max_pickup_distance_km`, `max_delivery_distance_km`)."""
    DispatchSettings.objects.update_or_create(
        key="global",
        defaults={"max_pickup_distance_km": max_pickup_km(), **changes, "updated_by": admin},
    )
    return current()
