"""Helpers shared by the list filter tests (multi-value filters, `?facets=1`, 422s)."""

from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

from django.conf import settings
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.accounts.tokens import sign_access_token


def client_for(user: User) -> APIClient:
    c = APIClient()
    c.credentials(HTTP_AUTHORIZATION=f"Bearer {sign_access_token(user)}")
    return c


def data(res: Any) -> dict[str, Any]:
    assert res.status_code == 200, res.json()
    return dict(res.json()["data"])


def counts(res: Any, name: str) -> dict[str, int]:
    """A facet's counts by value."""
    return {f["value"]: f["count"] for f in data(res)["facets"][name]}


def field_errors(res: Any) -> dict[str, str]:
    assert res.status_code == 422, res.json()
    return {d["field"]: d["message"] for d in res.json()["error"]["details"]}


def at(day: str, hour: int = 12) -> datetime:
    """A time on a calendar day in the report time zone."""
    return datetime.fromisoformat(f"{day}T{hour:02d}:00").replace(
        tzinfo=ZoneInfo(settings.REPORT_TIMEZONE)
    )
