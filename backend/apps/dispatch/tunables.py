"""The dispatch rules admins can change (`DispatchSettings`), with `config.DISPATCH` defaults."""

from typing import Any

from apps.accounts.models import User

from .config import DISPATCH
from .models import DispatchSettings

MIN_PICKUP_KM = 1
MAX_PICKUP_KM = 50
DEFAULT_PICKUP_KM = int(DISPATCH["max_pickup_distance_km"])
GLOBAL = DispatchSettings.objects.filter(key="global")


def max_pickup_km() -> int:
    """How far from the restaurant a rider may be to be offered its order (one small query)."""
    saved = GLOBAL.values_list("max_pickup_distance_km", flat=True).first()
    return saved or DEFAULT_PICKUP_KM


def current() -> dict[str, Any]:
    row = GLOBAL.select_related("updated_by").first()
    return {
        "max_pickup_distance_km": row.max_pickup_distance_km if row else DEFAULT_PICKUP_KM,
        "default_max_pickup_distance_km": DEFAULT_PICKUP_KM,
        "min_pickup_distance_km": MIN_PICKUP_KM,
        "max_allowed_pickup_distance_km": MAX_PICKUP_KM,
        "updated_at": row.updated_at if row else None,
        "updated_by": row.updated_by.name if row and row.updated_by else None,
    }


def update(admin: User, max_pickup_distance_km: int) -> dict[str, Any]:
    DispatchSettings.objects.update_or_create(
        key="global",
        defaults={"max_pickup_distance_km": max_pickup_distance_km, "updated_by": admin},
    )
    return current()
