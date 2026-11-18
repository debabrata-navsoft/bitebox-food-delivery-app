"""Global filters on the admin coupon list (Marketing & Catalog): multi-value filters and the
`?facets=1` counts, and the partner's own offers list that shares the code. Same as the Node tests
(tests/admin-filters-marketing.test.js). Fictional data only."""

from datetime import timedelta
from typing import Any

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from apps.coupons.models import Coupon
from apps.rbac.roles import Role
from tests import factories as make
from tests.list_filters import client_for, data, field_errors

pytestmark = pytest.mark.django_db

COUPONS = "/api/v1/admin/coupons"
OWN = "/api/v1/my/restaurant/offers"
DAY = timedelta(days=1)


@pytest.fixture
def admin() -> APIClient:
    return client_for(make.user(Role.ADMIN))


def codes(res: Any) -> set[str]:
    return {item["code"] for item in data(res)["items"]}


@pytest.fixture
def w() -> dict[str, Any]:
    """Five coupons, one per status, across kinds, owners, audiences and discount types."""
    Coupon.objects.all().delete()
    now = timezone.now()
    north = make.restaurant(name="Fictional North")
    south = make.restaurant(name="Fictional South")
    live = {"valid_from": now - DAY, "valid_until": now + 30 * DAY}
    Coupon.objects.create(code="ALPHA10", discount_type="percent", discount_value=10, **live)
    b = Coupon.objects.create(
        code="BRAVO50",
        kind="platform_offer",
        discount_type="flat",
        discount_value=5000,
        audience="new",
        is_active=False,
        **live,
    )
    b.restaurants.add(north, south)
    Coupon.objects.create(
        code="CHARLIE20",
        kind="restaurant_offer",
        source="restaurant",
        restaurant=north,
        approval_status="pending",
        discount_type="percent",
        discount_value=20,
        **live,
    )
    Coupon.objects.create(
        code="DELTAFREE",
        kind="payment_offer",
        discount_type="free_delivery",
        discount_value=0,
        audience="existing",
        valid_from=now + 5 * DAY,
        valid_until=now + 40 * DAY,
    )
    Coupon.objects.create(
        code="ECHO75",
        discount_type="flat",
        discount_value=7500,
        restaurant=south,
        valid_from=now - 30 * DAY,
        valid_until=now - DAY,
    )
    return {"north": north, "south": south, "now": now}


def test_coupon_multi_value_filters(admin: APIClient, w: dict[str, Any]) -> None:
    north, south = w["north"].pk, w["south"].pk

    def found(params: str) -> set[str]:
        return codes(admin.get(f"{COUPONS}?{params}"))

    assert found("status=active") == {"ALPHA10"}  # one value as before
    assert found("status=paused,scheduled") == {"BRAVO50", "DELTAFREE"}
    assert found("status=expired,pending") == {"ECHO75", "CHARLIE20"}
    assert found("kind=coupon,payment_offer") == {"ALPHA10", "DELTAFREE", "ECHO75"}
    assert found("owner=restaurant") == {"CHARLIE20"}
    assert len(found("owner=platform,restaurant")) == 5
    assert found("audience=new,existing") == {"BRAVO50", "DELTAFREE"}
    assert found("discountType=flat") == {"BRAVO50", "ECHO75"}
    assert found("discountType=percent,free_delivery") == {"ALPHA10", "CHARLIE20", "DELTAFREE"}
    # A restaurant: its own offers, coupons limited to it, and coupons listing it in their scope.
    assert found(f"restaurant={north}") == {"BRAVO50", "CHARLIE20"}
    assert found(f"restaurant={north},{south}") == {"BRAVO50", "CHARLIE20", "ECHO75"}
    assert found(f"restaurant={north}&owner=platform") == {"BRAVO50"}  # AND across filters
    assert found("kind=coupon&discountType=flat&search=echo") == {"ECHO75"}
    # The validity range: coupons valid at some time within it.
    assert "ECHO75" not in found(f"from={(w['now'] + DAY).isoformat().replace('+00:00', 'Z')}")
    assert "DELTAFREE" not in found(f"to={(w['now'] + 2 * DAY).isoformat().replace('+00:00', 'Z')}")

    assert field_errors(
        admin.get(
            f"{COUPONS}?status=active,lost&kind=voucher&owner=x&audience=vip&discountType=bogo"
            f"&restaurant={north},nope"
        )
    ) == {
        "status": "Invalid value",
        "kind": "Invalid value",
        "owner": "Invalid value",
        "audience": "Invalid value",
        "discountType": "Invalid value",
        "restaurant": "Invalid value",
    }
    assert set(field_errors(admin.get(f"{COUPONS}?facets=maybe"))) == {"facets"}


def test_coupon_facets(admin: APIClient, w: dict[str, Any]) -> None:
    north, south = w["north"], w["south"]
    assert "facets" not in data(admin.get(COUPONS))

    page = data(admin.get(f"{COUPONS}?restaurant={north.pk}&discountType=percent&facets=1&limit=1"))
    assert page["pagination"]["total"] == 1
    facets = page["facets"]
    assert list(facets) == ["status", "kind", "owner", "audience", "discountType", "restaurant"]

    def counts(name: str) -> dict[str, int]:
        return {f["value"]: f["count"] for f in facets[name]}

    # Each facet leaves out its own selection: restaurants over the percent coupons...
    assert facets["restaurant"] == [
        {"value": str(north.pk), "label": "Fictional North", "count": 1}
    ]
    # ...and discount types over the north restaurant's coupons (every value, in order).
    assert counts("discountType") == {"percent": 1, "flat": 1, "free_delivery": 0}
    assert list(counts("status")) == [
        "active",
        "scheduled",
        "expired",
        "paused",
        "draft",
        "pending",
        "rejected",
    ]
    assert counts("status")["pending"] == 1
    assert sum(counts("status").values()) == 1
    assert counts("kind") == {
        "coupon": 0,
        "restaurant_offer": 1,
        "platform_offer": 0,
        "payment_offer": 0,
    }
    assert counts("owner") == {"platform": 0, "restaurant": 1}
    assert counts("audience") == {"all": 1, "new": 0, "existing": 0}

    every = data(admin.get(f"{COUPONS}?facets=1"))["facets"]
    # Each coupon once per restaurant it is for; by count, then name.
    assert every["restaurant"] == [
        {"value": str(north.pk), "label": "Fictional North", "count": 2},
        {"value": str(south.pk), "label": "Fictional South", "count": 2},
    ]
    assert {f["value"]: f["count"] for f in every["status"]} == {
        "active": 1,
        "scheduled": 1,
        "expired": 1,
        "paused": 1,
        "draft": 0,
        "pending": 1,
        "rejected": 0,
    }


def test_partner_offers_list_takes_several_values(w: dict[str, Any]) -> None:
    north = w["north"]
    Coupon.objects.create(
        code="FOXTROT5",
        kind="restaurant_offer",
        source="restaurant",
        restaurant=north,
        approval_status="draft",
        discount_type="percent",
        discount_value=5,
        valid_from=w["now"] - DAY,
        valid_until=w["now"] + DAY,
    )
    partner = client_for(north.owner)
    assert codes(partner.get(f"{OWN}?status=pending,draft")) == {"CHARLIE20", "FOXTROT5"}
    assert codes(partner.get(f"{OWN}?status=draft")) == {"FOXTROT5"}
    # Only its own offers, whatever the filters say.
    assert codes(partner.get(f"{OWN}?owner=platform,restaurant")) == {"CHARLIE20", "FOXTROT5"}
    assert set(field_errors(partner.get(f"{OWN}?status=lost"))) == {"status"}


def test_partner_offer_facets_count_only_its_own_offers(w: dict[str, Any]) -> None:
    north, south = w["north"], w["south"]
    for code, owner, kind, value in (
        ("GOLF15", north, "flat", 1500),
        ("HOTEL25", south, "percent", 25),
    ):
        Coupon.objects.create(
            code=code,
            kind="restaurant_offer",
            source="restaurant",
            restaurant=owner,
            discount_type=kind,
            discount_value=value,
            valid_from=w["now"] - DAY,
            valid_until=w["now"] + DAY,
        )
    partner = client_for(north.owner)
    assert "facets" not in data(partner.get(OWN))
    assert codes(partner.get(f"{OWN}?discountType=flat,percent")) == {"CHARLIE20", "GOLF15"}

    page = data(partner.get(f"{OWN}?status=active&facets=1"))
    assert page["pagination"]["total"] == 1
    assert list(page["facets"]) == ["status", "discountType"]
    status = {f["value"]: f["count"] for f in page["facets"]["status"]}
    # Statuses over all its offers; discount types over its active ones. The south restaurant's
    # offer and the platform coupons are never counted.
    assert status["active"] == 1
    assert status["pending"] == 1
    assert sum(status.values()) == 2
    assert {f["value"]: f["count"] for f in page["facets"]["discountType"]} == {
        "percent": 0,
        "flat": 1,
        "free_delivery": 0,
    }
    theirs = data(client_for(south.owner).get(f"{OWN}?facets=1&search=o"))
    assert {f["value"]: f["count"] for f in theirs["facets"]["discountType"]}["percent"] == 1
    assert sum(f["count"] for f in theirs["facets"]["discountType"]) == 1
    assert set(field_errors(partner.get(f"{OWN}?facets=maybe&discountType=bogo"))) == {
        "facets",
        "discountType",
    }
