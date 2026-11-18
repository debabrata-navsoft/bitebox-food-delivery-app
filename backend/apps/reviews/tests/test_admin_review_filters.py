"""Global filters on the admin review list (rows are orders): multi-value filters (OR within one,
AND across) and `?facets=1` counts of orders. Same cases as
node-js/backend/tests/admin-filters-reviews.test.js. Fictional data only."""

from typing import Any

import pytest
from rest_framework.test import APIClient

from apps.accounts.tokens import sign_access_token
from apps.orders.models import Order
from apps.rbac.roles import Role
from apps.restaurants.models import Restaurant
from apps.reviews.models import Review
from tests import factories as make
from tests.list_filters import at, counts, data, field_errors

pytestmark = pytest.mark.django_db

ORDERS = "/api/v1/admin/reviews/orders"


def numbers(res: Any) -> set[str]:
    return {item["orderNumber"] for item in data(res)["items"]}


def review(order: Order, target: str, rating: int, day: str = "2026-04-02", **fields: Any) -> None:
    extra: dict[str, Any] = {}
    if target == "food":
        extra = {"food_item": make.food(restaurant=order.restaurant), "food_name": "Paneer Bowl"}
    if target == "rider":
        extra = {"delivery_partner": make.user(Role.DELIVERY, name="Ravi Rider")}
    row = Review.objects.create(
        target=target,
        customer=order.customer,
        customer_name="Tara F.",
        order=order,
        order_number=order.order_number,
        restaurant=order.restaurant,
        rating=rating,
        **extra,
        **fields,
    )
    when = at(day)
    Review.objects.filter(pk=row.pk).update(created_at=when)


@pytest.fixture
def world() -> dict[str, Any]:
    admin = APIClient()
    admin.credentials(HTTP_AUTHORIZATION=f"Bearer {sign_access_token(make.user(Role.ADMIN))}")
    north: Restaurant = make.restaurant(name="Aster Kitchen")
    south: Restaurant = make.restaurant(name="Birch Diner")
    a = make.order(restaurant=north, status="delivered", order_number="BB-A-000001")
    b = make.order(restaurant=north, status="delivered", order_number="BB-B-000002")
    c = make.order(restaurant=south, status="delivered", order_number="BB-C-000003")
    d = make.order(restaurant=south, status="delivered", order_number="BB-D-000004")
    # Order A: two reviews, one 5-star restaurant and one 4-star dish (counts once per order).
    review(a, "restaurant", 5)
    review(a, "food", 4)
    review(b, "restaurant", 2, status="hidden", open_reports=1, day="2026-04-05")
    review(c, "rider", 1, day="2026-04-07")
    review(d, "restaurant", 3, status="deleted")
    return {"c": admin, "north": north, "south": south}


def test_option_filters_take_several_values_and_combine(world: dict[str, Any]) -> None:
    c, north = world["c"], world["north"]
    # No status: every review but deleted ones.
    assert numbers(c.get(ORDERS)) == {"BB-A-000001", "BB-B-000002", "BB-C-000003"}
    assert numbers(c.get(ORDERS, {"rating": "1,2"})) == {"BB-B-000002", "BB-C-000003"}
    assert numbers(c.get(ORDERS, {"target": "food,rider"})) == {"BB-A-000001", "BB-C-000003"}
    assert numbers(c.get(ORDERS, {"status": "hidden,deleted"})) == {"BB-B-000002", "BB-D-000004"}
    assert numbers(c.get(ORDERS, {"restaurant": str(north.pk), "rating": "2,3"})) == {"BB-B-000002"}
    # The old single-value parameters still work.
    assert numbers(c.get(ORDERS, {"rating": "4"})) == {"BB-A-000001"}
    assert numbers(c.get(ORDERS, {"restaurantId": str(north.pk), "reported": "true"})) == {
        "BB-B-000002"
    }
    assert numbers(c.get(ORDERS, {"createdFrom": "2026-04-05", "createdTo": "2026-04-06"})) == {
        "BB-B-000002"
    }


def test_facets_count_orders_over_the_other_filters(world: dict[str, Any]) -> None:
    c, north, south = world["c"], world["north"], world["south"]
    assert "facets" not in data(c.get(ORDERS))
    res = c.get(ORDERS, {"target": "restaurant", "facets": "1"})
    assert numbers(res) == {"BB-A-000001", "BB-B-000002"}
    # target ignores its own selection: order A counts once for each of its two targets.
    assert counts(res, "target") == {"restaurant": 2, "food": 1, "rider": 1}
    # status counts every status, deleted included.
    assert counts(res, "status") == {"published": 1, "hidden": 1, "removed": 0, "deleted": 1}
    assert counts(res, "rating") == {"1": 0, "2": 1, "3": 0, "4": 0, "5": 1}
    assert data(res)["facets"]["restaurant"] == [
        {"value": str(north.pk), "label": "Aster Kitchen", "count": 2}
    ]
    everything = c.get(ORDERS, {"facets": "1"})
    assert counts(everything, "rating") == {"1": 1, "2": 1, "3": 0, "4": 1, "5": 1}
    assert data(everything)["facets"]["restaurant"] == [
        {"value": str(north.pk), "label": "Aster Kitchen", "count": 2},
        {"value": str(south.pk), "label": "Birch Diner", "count": 1},
    ]


def test_invalid_values_are_422(world: dict[str, Any]) -> None:
    c = world["c"]
    assert field_errors(c.get(ORDERS, {"rating": "6"}))["rating"] == "Invalid value"
    assert field_errors(c.get(ORDERS, {"status": "published,gone"}))["status"] == "Invalid value"
    assert field_errors(c.get(ORDERS, {"target": "menu"}))["target"] == "Invalid value"
    assert field_errors(c.get(ORDERS, {"restaurant": "abc"}))["restaurant"] == "Invalid value"
    assert "createdTo" in field_errors(
        c.get(ORDERS, {"createdFrom": "2026-04-05", "createdTo": "2026-04-01"})
    )
