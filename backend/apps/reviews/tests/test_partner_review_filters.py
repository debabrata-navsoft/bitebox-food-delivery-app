"""Global filters on the restaurant panel's review list (rows are orders) and the rider's ratings:
multi-value filters (OR within one, AND across), `?facets=1` counts over the signed-in partner's
own reviews only, and 422s. Same cases as
node-js/backend/tests/partner-reviews-support-filters.test.js. Fictional data only."""

from typing import Any

import pytest

from apps.orders.models import Order
from apps.rbac.roles import Role
from apps.reviews.models import Review, ReviewResponse
from tests import factories as make
from tests.list_filters import at, counts, data, field_errors
from tests.list_filters import client_for as client

pytestmark = pytest.mark.django_db

ORDERS = "/api/v1/my/restaurant/reviews/orders"
RIDER = "/api/v1/delivery/reviews"
PHOTO = "/uploads/reviews/plate.jpg"


def numbers(res: Any) -> set[str]:
    return {item["orderNumber"] for item in data(res)["items"]}


def review(
    order: Order, target: str, rating: int, day: str = "2026-04-02", **fields: Any
) -> Review:
    replied = fields.pop("replied", False)
    row = Review.objects.create(
        target=target,
        customer=order.customer,
        customer_name="Tara Fenwick",
        order=order,
        order_number=order.order_number,
        restaurant=order.restaurant,
        rating=rating,
        **fields,
    )
    when = at(day)
    Review.objects.filter(pk=row.pk).update(created_at=when)
    if replied:
        ReviewResponse.objects.create(review=row, text="Thank you for ordering!")
    return row


@pytest.fixture
def world() -> dict[str, Any]:
    owner = make.user(Role.RESTAURANT, name="Owner One")
    mine = make.restaurant(owner=owner, name="Aster Kitchen")
    other = make.restaurant(name="Birch Diner")
    bowl = make.food(restaurant=mine, name="Paneer Bowl")
    wrap = make.food(restaurant=mine, name="Veg Wrap")
    rider = make.user(Role.DELIVERY, name="Ravi Rider")
    a = make.order(restaurant=mine, status="delivered", order_number="BB-A-000001")
    b = make.order(restaurant=mine, status="delivered", order_number="BB-B-000002")
    c = make.order(restaurant=mine, status="delivered", order_number="BB-C-000003")
    x = make.order(restaurant=other, status="delivered", order_number="BB-X-000009")
    # A: 5-star restaurant review with photos (replied) and a 4-star dish review.
    review(a, "restaurant", 5, images=[PHOTO], replied=True, comment="Lovely food")
    review(a, "food", 4, food_item=bowl, food_name="Paneer Bowl")
    # B: 2-star restaurant review, not replied; and a rider rating the restaurant never sees.
    review(b, "restaurant", 2, day="2026-04-05", comment="Cold on arrival")
    review(b, "rider", 1, day="2026-04-05", delivery_partner=rider, comment="Late")
    # C: a hidden review (never shown) and a 3-star dish review.
    review(c, "restaurant", 1, status="hidden")
    review(c, "food", 3, day="2026-04-07", food_item=wrap, food_name="Veg Wrap")
    # Another restaurant's review and another rider's rating: never counted here.
    review(x, "restaurant", 5, images=[PHOTO])
    review(x, "rider", 5, delivery_partner=make.user(Role.DELIVERY), comment="Great")
    review(a, "rider", 4, delivery_partner=rider)
    review(c, "rider", 5, day="2026-04-07", delivery_partner=rider, comment="Quick and kind")
    return {
        "owner": client(owner),
        "rider": client(rider),
        "bowl": bowl,
        "wrap": wrap,
    }


def test_restaurant_filters_take_several_values_and_combine(world: dict[str, Any]) -> None:
    c, bowl, wrap = world["owner"], world["bowl"], world["wrap"]
    every = {"BB-A-000001", "BB-B-000002", "BB-C-000003"}
    assert numbers(c.get(ORDERS)) == every
    assert numbers(c.get(ORDERS, {"rating": "2,3"})) == {"BB-B-000002", "BB-C-000003"}
    assert numbers(c.get(ORDERS, {"target": "food"})) == {"BB-A-000001", "BB-C-000003"}
    assert numbers(c.get(ORDERS, {"reply": "needed"})) == every
    assert numbers(c.get(ORDERS, {"reply": "replied"})) == {"BB-A-000001"}
    assert numbers(c.get(ORDERS, {"photos": "with"})) == {"BB-A-000001"}
    assert numbers(c.get(ORDERS, {"dish": f"{bowl.pk},{wrap.pk}"})) == {
        "BB-A-000001",
        "BB-C-000003",
    }
    # AND across filters: a dish review that also needs a reply, 3 or 4 stars.
    assert numbers(c.get(ORDERS, {"target": "food", "rating": "3", "reply": "needed"})) == {
        "BB-C-000003"
    }
    assert numbers(c.get(ORDERS, {"createdFrom": "2026-04-05", "createdTo": "2026-04-06"})) == {
        "BB-B-000002"
    }
    assert numbers(c.get(ORDERS, {"search": "cold"})) == {"BB-B-000002"}
    assert numbers(c.get(ORDERS, {"search": "veg wrap"})) == {"BB-C-000003"}
    # The older single filters still work.
    assert numbers(c.get(ORDERS, {"rating": "4"})) == {"BB-A-000001"}
    assert numbers(c.get(ORDERS, {"responded": "true"})) == {"BB-A-000001"}
    assert numbers(c.get(ORDERS, {"foodItemId": str(wrap.pk)})) == {"BB-C-000003"}


def test_restaurant_facets_count_own_orders_over_the_other_filters(
    world: dict[str, Any],
) -> None:
    c, bowl, wrap = world["owner"], world["bowl"], world["wrap"]
    assert "facets" not in data(c.get(ORDERS))
    everything = c.get(ORDERS, {"facets": "1"})
    # Only this restaurant's published restaurant and dish reviews (no rider ratings, no hidden).
    assert counts(everything, "target") == {"restaurant": 2, "food": 2}
    assert counts(everything, "rating") == {"1": 0, "2": 1, "3": 1, "4": 1, "5": 1}
    assert counts(everything, "reply") == {"needed": 3, "replied": 1}
    assert counts(everything, "photos") == {"with": 1, "without": 3}
    assert data(everything)["facets"]["dish"] == [
        {"value": str(bowl.pk), "label": "Paneer Bowl", "count": 1},
        {"value": str(wrap.pk), "label": "Veg Wrap", "count": 1},
    ]
    res = c.get(ORDERS, {"target": "restaurant", "facets": "1"})
    assert numbers(res) == {"BB-A-000001", "BB-B-000002"}
    # target ignores its own selection; the others count under it.
    assert counts(res, "target") == {"restaurant": 2, "food": 2}
    assert counts(res, "rating") == {"1": 0, "2": 1, "3": 0, "4": 0, "5": 1}
    assert counts(res, "photos") == {"with": 1, "without": 1}
    assert data(res)["facets"]["dish"] == []


def test_rider_filters_and_facets_cover_own_ratings_only(world: dict[str, Any]) -> None:
    c = world["rider"]
    every = data(c.get(RIDER))
    assert {r["orderNumber"] for r in every["items"]} == {
        "BB-A-000001",
        "BB-B-000002",
        "BB-C-000003",
    }
    assert "facets" not in every
    assert numbers(c.get(RIDER, {"rating": "1,5"})) == {"BB-B-000002", "BB-C-000003"}
    assert numbers(c.get(RIDER, {"rating": "4"})) == {"BB-A-000001"}
    assert numbers(c.get(RIDER, {"comment": "with"})) == {"BB-B-000002", "BB-C-000003"}
    assert numbers(c.get(RIDER, {"comment": "with", "rating": "5"})) == {"BB-C-000003"}
    assert numbers(c.get(RIDER, {"createdFrom": "2026-04-07"})) == {"BB-C-000003"}
    assert numbers(c.get(RIDER, {"search": "late"})) == {"BB-B-000002"}
    res = c.get(RIDER, {"comment": "with", "facets": "1"})
    assert counts(res, "comment") == {"with": 2, "without": 1}
    assert counts(res, "rating") == {"1": 1, "2": 0, "3": 0, "4": 0, "5": 1}


def test_invalid_values_are_422(world: dict[str, Any]) -> None:
    c, r = world["owner"], world["rider"]
    assert field_errors(c.get(ORDERS, {"rating": "6"}))["rating"] == "Invalid value"
    assert field_errors(c.get(ORDERS, {"target": "rider"}))["target"] == "Invalid value"
    assert field_errors(c.get(ORDERS, {"reply": "maybe"}))["reply"] == "Invalid value"
    assert field_errors(c.get(ORDERS, {"photos": "some"}))["photos"] == "Invalid value"
    assert field_errors(c.get(ORDERS, {"dish": "abc"}))["dish"] == "Invalid value"
    assert "createdTo" in field_errors(
        c.get(ORDERS, {"createdFrom": "2026-04-05", "createdTo": "2026-04-01"})
    )
    assert field_errors(r.get(RIDER, {"rating": "0"}))["rating"] == "Invalid value"
    assert field_errors(r.get(RIDER, {"comment": "yes"}))["comment"] == "Invalid value"
