"""Global filters on a partner's settlement history and payouts (restaurant panel and rider
earnings): multi-value filters, `?facets=1` counts over the signed-in partner's own rows only,
and 422s. Same cases as node-js/backend/tests/partner-reviews-support-filters.test.js.
Fictional data only."""

from typing import Any

import pytest

from apps.accounts.models import User
from apps.finance.models import OrderSettlement, Payout
from apps.rbac.roles import Role
from apps.restaurants.models import Restaurant
from tests import factories as make
from tests.list_filters import at, counts, data, field_errors
from tests.list_filters import client_for as client

pytestmark = pytest.mark.django_db


def numbers(res: Any) -> set[str]:
    return {item["orderNumber"] for item in data(res)["items"]}


def references(res: Any) -> set[str]:
    return {item["reference"] for item in data(res)["items"]}


def payout(
    admin: User, payee: User, restaurant: Restaurant | None, status: str, ref: str, day: str
) -> Payout:
    row = Payout.objects.create(
        type="restaurant" if restaurant else "rider",
        restaurant=restaurant,
        payee=payee,
        payee_name=payee.name,
        status=status,
        reference=ref,
        created_by=admin,
    )
    Payout.objects.filter(pk=row.pk).update(created_at=at(day))
    return row


def settled(
    restaurant: Restaurant, rider: User, number: str, day: str, **links: Payout | None
) -> None:
    order = make.order(
        restaurant=restaurant, status="delivered", order_number=number, delivery_partner=rider
    )
    OrderSettlement.objects.create(
        order=order,
        restaurant_paise=21250,
        rider_paise=4000,
        platform_paise=1000,
        settled_at=at(day),
        **links,
    )


@pytest.fixture
def world() -> dict[str, Any]:
    admin = make.user(Role.FINANCE_ADMIN)
    owner = make.user(Role.RESTAURANT, name="Owner One")
    mine = make.restaurant(owner=owner, name="Aster Kitchen")
    other_owner = make.user(Role.RESTAURANT, name="Owner Two")
    other = make.restaurant(owner=other_owner, name="Birch Diner")
    rider = make.user(Role.DELIVERY, name="Ravi Rider")
    other_rider = make.user(Role.DELIVERY, name="Uma Rider")
    paid = payout(admin, owner, mine, "paid", "UTR-PAID-1", "2026-05-02")
    pending = payout(admin, owner, mine, "pending", "UTR-PEND-2", "2026-05-06")
    payout(admin, owner, mine, "cancelled", "UTR-CANC-3", "2026-05-08")
    rider_paid = payout(admin, rider, None, "paid", "UTR-RIDE-4", "2026-05-03")
    # Another restaurant's and another rider's payouts: never listed or counted.
    payout(admin, other_owner, other, "pending", "UTR-OTHR-5", "2026-05-06")
    payout(admin, other_rider, None, "pending", "UTR-OTHR-6", "2026-05-06")
    settled(
        mine, rider, "BB-S-000001", "2026-05-01", restaurant_payout=paid, rider_payout=rider_paid
    )
    settled(mine, rider, "BB-S-000002", "2026-05-05", restaurant_payout=pending)
    settled(mine, other_rider, "BB-S-000003", "2026-05-07")
    settled(other, other_rider, "BB-S-000009", "2026-05-07")
    return {"owner": client(owner), "rider": client(rider)}


def test_settlements_filter_and_count_own_rows(world: dict[str, Any]) -> None:
    c = world["owner"]
    url = "/api/v1/my/restaurant/settlements"
    assert numbers(c.get(url)) == {"BB-S-000001", "BB-S-000002", "BB-S-000003"}
    assert "facets" not in data(c.get(url))
    assert numbers(c.get(url, {"status": "due,pending"})) == {"BB-S-000002", "BB-S-000003"}
    assert numbers(c.get(url, {"status": "paid"})) == {"BB-S-000001"}
    assert numbers(c.get(url, {"settledFrom": "2026-05-05", "settledTo": "2026-05-06"})) == {
        "BB-S-000002"
    }
    assert numbers(c.get(url, {"search": "000003"})) == {"BB-S-000003"}
    res = c.get(url, {"status": "paid", "settledFrom": "2026-05-02", "facets": "1"})
    assert numbers(res) == set()
    assert counts(res, "status") == {"due": 1, "pending": 1, "paid": 0}
    # The rider's side follows the rider's own payout link.
    r = world["rider"]
    rider_url = "/api/v1/delivery/settlements"
    assert numbers(r.get(rider_url)) == {"BB-S-000001", "BB-S-000002"}
    assert counts(r.get(rider_url, {"facets": "1"}), "status") == {
        "due": 1,
        "pending": 0,
        "paid": 1,
    }


def test_payouts_filter_and_count_own_rows(world: dict[str, Any]) -> None:
    c = world["owner"]
    url = "/api/v1/my/restaurant/payouts"
    assert references(c.get(url)) == {"UTR-PAID-1", "UTR-PEND-2", "UTR-CANC-3"}
    assert references(c.get(url, {"status": "paid,cancelled"})) == {"UTR-PAID-1", "UTR-CANC-3"}
    assert references(c.get(url, {"createdFrom": "2026-05-05"})) == {"UTR-PEND-2", "UTR-CANC-3"}
    assert references(c.get(url, {"search": "pend"})) == {"UTR-PEND-2"}
    res = c.get(url, {"status": "paid", "facets": "1"})
    assert list(data(res)["facets"]) == ["status"]
    assert counts(res, "status") == {"pending": 1, "paid": 1, "cancelled": 1}
    r = world["rider"]
    rider = r.get("/api/v1/delivery/payouts", {"facets": "1"})
    assert references(rider) == {"UTR-RIDE-4"}
    assert counts(rider, "status") == {"pending": 0, "paid": 1, "cancelled": 0}


def test_invalid_values_are_422(world: dict[str, Any]) -> None:
    c = world["owner"]
    settlements = "/api/v1/my/restaurant/settlements"
    assert field_errors(c.get(settlements, {"status": "cancelled"}))["status"] == "Invalid value"
    assert "settledTo" in field_errors(
        c.get(settlements, {"settledFrom": "2026-05-05", "settledTo": "2026-05-01"})
    )
    payouts = "/api/v1/delivery/payouts"
    assert field_errors(world["rider"].get(payouts, {"status": "due"}))["status"] == "Invalid value"
    assert field_errors(c.get("/api/v1/my/restaurant/payouts", {"createdFrom": "May 1"}))[
        "createdFrom"
    ]
