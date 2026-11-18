"""Global filters on the partner and rider lists: the restaurant's order history, the rider's
delivery history and the restaurant's menu. Multi-value filters, `?facets=1` counts, and that
nothing (rows or counts) ever comes from another restaurant or rider. Same as the Node tests
(tests/partner-orders-menu-filters.test.js). Fictional data only."""

from typing import Any

import pytest

from apps.orders.models import Order
from apps.rbac.roles import Role
from tests import factories as make
from tests.list_filters import at, client_for, counts, data, field_errors

pytestmark = pytest.mark.django_db

ORDERS = "/api/v1/my/restaurant/orders"
HISTORY = "/api/v1/delivery/orders/history"
FOODS = "/api/v1/my/restaurant/foods"


def numbers(res: Any) -> set[str]:
    return {item["orderNumber"] for item in data(res)["items"]}


def placed(number: str, day: str, **fields: Any) -> Order:
    order = make.order(order_number=number, **fields)
    Order.objects.filter(pk=order.pk).update(created_at=at(day))
    return order


def address(name: str) -> dict[str, Any]:
    return {"recipient_name": name, "phone": "9000000002", "line1": "4B", "city": "Bengaluru"}


# --- restaurant order history -------------------------------------------------------------------
@pytest.fixture
def kitchens() -> dict[str, Any]:
    """Four finished orders and one active order at the north kitchen; two at the south one."""
    north = make.restaurant(name="Fictional North")
    south = make.restaurant(name="Fictional South")
    common = {"restaurant": north}
    placed(
        "BB-N-0001", "2026-03-01", status="delivered", delivery_address=address("Asha"), **common
    )
    placed(
        "BB-N-0002",
        "2026-03-02",
        status="delivered",
        payment_method="online",
        delivery_address=address("Ravi Kiran"),
        **common,
    )
    placed(
        "BB-N-0003", "2026-03-03", status="rejected", delivery_address=address("Meera"), **common
    )
    placed(
        "BB-N-0004",
        "2026-03-04",
        status="cancelled",
        payment_method="online",
        delivery_address=address("Ravi Kumar"),
        **common,
    )
    placed("BB-N-0005", "2026-03-04", status="pending", **common)
    placed("BB-S-0001", "2026-03-02", status="delivered", restaurant=south)
    placed("BB-S-0002", "2026-03-03", status="cancelled", restaurant=south, payment_method="online")
    return {"north": client_for(north.owner), "south": client_for(south.owner)}


def test_order_history_filters(kitchens: dict[str, Any]) -> None:
    north = kitchens["north"]

    def found(params: str = "") -> set[str]:
        return numbers(north.get(f"{ORDERS}?view=history&{params}"))

    assert found() == {"BB-N-0001", "BB-N-0002", "BB-N-0003", "BB-N-0004"}
    assert found("status=delivered") == {"BB-N-0001", "BB-N-0002"}  # one value as before
    assert found("status=rejected,cancelled") == {"BB-N-0003", "BB-N-0004"}
    assert len(found("status=pending")) == 4  # a status outside the view is ignored, as before
    assert found("paymentMethod=online") == {"BB-N-0002", "BB-N-0004"}
    assert found("status=delivered&paymentMethod=online") == {"BB-N-0002"}  # AND
    assert found("placedFrom=2026-03-02&placedTo=2026-03-03") == {"BB-N-0002", "BB-N-0003"}
    assert found("search=n-0003") == {"BB-N-0003"}  # order number, any case
    assert found("search=ravi") == {"BB-N-0002", "BB-N-0004"}  # the recipient's name
    # The active view is unchanged (and takes several statuses).
    active = data(north.get(f"{ORDERS}?view=active&status=pending,confirmed"))
    assert [o["orderNumber"] for o in active["items"]] == ["BB-N-0005"]
    assert active["counts"] == {"pending": 1}

    assert field_errors(
        north.get(
            f"{ORDERS}?view=history&status=delivered,lost&paymentMethod=card"
            "&placedFrom=2026-13-01&facets=maybe"
        )
    ) == {
        "status": "Invalid value",
        "paymentMethod": "Invalid value",
        "placedFrom": "Invalid value",
        "facets": "Invalid value",
    }


def test_order_history_facets_count_only_the_restaurants_own_orders(
    kitchens: dict[str, Any],
) -> None:
    north = kitchens["north"]
    assert "facets" not in data(north.get(f"{ORDERS}?view=history"))

    res = north.get(f"{ORDERS}?view=history&status=delivered&paymentMethod=online&facets=1")
    assert data(res)["pagination"]["total"] == 1
    assert list(data(res)["facets"]) == ["status", "paymentMethod"]
    # Each facet leaves out its own selection: statuses over the online orders...
    assert counts(res, "status") == {"delivered": 1, "rejected": 0, "cancelled": 1}
    # ...and payment methods over the delivered ones. Never the south kitchen's orders.
    assert counts(res, "paymentMethod") == {"cod": 1, "online": 1}

    every = north.get(f"{ORDERS}?view=history&facets=1&search=bb-")
    assert counts(every, "status") == {"delivered": 2, "rejected": 1, "cancelled": 1}
    south = kitchens["south"].get(f"{ORDERS}?view=history&facets=1")
    assert numbers(south) == {"BB-S-0001", "BB-S-0002"}
    assert counts(south, "status") == {"delivered": 1, "rejected": 0, "cancelled": 1}
    # The restaurant still never sees the customer's phone or exact address.
    item = data(south)["items"][0]
    assert set(item["deliveryAddress"]) <= {"recipientName", "area", "city"}


# --- rider delivery history ---------------------------------------------------------------------
def test_rider_history_filters_and_facets() -> None:
    rider, other = make.user(Role.DELIVERY), make.user(Role.DELIVERY)
    north = make.restaurant(name="Fictional North")
    south = make.restaurant(name="Fictional South")
    placed("BB-R-0001", "2026-04-01", status="delivered", restaurant=north, delivery_partner=rider)
    placed("BB-R-0002", "2026-04-02", status="delivered", restaurant=south, delivery_partner=rider)
    placed("BB-R-0003", "2026-04-03", status="cancelled", restaurant=north, delivery_partner=rider)
    placed("BB-R-0004", "2026-04-03", status="on_the_way", restaurant=north, delivery_partner=rider)
    placed("BB-X-0001", "2026-04-02", status="delivered", restaurant=north, delivery_partner=other)
    placed("BB-X-0002", "2026-04-02", status="delivered", restaurant=north)
    r = client_for(rider)

    def found(params: str = "") -> set[str]:
        return numbers(r.get(f"{HISTORY}?{params}"))

    assert found() == {"BB-R-0001", "BB-R-0002", "BB-R-0003"}
    assert found("status=cancelled") == {"BB-R-0003"}
    assert found("status=delivered,cancelled") == found()
    assert found(f"restaurant={north.pk}") == {"BB-R-0001", "BB-R-0003"}
    assert found(f"restaurant={north.pk},{south.pk}&status=delivered") == {"BB-R-0001", "BB-R-0002"}
    assert found("placedFrom=2026-04-02&placedTo=2026-04-02") == {"BB-R-0002"}
    assert found("search=r-0002") == {"BB-R-0002"}
    assert "facets" not in data(r.get(HISTORY))

    res = r.get(f"{HISTORY}?status=delivered&restaurant={north.pk}&facets=1")
    assert data(res)["pagination"]["total"] == 1
    # Statuses over the north kitchen's deliveries; restaurants over the delivered ones. The other
    # rider's delivery and the unassigned order at the north kitchen are never counted.
    assert counts(res, "status") == {"delivered": 1, "cancelled": 1}
    assert data(res)["facets"]["restaurant"] == [
        {"value": str(north.pk), "label": "Fictional North", "count": 1},
        {"value": str(south.pk), "label": "Fictional South", "count": 1},
    ]
    theirs = client_for(other).get(f"{HISTORY}?facets=1")
    assert numbers(theirs) == {"BB-X-0001"}
    assert counts(theirs, "restaurant") == {str(north.pk): 1}

    assert field_errors(r.get(f"{HISTORY}?status=on_the_way&restaurant=nope&placedTo=x")) == {
        "status": "Invalid value",
        "restaurant": "Invalid value",
        "placedTo": "Invalid value",
    }


# --- restaurant menu ----------------------------------------------------------------------------
def test_menu_filters_and_facets() -> None:
    north = make.restaurant(name="Fictional North")
    south = make.restaurant(name="Fictional South")
    mains = make.category(name="Fictional Mains")
    sweets = make.category(name="Fictional Sweets")
    make.food(restaurant=north, category=mains, name="Paneer Plate", is_veg=True)
    make.food(restaurant=north, category=mains, name="Chicken Plate", is_veg=False)
    make.food(restaurant=north, category=sweets, name="Kheer Cup", is_veg=True, is_available=False)
    make.food(restaurant=south, category=sweets, name="South Halwa", is_veg=True)
    make.food(restaurant=south, category=mains, name="South Curry", is_veg=False)
    p = client_for(north.owner)

    def names(params: str = "") -> set[str]:
        return {i["name"] for i in data(p.get(f"{FOODS}?{params}"))["items"]}

    assert names() == {"Paneer Plate", "Chicken Plate", "Kheer Cup"}
    assert names(f"category={sweets.pk}") == {"Kheer Cup"}  # one value as before
    assert len(names(f"category={mains.pk},{sweets.pk}")) == 3
    assert names("type=non_veg") == {"Chicken Plate"}
    assert names("availability=unavailable") == {"Kheer Cup"}
    assert names("available=false") == {"Kheer Cup"}  # the boolean still works
    assert names(f"type=veg&category={mains.pk}") == {"Paneer Plate"}
    assert names("search=plate&type=veg,non_veg") == {"Paneer Plate", "Chicken Plate"}
    assert "facets" not in data(p.get(FOODS))

    res = p.get(f"{FOODS}?type=veg&facets=1")
    assert data(res)["pagination"]["total"] == 2
    assert list(data(res)["facets"]) == ["category", "type", "availability"]
    # Categories over the veg dishes (with names); types over the whole menu. Only this
    # restaurant's dishes are counted.
    assert data(res)["facets"]["category"] == [
        {"value": str(mains.pk), "label": "Fictional Mains", "count": 1},
        {"value": str(sweets.pk), "label": "Fictional Sweets", "count": 1},
    ]
    assert counts(res, "type") == {"veg": 2, "non_veg": 1}
    assert counts(res, "availability") == {"available": 1, "unavailable": 1}

    assert field_errors(p.get(f"{FOODS}?category=nope&type=vegan&availability=x")) == {
        "category": "Invalid value",
        "type": "Invalid value",
        "availability": "Invalid value",
    }
