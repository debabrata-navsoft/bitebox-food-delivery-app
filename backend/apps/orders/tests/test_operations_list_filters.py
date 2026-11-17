"""Global filters, phase B: multi-value filters and `?facets=1` counts on the operations lists
(admin orders, restaurants, foods and delivery partners). Fictional data only."""

from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

import pytest
from django.conf import settings
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.accounts.tokens import sign_access_token
from apps.delivery.models import DeliveryPartner, RiderVehicle
from apps.orders.models import Order
from apps.rbac.roles import Role
from tests import factories as make

pytestmark = pytest.mark.django_db

ORDERS = "/api/v1/admin/orders"
RESTAURANTS = "/api/v1/admin/restaurants"
FOODS = "/api/v1/admin/foods"
RIDERS = "/api/v1/admin/delivery-partners"


@pytest.fixture
def admin() -> APIClient:
    c = APIClient()
    c.credentials(HTTP_AUTHORIZATION=f"Bearer {sign_access_token(make.user(Role.ADMIN))}")
    return c


def data(res: Any) -> dict[str, Any]:
    assert res.status_code == 200, res.json()
    return dict(res.json()["data"])


def ids(res: Any) -> set[str]:
    return {item["id"] for item in data(res)["items"]}


def counts(res: Any, name: str) -> dict[str, int]:
    return {f["value"]: f["count"] for f in data(res)["facets"][name]}


def field_errors(res: Any) -> dict[str, str]:
    assert res.status_code == 422, res.json()
    return {d["field"]: d["message"] for d in res.json()["error"]["details"]}


def at(day: str, hour: int) -> datetime:
    """A time on a calendar day in the report time zone."""
    return datetime.fromisoformat(f"{day}T{hour:02d}:00").replace(
        tzinfo=ZoneInfo(settings.REPORT_TIMEZONE)
    )


# --- orders -------------------------------------------------------------------------------------


def placed(when: datetime, **fields: Any) -> Order:
    order = make.order(**fields)
    Order.objects.filter(pk=order.pk).update(created_at=when)
    return order


def test_orders_multi_value_filters(admin: APIClient) -> None:
    north = make.restaurant(name="Fictional North")
    south = make.restaurant(name="Fictional South")
    a = placed(at("2026-03-01", 0), restaurant=north, status="pending")
    b = placed(at("2026-03-02", 12), restaurant=north, status="delivered", payment_status="paid")
    c = placed(
        at("2026-03-03", 23),
        restaurant=south,
        status="cancelled",
        payment_method="online",
        payment_status="refunded",
    )
    d = placed(
        at("2026-03-04", 9),
        restaurant=south,
        status="preparing",
        payment_method="online",
        payment_status="paid",
    )

    def found(params: str) -> set[str]:
        return ids(admin.get(f"{ORDERS}?{params}"))

    assert found("status=pending,cancelled") == {str(a.pk), str(c.pk)}
    assert found("status=active") == {str(a.pk), str(d.pk)}  # the shorthand as before
    assert found("status=active,delivered") == {str(a.pk), str(b.pk), str(d.pk)}
    assert found("paymentMethod=online") == {str(c.pk), str(d.pk)}
    assert found("paymentMethod=cod,online") == {str(x.pk) for x in (a, b, c, d)}
    assert found("paymentStatus=paid,refunded") == {str(b.pk), str(c.pk), str(d.pk)}
    assert found(f"restaurant={north.pk}") == {str(a.pk), str(b.pk)}  # one id as before
    assert found(f"restaurant={north.pk},{south.pk}") == {str(x.pk) for x in (a, b, c, d)}
    assert found(f"restaurant={south.pk}&paymentStatus=paid") == {str(d.pk)}  # AND across
    # placed days are inclusive calendar days in the report time zone
    assert found("placedFrom=2026-03-02&placedTo=2026-03-03") == {str(b.pk), str(c.pk)}
    assert found("placedFrom=2026-03-04") == {str(d.pk)}
    assert found("placedTo=2026-03-01") == {str(a.pk)}

    assert field_errors(
        admin.get(
            f"{ORDERS}?status=pending,lost&paymentMethod=card&paymentStatus=paid,x"
            f"&restaurant={north.pk},nope&placedFrom=2026-13-01"
        )
    ) == {
        "status": "Invalid value",
        "paymentMethod": "Invalid value",
        "paymentStatus": "Invalid value",
        "restaurant": "Invalid value",
        "placedFrom": "Invalid value",
    }
    assert field_errors(admin.get(f"{ORDERS}?placedFrom=2026-03-04&placedTo=2026-03-01")) == {
        "placedTo": "Must be on or after placedFrom"
    }


def test_orders_facets(admin: APIClient) -> None:
    north = make.restaurant(name="Fictional North")
    south = make.restaurant(name="Fictional South")
    east = make.restaurant(name="Fictional East")
    make.order(restaurant=north, status="pending")
    make.order(restaurant=north, status="delivered", payment_status="paid")
    make.order(restaurant=south, status="delivered", payment_method="online", payment_status="paid")
    make.order(restaurant=east, status="cancelled", payment_method="online")
    make.order(restaurant=east, status="pending", payment_method="online")

    plain = data(admin.get(f"{ORDERS}?status=delivered"))
    assert "facets" not in plain
    assert plain["counts"] == {"pending": 2, "delivered": 2, "cancelled": 1}

    res = admin.get(f"{ORDERS}?status=delivered&paymentMethod=cod&facets=1&limit=1")
    page = data(res)
    assert page["pagination"]["total"] == 1
    assert page["counts"] == {"pending": 2, "delivered": 2, "cancelled": 1}  # unchanged
    assert list(page["facets"]) == ["status", "paymentMethod", "paymentStatus", "restaurant"]
    # status: every order status (not "active"), over the COD orders
    assert page["facets"]["status"] == [
        {"value": s, "count": {"pending": 1, "delivered": 1}.get(s, 0)}
        for s in (
            "pending",
            "confirmed",
            "rejected",
            "preparing",
            "ready_for_pickup",
            "assigned",
            "arrived_at_restaurant",
            "picked_up",
            "on_the_way",
            "delivered",
            "cancelled",
        )
    ]
    # payment method: over the delivered orders
    assert page["facets"]["paymentMethod"] == [
        {"value": "cod", "count": 1},
        {"value": "online", "count": 1},
    ]
    assert page["facets"]["paymentStatus"] == [
        {"value": "pending", "count": 0},
        {"value": "paid", "count": 1},
        {"value": "failed", "count": 0},
        {"value": "refunded", "count": 0},
        {"value": "partially_refunded", "count": 0},
        {"value": "cancelled", "count": 0},
    ]
    # restaurant: id facets carry the name; only those that occur
    assert page["facets"]["restaurant"] == [
        {"value": str(north.pk), "label": "Fictional North", "count": 1}
    ]

    everything = data(admin.get(f"{ORDERS}?facets=1"))["facets"]["restaurant"]
    assert everything == [
        {"value": str(east.pk), "label": "Fictional East", "count": 2},
        {"value": str(north.pk), "label": "Fictional North", "count": 2},
        {"value": str(south.pk), "label": "Fictional South", "count": 1},
    ]
    # the restaurant facet leaves out its own selection, the others apply it
    res = admin.get(f"{ORDERS}?restaurant={east.pk}&facets=1")
    assert len(counts(res, "restaurant")) == 3
    assert counts(res, "paymentMethod") == {"cod": 0, "online": 2}
    # status=active counts as its statuses; the status facet ignores it
    res = admin.get(f"{ORDERS}?status=active&paymentMethod=online&facets=1")
    assert data(res)["pagination"]["total"] == 1
    assert counts(res, "status")["cancelled"] == 1
    assert counts(res, "paymentMethod") == {"cod": 1, "online": 1}


# --- restaurants (review list) --------------------------------------------------------------------


def test_restaurants_multi_value_filters_and_facets(admin: APIClient) -> None:
    a = make.restaurant(city="Mysuru", cuisines=["Thai", "Chinese"], is_pure_veg=True)
    b = make.restaurant(
        city=" mysuru ", cuisines=["thai "], status="pending", is_accepting_orders=False
    )
    c = make.restaurant(city="Udupi", cuisines=["Coastal", "Chinese"], status="suspended")
    d = make.restaurant(city="Hubballi", cuisines=["North Indian"], is_pure_veg=True)

    def found(params: str) -> set[str]:
        return ids(admin.get(f"{RESTAURANTS}?{params}"))

    assert found("status=pending,suspended") == {str(b.pk), str(c.pk)}
    assert found("status=approved") == {str(a.pk), str(d.pk)}  # one value as before
    assert found("city=MYSURU,hubballi") == {str(a.pk), str(b.pk), str(d.pk)}
    assert found("cuisine=THAI,coastal") == {str(a.pk), str(b.pk), str(c.pk)}
    assert found("veg=pure_veg") == {str(a.pk), str(d.pk)}
    assert found("veg=pure_veg,mixed") == {str(x.pk) for x in (a, b, c, d)}
    assert found("accepting=closed") == {str(b.pk)}
    assert found("cuisine=chinese&veg=mixed") == {str(c.pk)}
    assert found("joinedFrom=2000-01-01&joinedTo=2000-01-02") == set()

    assert "facets" not in data(admin.get(RESTAURANTS))
    res = admin.get(f"{RESTAURANTS}?veg=pure_veg&cuisine=thai&facets=1&limit=1")
    page = data(res)
    assert page["pagination"]["total"] == 1
    assert list(page["facets"]) == ["status", "city", "cuisine", "veg", "accepting"]
    assert page["facets"]["status"] == [
        {"value": "pending", "count": 0},
        {"value": "approved", "count": 1},
        {"value": "rejected", "count": 0},
        {"value": "suspended", "count": 0},
        {"value": "resubmission_requested", "count": 0},
    ]
    # cuisine: over the pure-veg restaurants, its own selection left out; one count per cuisine
    assert page["facets"]["cuisine"] == [
        {"value": "Chinese", "count": 1},
        {"value": "North Indian", "count": 1},
        {"value": "Thai", "count": 1},
    ]
    # veg: over the Thai restaurants (any letter case)
    assert page["facets"]["veg"] == [
        {"value": "pure_veg", "count": 1},
        {"value": "mixed", "count": 1},
    ]
    assert page["facets"]["accepting"] == [
        {"value": "open", "count": 1},
        {"value": "closed", "count": 0},
    ]
    assert page["facets"]["city"] == [{"value": "Mysuru", "count": 1}]

    everything = data(admin.get(f"{RESTAURANTS}?facets=1"))["facets"]
    assert everything["cuisine"] == [
        {"value": "Chinese", "count": 2},
        {"value": "Thai", "count": 2},  # "Thai" and "thai " merged
        {"value": "Coastal", "count": 1},
        {"value": "North Indian", "count": 1},
    ]
    assert everything["city"][0] == {"value": "Mysuru", "count": 2}

    assert field_errors(
        admin.get(f"{RESTAURANTS}?status=approved,closed&veg=vegan&accepting=maybe&facets=x")
    ) == {
        "status": "Invalid value",
        "veg": "Invalid value",
        "accepting": "Invalid value",
        "facets": "Invalid value",
    }


# --- foods ----------------------------------------------------------------------------------------


def test_foods_multi_value_filters_and_facets(admin: APIClient) -> None:
    north = make.restaurant(name="Fictional North")
    south = make.restaurant(name="Fictional South")
    curries = make.category(name="Curries")
    breads = make.category(name="Breads")
    a = make.food(restaurant=north, category=curries, is_veg=True)
    b = make.food(restaurant=north, category=breads, is_veg=False, is_available=False)
    c = make.food(restaurant=south, category=curries, is_veg=False)
    make.food(restaurant=south, category=curries, deleted_at=a.created_at)  # deleted: never

    def found(params: str) -> set[str]:
        return ids(admin.get(f"{FOODS}?{params}"))

    assert found(f"restaurant={north.pk}") == {str(a.pk), str(b.pk)}  # one id as before
    assert found(f"restaurant={north.pk},{south.pk}") == {str(a.pk), str(b.pk), str(c.pk)}
    assert found(f"category={breads.pk}") == {str(b.pk)}
    assert found(f"category={breads.pk},{curries.pk}") == {str(a.pk), str(b.pk), str(c.pk)}
    assert found("type=non_veg") == {str(b.pk), str(c.pk)}
    assert found("type=veg,non_veg") == {str(a.pk), str(b.pk), str(c.pk)}
    assert found("availability=unavailable") == {str(b.pk)}
    assert found("veg=true") == {str(a.pk)}  # the booleans as before
    assert found("available=false") == {str(b.pk)}
    assert found(f"restaurant={south.pk}&type=non_veg") == {str(c.pk)}

    assert "facets" not in data(admin.get(FOODS))
    res = admin.get(f"{FOODS}?restaurant={north.pk}&type=non_veg&facets=1&limit=1")
    page = data(res)
    assert page["pagination"]["total"] == 1
    assert list(page["facets"]) == ["restaurant", "category", "type", "availability"]
    # restaurant: own selection left out, type=non_veg applied
    assert page["facets"]["restaurant"] == [
        {"value": str(north.pk), "label": "Fictional North", "count": 1},
        {"value": str(south.pk), "label": "Fictional South", "count": 1},
    ]
    assert page["facets"]["category"] == [{"value": str(breads.pk), "label": "Breads", "count": 1}]
    assert page["facets"]["type"] == [
        {"value": "veg", "count": 1},
        {"value": "non_veg", "count": 1},
    ]
    assert page["facets"]["availability"] == [
        {"value": "available", "count": 0},
        {"value": "unavailable", "count": 1},
    ]
    every = data(admin.get(f"{FOODS}?facets=1"))["facets"]["category"]
    assert every == [
        {"value": str(curries.pk), "label": "Curries", "count": 2},
        {"value": str(breads.pk), "label": "Breads", "count": 1},
    ]

    assert field_errors(
        admin.get(f"{FOODS}?restaurant={north.pk},x&category=1&type=vegan&availability=sold_out")
    ) == {
        "restaurant": "Invalid value",
        "category": "Invalid value",
        "type": "Invalid value",
        "availability": "Invalid value",
    }


# --- delivery partners ----------------------------------------------------------------------------


def rider(vehicle: str | None = None, profile: bool = True, **fields: Any) -> User:
    u = make.user(Role.DELIVERY)
    if profile:
        p = DeliveryPartner.objects.create(user=u, **fields)
        if vehicle:
            RiderVehicle.objects.create(partner=p, vehicle_type=vehicle, vehicle_number="KA01X1")
    return u


def test_delivery_partners_multi_value_filters_and_facets(admin: APIClient) -> None:
    free = rider("scooter", zone="Lakeside", verification_status="approved", is_online=True)
    busy_order = make.order(status="assigned")
    busy = rider(
        "car",
        zone="lakeside ",
        verification_status="approved",
        is_online=True,
        active_order=busy_order,
    )
    refused = rider("scooter", zone="Hilltop", verification_status="rejected")
    new = rider(profile=False)  # nothing sent yet: not_submitted, offline

    def found(params: str) -> set[str]:
        return ids(admin.get(f"{RIDERS}?{params}"))

    assert found("verification=rejected,not_submitted") == {str(refused.pk), str(new.pk)}
    assert found("verification=approved") == {str(free.pk), str(busy.pk)}  # one as before
    assert found("availability=online,busy") == {str(free.pk), str(busy.pk)}
    assert found("availability=busy") == {str(busy.pk)}
    assert found("availability=offline") == {str(refused.pk), str(new.pk)}
    assert found("vehicleType=car,bicycle") == {str(busy.pk)}
    assert found("zone=LAKESIDE,hilltop") == {str(free.pk), str(busy.pk), str(refused.pk)}
    assert found("online=true") == {str(free.pk), str(busy.pk)}  # the boolean as before
    assert found("zone=lakeside&vehicleType=scooter") == {str(free.pk)}

    assert "facets" not in data(admin.get(RIDERS))
    res = admin.get(f"{RIDERS}?verification=approved&vehicleType=scooter&facets=1&limit=1")
    page = data(res)
    assert page["pagination"]["total"] == 1
    assert list(page["facets"]) == ["verification", "availability", "vehicleType", "zone"]
    # verification: over the scooter riders, own selection left out
    assert page["facets"]["verification"] == [
        {"value": "pending", "count": 0},
        {"value": "approved", "count": 1},
        {"value": "rejected", "count": 1},
        {"value": "resubmission_requested", "count": 0},
        {"value": "not_submitted", "count": 0},
    ]
    assert page["facets"]["availability"] == [
        {"value": "online", "count": 1},
        {"value": "offline", "count": 0},
        {"value": "busy", "count": 0},
    ]
    # vehicle type: over the approved riders
    assert page["facets"]["vehicleType"] == [
        {"value": "bicycle", "count": 0},
        {"value": "scooter", "count": 1},
        {"value": "motorbike", "count": 0},
        {"value": "car", "count": 1},
    ]
    assert page["facets"]["zone"] == [{"value": "Lakeside", "count": 1}]
    zones = data(admin.get(f"{RIDERS}?facets=1"))["facets"]["zone"]
    assert zones == [{"value": "Lakeside", "count": 2}, {"value": "Hilltop", "count": 1}]

    assert field_errors(
        admin.get(f"{RIDERS}?verification=approved,gone&availability=away&vehicleType=jet")
    ) == {
        "verification": "Invalid value",
        "availability": "Invalid value",
        "vehicleType": "Invalid value",
    }
