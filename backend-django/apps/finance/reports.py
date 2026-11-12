"""
Earnings reports (Node: services/reports.service.js#earnings). Built from the settlement each
delivered order gets (apps/finance/models.py#OrderSettlement); days are grouped in
settings.REPORT_TIMEZONE, and every day of the window appears, quiet days included.
"""

from datetime import datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from django.conf import settings
from django.db.models import Count, F, Sum
from django.db.models.functions import TruncDate
from django.utils import timezone

from apps.accounts.models import User
from apps.restaurants.models import Restaurant
from common.api import ApiError

from .models import OrderSettlement


def day_keys(days: int, now: datetime | None = None) -> list[str]:
    """Every day of the window, oldest first, as YYYY-MM-DD in the report time zone."""
    tz = ZoneInfo(settings.REPORT_TIMEZONE)
    now = now or timezone.now()
    return [
        (now - timedelta(days=days - 1 - i)).astimezone(tz).strftime("%Y-%m-%d")
        for i in range(days)
    ]


def _earnings(share: str, days: int, **match: Any) -> dict[str, Any]:
    now = timezone.now()
    settled = OrderSettlement.objects.filter(
        settled_at__gte=now - timedelta(days=days), order__status="delivered", **match
    )
    tz = ZoneInfo(settings.REPORT_TIMEZONE)
    daily_rows = (
        settled.annotate(day=TruncDate("settled_at", tzinfo=tz))
        .values("day")
        .annotate(
            orders=Count("pk"),
            earnings_paise=Sum(share),
            distance_meters=Sum("order__distance_m"),
        )
        .order_by()
    )
    by_day = {row["day"].isoformat(): row for row in daily_rows}
    daily = [
        {
            "date": key,
            "orders": by_day.get(key, {}).get("orders", 0),
            "earnings_paise": by_day.get(key, {}).get("earnings_paise", 0) or 0,
            "distance_meters": by_day.get(key, {}).get("distance_meters", 0) or 0,
        }
        for key in day_keys(days, now)
    ]
    recent = settled.select_related("order").annotate(earned=F(share)).order_by("-settled_at")[:20]
    return {
        "days": days,
        "totals": {
            field: sum(row[field] for row in by_day.values()) or 0
            for field in ("orders", "earnings_paise", "distance_meters")
        },
        "daily": daily,
        "recent": [
            {
                "id": str(s.order_id),
                "order_number": s.order.order_number,
                "restaurant_name": s.order.restaurant_snapshot.get("name"),
                "area": s.order.delivery_address.get("area")
                or s.order.delivery_address.get("city"),
                "total_paise": s.order.total_paise,
                "distance_meters": s.order.distance_m,
                "earnings_paise": s.earned,
                "delivered_at": s.settled_at,
            }
            for s in recent
        ],
    }


def restaurant_earnings(owner: User, days: int = 30) -> dict[str, Any]:
    restaurant_id = Restaurant.objects.filter(owner=owner).values_list("pk", flat=True).first()
    if restaurant_id is None:
        raise ApiError.not_found("Create your restaurant first")
    return _earnings("restaurant_paise", days, order__restaurant_id=restaurant_id)


def rider_earnings(user: User, days: int = 30) -> dict[str, Any]:
    return _earnings("rider_paise", days, order__delivery_partner=user)
