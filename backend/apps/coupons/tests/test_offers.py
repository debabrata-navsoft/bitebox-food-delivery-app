"""Coupons and restaurant offers: admin management, the approval queue, what customers see, and
the engine's rules at checkout (categories and dishes, free delivery, new customers, expiry)."""

from datetime import timedelta
from typing import Any

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.accounts.tokens import sign_access_token
from apps.cart.tests.test_cart import ADDRESS, ctx  # noqa: F401
from apps.coupons.models import Coupon, CouponRedemption
from apps.notifications.models import Notification
from apps.rbac.roles import Role
from apps.restaurants.models import Restaurant
from tests import factories as make

pytestmark = pytest.mark.django_db
WINDOW = {"validFrom": "2026-01-01T00:00:00Z", "validUntil": "2027-12-31T00:00:00Z"}


def client_for(user: User) -> APIClient:
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {sign_access_token(user)}")
    return client


@pytest.fixture
def w(ctx: dict[str, Any]) -> dict[str, Any]:  # noqa: F811
    """The seeded kitchen, its partner, an admin and a customer with an address (no coupons)."""
    Coupon.objects.all().delete()
    ctx["client"].post("/api/v1/addresses", ADDRESS, format="json")
    return {
        **ctx,
        "admin": client_for(make.user(Role.ADMIN)),
        "partner": client_for(User.objects.get(email="restaurant@bitebox.test")),
        "kitchen": Restaurant.objects.get(slug="spice-route-kitchen"),
    }


def add(w: dict[str, Any], *names: str) -> None:
    for name in names:
        res = w["client"].post(
            "/api/v1/cart/items",
            {"foodItemId": str(w["food"][name].pk), "quantity": 1},
            format="json",
        )
        assert res.status_code == 200, res.json()


def apply(w: dict[str, Any], code: str) -> Any:
    return w["client"].post("/api/v1/cart/coupon", {"code": code}, format="json")


def admin_coupon(w: dict[str, Any], **body: Any) -> dict[str, Any]:
    res = w["admin"].post(
        "/api/v1/admin/coupons",
        {"discountType": "percent", "discountValue": 10, **WINDOW, **body},
        format="json",
    )
    assert res.status_code == 201, res.json()
    return res.json()["data"]["coupon"]


def offer(w: dict[str, Any], **body: Any) -> dict[str, Any]:
    res = w["partner"].post(
        "/api/v1/my/restaurant/offers",
        {"name": "Weekday treat", "discountType": "percent", "discountValue": 20, **WINDOW, **body},
        format="json",
    )
    assert res.status_code == 201, res.json()
    return res.json()["data"]["coupon"]


def public_codes(w: dict[str, Any]) -> list[str]:
    res = APIClient().get("/api/v1/restaurants/spice-route-kitchen/offers")
    assert res.status_code == 200, res.json()
    return [o["code"] for o in res.json()["data"]["offers"]]


# --- admins ---------------------------------------------------------------------------------------


def test_admin_creates_coupons_with_generated_codes_and_manages_them(w: dict[str, Any]) -> None:
    first = admin_coupon(w, name="Weekend saver", terms="One per order.")
    assert first["code"].startswith("BB")
    assert first["status"] == "active"
    assert (first["source"], first["approvalStatus"]) == ("platform", "approved")
    free = admin_coupon(w, code="freeship", discountType="free_delivery", discountValue=None)
    assert (free["code"], free["discountValue"]) == ("FREESHIP", 0)

    paused = w["admin"].patch(
        f"/api/v1/admin/coupons/{first['id']}/status", {"isActive": False}, format="json"
    )
    assert paused.json()["data"]["coupon"]["status"] == "paused"
    listed = w["admin"].get("/api/v1/admin/coupons?status=paused").json()["data"]["items"]
    assert [c["code"] for c in listed] == [first["code"]]

    copy = w["admin"].post(f"/api/v1/admin/coupons/{free['id']}/duplicate")
    assert copy.status_code == 201
    copied = copy.json()["data"]["coupon"]
    assert copied["code"] != "FREESHIP"
    assert copied["isActive"] is False

    stats = w["admin"].get("/api/v1/admin/coupons/analytics").json()["data"]
    assert (stats["total"], stats["active"], stats["paused"]) == (3, 1, 2)
    assert stats["redemptions"] == 0


# --- restaurant offers and approval ---------------------------------------------------------------


def test_restaurant_offers_wait_for_approval_and_only_then_reach_customers(
    w: dict[str, Any],
) -> None:
    created = offer(w, maxDiscountPaise=10000)
    assert (created["source"], created["status"]) == ("restaurant", "pending")
    assert public_codes(w) == []
    assert w["client"].get("/api/v1/coupons/offers").json()["data"]["offers"] == []

    pending = w["admin"].get("/api/v1/admin/restaurant-offers/pending").json()["data"]["items"]
    assert [p["id"] for p in pending] == [created["id"]]
    approved = w["admin"].post(f"/api/v1/admin/restaurant-offers/{created['id']}/approve")
    assert approved.json()["data"]["coupon"]["status"] == "active"
    assert public_codes(w) == [created["code"]]

    cards = APIClient().get("/api/v1/restaurants").json()["data"]["items"]
    card = next(c for c in cards if c["slug"] == "spice-route-kitchen")
    assert card["offer"]["code"] == created["code"]
    assert card["offer"]["maxDiscountPaise"] == 10000

    # Any edit sends it back for review, hiding it meanwhile.
    edited = w["partner"].patch(
        f"/api/v1/my/restaurant/offers/{created['id']}", {"discountValue": 25}, format="json"
    )
    assert edited.json()["data"]["coupon"]["status"] == "pending"
    assert public_codes(w) == []

    reject = f"/api/v1/admin/restaurant-offers/{created['id']}/reject"
    assert w["admin"].post(reject, {}, format="json").status_code == 422  # needs a reason
    rejected = w["admin"].post(reject, {"reason": "Too generous for a weekday"}, format="json")
    assert rejected.json()["data"]["coupon"]["rejectionReason"] == "Too generous for a weekday"
    assert Notification.objects.filter(user=w["kitchen"].owner, type="offer.rejected").exists()


def test_offers_go_live_at_once_when_approval_is_off(w: dict[str, Any], settings: Any) -> None:
    settings.OFFER_APPROVAL_REQUIRED = False
    assert offer(w)["status"] == "active"
    assert offer(w, draft=True)["status"] == "draft"  # a draft never reaches customers


def test_partners_manage_only_their_own_offers_and_dishes(w: dict[str, Any]) -> None:
    mine = offer(w)
    rival = client_for(make.restaurant(name="Rival Diner", slug="rival-diner").owner)
    assert rival.get(f"/api/v1/my/restaurant/offers/{mine['id']}").status_code == 404
    assert (
        rival.patch(
            f"/api/v1/my/restaurant/offers/{mine['id']}", {"discountValue": 90}, format="json"
        ).status_code
        == 404
    )
    assert rival.get("/api/v1/my/restaurant/offers").json()["data"]["items"] == []
    foreign_dish = make.food(name="Rival Burger")
    refused = w["partner"].post(
        "/api/v1/my/restaurant/offers",
        {
            "discountType": "flat",
            "discountValue": 5000,
            **WINDOW,
            "foodItems": [str(foreign_dish.pk)],
        },
        format="json",
    )
    assert refused.status_code == 422
    assert refused.json()["error"]["details"][0]["field"] == "foodItems"
    assert w["client"].get("/api/v1/my/restaurant/offers").status_code == 403  # customers


# --- what customers can use -----------------------------------------------------------------------


def test_expired_and_paused_coupons_disappear(w: dict[str, Any]) -> None:
    coupon = admin_coupon(w, code="LATE10")
    now = timezone.now()
    Coupon.objects.filter(code="LATE10").update(
        valid_from=now - timedelta(days=10), valid_until=now - timedelta(days=1)
    )
    assert "LATE10" not in public_codes(w)
    add(w, "Masala Dosa")
    expired = apply(w, "LATE10")
    assert expired.status_code == 422
    assert expired.json()["error"]["code"] == "COUPON_EXPIRED"
    Coupon.objects.filter(code="LATE10").update(
        valid_until=now + timedelta(days=1), is_active=False
    )
    assert "LATE10" not in public_codes(w)
    assert coupon["id"]


def test_first_order_coupons_are_only_for_new_customers(w: dict[str, Any]) -> None:
    admin_coupon(w, code="FIRST50", audience="new")

    def codes():
        return [
            c["code"]
            for c in w["client"].get("/api/v1/coupons/available").json()["data"]["coupons"]
        ]

    assert codes() == ["FIRST50"]
    make.order(customer=User.objects.get(pk=w["customer"]["user"]["id"]), restaurant=w["kitchen"])
    assert codes() == []
    add(w, "Masala Dosa")
    refused = apply(w, "FIRST50")
    assert refused.json()["error"]["code"] == "COUPON_NEW_CUSTOMERS"


def test_category_coupons_discount_only_their_dishes(w: dict[str, Any]) -> None:
    desserts = w["food"]["Gulab Jamun (2 pcs)"].category_id
    admin_coupon(w, code="SWEET50", discountValue=50, categories=[str(desserts)])
    add(w, "Masala Dosa")
    refused = apply(w, "SWEET50")
    assert refused.json()["error"]["code"] == "COUPON_NOT_APPLICABLE"
    add(w, "Gulab Jamun (2 pcs)")
    quote = apply(w, "SWEET50").json()["data"]
    assert quote["pricing"]["discountPaise"] == 9900 // 2  # half the dessert, not the dosa


def test_free_delivery_waives_the_fee_and_the_order_keeps_it(w: dict[str, Any]) -> None:
    admin_coupon(w, code="NODELIVERY", discountType="free_delivery")
    add(w, "Masala Dosa", "Gulab Jamun (2 pcs)")  # ₹248: below the ₹499 free-delivery threshold
    before = w["client"].get("/api/v1/cart").json()["data"]["pricing"]
    assert before["deliveryFeePaise"] > 0
    quote = apply(w, "NODELIVERY").json()["data"]
    waived = before["deliveryFeePaise"]
    assert quote["pricing"]["deliveryFeePaise"] == 0
    assert quote["pricing"]["deliveryDiscountPaise"] == waived
    assert quote["pricing"]["totalPaise"] == before["totalPaise"] - waived
    assert quote["coupon"]["discountPaise"] == waived

    address_id = quote["address"]["id"]
    placed = w["client"].post(
        "/api/v1/orders", {"paymentMethod": "cod", "addressId": address_id}, format="json"
    )
    assert placed.status_code == 201, placed.json()
    order = placed.json()["data"]["order"]
    assert order["pricing"]["deliveryDiscountPaise"] == waived
    assert CouponRedemption.objects.get(order_id=order["id"]).discount_paise == waived


def test_the_quote_suggests_the_coupon_that_saves_most(w: dict[str, Any]) -> None:
    admin_coupon(w, code="TENOFF")  # 10%: ₹24.80 on ₹248
    admin_coupon(w, code="FLAT60", discountType="flat", discountValue=6000)
    admin_coupon(w, code="NODELIVERY", discountType="free_delivery")
    admin_coupon(w, code="BIGHALF", discountValue=50, minOrderPaise=50000)  # cart is below ₹500
    assert w["client"].get("/api/v1/cart").json()["data"]["bestCoupon"] is None  # empty cart
    add(w, "Masala Dosa", "Gulab Jamun (2 pcs)")
    best = w["client"].get("/api/v1/cart").json()["data"]["bestCoupon"]
    assert (best["code"], best["savingPaise"]) == ("FLAT60", 6000)
    quote = apply(w, "FLAT60").json()["data"]
    assert quote["coupon"]["discountPaise"] == best["savingPaise"]  # the suggestion is exact
