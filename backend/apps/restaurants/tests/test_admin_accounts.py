"""Account management phase 3: restaurant accounts in the admin panel (list, account page, edits,
status, closing for orders) and the restaurant filters on other admin lists. Fictional data only."""

from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Any

import pytest
from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import User, UserStatus
from apps.accounts.tokens import sign_access_token
from apps.audit.models import AuditLog
from apps.coupons.models import ApprovalStatus, Coupon, Kind, Source
from apps.finance.models import CommissionRule, Payout
from apps.kyc.models import DocumentStatus, KycDocument, PayoutAccount
from apps.notifications.models import Notification
from apps.rbac.roles import Role
from apps.restaurants.models import Restaurant
from apps.reviews.models import Review, ReviewTarget
from tests import factories as make

pytestmark = pytest.mark.django_db

ACCOUNTS = "/api/v1/admin/restaurant-accounts"
FSSAI = "12345678901234"
GSTIN = "29ABCDE1234F1Z5"


def client_for(user: User) -> APIClient:
    c = APIClient()
    c.credentials(HTTP_AUTHORIZATION=f"Bearer {sign_access_token(user)}")
    return c


def operator(*permissions: str) -> APIClient:
    return client_for(make.user(Role.OPERATOR, custom_permissions=list(permissions)))


@pytest.fixture
def admin() -> APIClient:
    return client_for(make.user(Role.ADMIN))


def ids(res: Any) -> list[str]:
    assert res.status_code == 200, res.json()
    return [item["id"] for item in res.json()["data"]["items"]]


def field_errors(res: Any) -> dict[str, str]:
    return {d["field"]: d["message"] for d in res.json()["error"].get("details", [])}


def created(r: Restaurant, at: datetime) -> Restaurant:
    Restaurant.objects.filter(pk=r.pk).update(created_at=at)
    r.refresh_from_db()
    return r


def doc(r: Restaurant, kind: str, status: str = DocumentStatus.APPROVED) -> KycDocument:
    return KycDocument.objects.create(
        user=r.owner,
        kind=kind,
        file_name=f"{kind}-{r.pk.hex[:8]}.pdf",
        content_type="application/pdf",
        size=100,
        status=status,
    )


def bank(r: Restaurant) -> PayoutAccount:
    return PayoutAccount.objects.create(
        user=r.owner,
        holder_name="Fictional Holder",
        account_number_encrypted="x",
        account_last4="4321",
        ifsc="TEST0001234",
    )


def verified(r: Restaurant) -> Restaurant:
    for kind in ("fssai_licence", "pan_card", "cancelled_cheque"):
        doc(r, kind)
    bank(r)
    return r


# --- the list -----------------------------------------------------------------------------------


def test_list_item_shape_with_stats_commission_and_kyc(admin: APIClient) -> None:
    owner = make.user(Role.RESTAURANT, name="Mira Lanternfield", phone="+919000000401")
    r = make.restaurant(
        owner=owner, name="Lantern Dosa House", rating_average=Decimal("4.3"), rating_count=12
    )
    for status in ("delivered", "cancelled", "pending"):
        make.order(restaurant=r, status=status)

    res = admin.get(ACCOUNTS)
    assert res.status_code == 200, res.json()
    data = res.json()["data"]
    assert data["pagination"] == {"page": 1, "limit": 20, "total": 1, "totalPages": 1}
    assert data["items"] == [
        {
            "id": str(r.pk),
            "name": "Lantern Dosa House",
            "slug": r.slug,
            "imageUrl": None,
            "city": "Bengaluru",
            "status": "approved",
            "statusReason": None,
            "isAcceptingOrders": True,
            "createdAt": data["items"][0]["createdAt"],
            "owner": {
                "id": str(owner.pk),
                "name": "Mira Lanternfield",
                "email": owner.email,
                "phone": "+919000000401",
                "status": "active",
                "avatarUrl": None,
            },
            "stats": {"orders": 3, "rating": {"average": 4.3, "count": 12}},
            "commissionPercent": 15,
            "kycStatus": "incomplete",
        }
    ]


def test_filters_by_status_account_status_and_city(admin: APIClient) -> None:
    live = make.restaurant(city="Mysuru ")
    waiting = make.restaurant(status="pending", city="mysuru")
    blocked_owner = make.restaurant(
        owner=make.user(Role.RESTAURANT, status=UserStatus.BLOCKED), city="Hubballi"
    )

    assert ids(admin.get(f"{ACCOUNTS}?status=pending")) == [str(waiting.pk)]
    assert ids(admin.get(f"{ACCOUNTS}?accountStatus=blocked")) == [str(blocked_owner.pk)]
    assert set(ids(admin.get(f"{ACCOUNTS}?city=MYSURU"))) == {str(live.pk), str(waiting.pk)}
    assert ids(admin.get(f"{ACCOUNTS}?city=Mysur")) == []  # exact, not contains
    bad = admin.get(f"{ACCOUNTS}?status=closed&accountStatus=gone&kyc=maybe&sort=best")
    assert bad.status_code == 422
    assert field_errors(bad) == {
        "status": "Invalid value",
        "accountStatus": "Invalid value",
        "kyc": "Invalid value",
        "sort": "Invalid value",
    }


def test_kyc_states(admin: APIClient) -> None:
    ok = verified(make.restaurant(name="All Good"))
    nothing = make.restaurant(name="Nothing Yet")
    no_bank = make.restaurant(name="No Bank")
    for kind in ("fssai_licence", "pan_card", "cancelled_cheque"):
        doc(no_bank, kind)
    waiting = make.restaurant(name="Waiting")
    doc(waiting, "fssai_licence", DocumentStatus.PENDING)
    doc(waiting, "pan_card")
    doc(waiting, "cancelled_cheque")
    bank(waiting)
    refused = make.restaurant(name="Refused")
    doc(refused, "fssai_licence", DocumentStatus.REJECTED)  # rejected wins over missing ones
    gst = verified(make.restaurant(name="GST Registered", gst_registered=True, gstin=GSTIN))

    def state(kyc: str) -> set[str]:
        return set(ids(admin.get(f"{ACCOUNTS}?kyc={kyc}")))

    assert state("verified") == {str(ok.pk)}
    assert state("incomplete") == {str(nothing.pk), str(no_bank.pk), str(gst.pk)}
    assert state("pending") == {str(waiting.pk)}
    assert state("rejected") == {str(refused.pk)}
    doc(gst, "gst_certificate", DocumentStatus.PENDING)
    assert str(gst.pk) in state("pending")

    detail = admin.get(f"{ACCOUNTS}/{nothing.pk}").json()["data"]["kyc"]
    assert detail == {
        "status": "incomplete",
        "missing": ["fssai_licence", "pan_card", "cancelled_cheque"],
    }
    assert admin.get(f"{ACCOUNTS}/{waiting.pk}").json()["data"]["kyc"] == {
        "status": "pending",
        "missing": [],
    }
    assert admin.get(f"{ACCOUNTS}/{ok.pk}").json()["data"]["kyc"]["status"] == "verified"
    assert admin.get(f"{ACCOUNTS}/{refused.pk}").json()["data"]["kyc"] == {
        "status": "rejected",
        "missing": ["pan_card", "cancelled_cheque"],
    }


def test_search_forms(admin: APIClient) -> None:
    owner = make.user(
        Role.RESTAURANT,
        name="Oskar Pebbleton",
        email="oskar.p@bitebox.test",
        phone="+919000000412",
    )
    r = make.restaurant(owner=owner, name="Pebble Biryani", slug="pebble-biryani-hsr")
    make.restaurant(name="Another Place")

    for term in (
        "pebble%20BIRYANI",
        "biryani-hsr",
        "oskar%20peb",
        "oskar.p@",
        "9000000412",
        "%2B91%2090000%2000412",
        str(r.pk),
        "%23" + r.pk.hex[-8:].upper(),
        r.pk.hex[-6:],
    ):
        assert ids(admin.get(f"{ACCOUNTS}?search={term}")) == [str(r.pk)], term
    assert ids(admin.get(f"{ACCOUNTS}?search={owner.pk}")) == []  # the owner's id is not it
    assert ids(admin.get(f"{ACCOUNTS}?search=nobody-here")) == []
    long = admin.get(f"{ACCOUNTS}?search={'x' * 101}")
    assert long.status_code == 422
    assert "search" in field_errors(long)


@override_settings(REPORT_TIMEZONE="Asia/Kolkata")
def test_joined_dates_are_whole_days_in_the_report_time_zone(admin: APIClient) -> None:
    # 18:29 UTC is 23:59 on 9 March in Kolkata; 18:31 UTC on 9 March is 00:01 on 10 March.
    late = created(make.restaurant(), datetime(2026, 3, 9, 18, 29, tzinfo=UTC))
    early = created(make.restaurant(), datetime(2026, 3, 9, 18, 31, tzinfo=UTC))
    assert ids(admin.get(f"{ACCOUNTS}?joinedTo=2026-03-09")) == [str(late.pk)]
    assert ids(admin.get(f"{ACCOUNTS}?joinedFrom=2026-03-10&joinedTo=2026-03-10")) == [
        str(early.pk)
    ]
    bad = admin.get(f"{ACCOUNTS}?joinedFrom=2026-03-10&joinedTo=2026-03-09")
    assert bad.status_code == 422
    assert set(field_errors(bad)) == {"joinedTo"}
    assert set(field_errors(admin.get(f"{ACCOUNTS}?joinedFrom=10-03-2026"))) == {"joinedFrom"}


def test_sorts_and_pagination(admin: APIClient) -> None:
    now = timezone.now()
    a = created(
        make.restaurant(name="banyan Cafe", rating_average=Decimal("4.5"), rating_count=3),
        now - timedelta(days=3),
    )
    b = created(
        make.restaurant(name="Amber Kitchen", rating_average=Decimal("4.5"), rating_count=9),
        now - timedelta(days=2),
    )
    c = created(
        make.restaurant(name="Cedar Grill", rating_average=Decimal("3.9"), rating_count=50),
        now - timedelta(days=1),
    )
    for _ in range(3):
        make.order(restaurant=a)
    make.order(restaurant=c)

    def order(sort: str) -> list[str]:
        return ids(admin.get(f"{ACCOUNTS}?sort={sort}"))

    assert order("newest") == [str(c.pk), str(b.pk), str(a.pk)]
    assert order("oldest") == [str(a.pk), str(b.pk), str(c.pk)]
    assert order("name") == [str(b.pk), str(a.pk), str(c.pk)]
    assert order("orders") == [str(a.pk), str(c.pk), str(b.pk)]
    assert order("rating") == [str(b.pk), str(a.pk), str(c.pk)]

    page = admin.get(f"{ACCOUNTS}?sort=orders&page=2&limit=2").json()["data"]
    assert [i["id"] for i in page["items"]] == [str(b.pk)]
    assert page["pagination"] == {"page": 2, "limit": 2, "total": 3, "totalPages": 2}
    assert admin.get(f"{ACCOUNTS}?limit=101").status_code == 422


def test_cities_are_distinct_trimmed_and_sorted(admin: APIClient) -> None:
    for city in ("Mysuru", " mysuru ", "Hubballi", "agra"):
        make.restaurant(city=city)
    res = admin.get(f"{ACCOUNTS}/cities")
    assert res.status_code == 200, res.json()
    assert res.json()["data"] == {"cities": ["agra", "Hubballi", "Mysuru"]}


def test_view_needs_restaurants_view() -> None:
    r = make.restaurant()
    no = operator("customers:view")
    for url in (ACCOUNTS, f"{ACCOUNTS}/cities", f"{ACCOUNTS}/{r.pk}"):
        assert no.get(url).status_code == 403, url
    yes = operator("restaurants:view")
    assert yes.get(ACCOUNTS).status_code == 200
    assert yes.get(f"{ACCOUNTS}/{r.pk}").status_code == 200
    assert yes.patch(f"{ACCOUNTS}/{r.pk}", {"name": "New Name"}, format="json").status_code == 403


# --- the account page ---------------------------------------------------------------------------


def test_detail_stats_restaurant_and_commission(admin: APIClient) -> None:
    r = make.restaurant(owner_name="Fictional Owner", rating_average=Decimal("4.1"), rating_count=7)
    delivered = [make.order(restaurant=r, status="delivered") for _ in range(2)]
    make.order(restaurant=r, status="cancelled")
    make.order(restaurant=r, status="rejected")
    newest = make.order(restaurant=r, status="preparing")
    make.order(status="delivered")  # another restaurant

    res = admin.get(f"{ACCOUNTS}/{r.pk}")
    assert res.status_code == 200, res.json()
    data = res.json()["data"]
    partner = client_for(r.owner).get("/api/v1/my/restaurant").json()["data"]["restaurant"]
    assert data["restaurant"] == {**partner, "statusReason": None, "reviewedAt": None}
    assert data["restaurant"]["ownerName"] == "Fictional Owner"
    assert data["owner"]["id"] == str(r.owner_id)
    assert data["owner"]["role"] == "restaurant"
    stats = data["stats"]
    assert {k: stats[k] for k in ("orders", "delivered", "cancelled", "grossPaise")} == {
        "orders": 5,
        "delivered": 2,
        "cancelled": 2,
        "grossPaise": sum(o.total_paise for o in delivered),
    }
    assert datetime.fromisoformat(stats["lastOrderAt"]) == newest.created_at
    assert stats["rating"] == {"average": 4.1, "count": 7}
    assert data["commission"] == {"percent": 15, "source": "default"}

    now = timezone.now()
    CommissionRule.objects.create(basis_points=1800, effective_from=now)
    assert admin.get(f"{ACCOUNTS}/{r.pk}").json()["data"]["commission"] == {
        "percent": 18,
        "source": "default",
    }
    CommissionRule.objects.create(restaurant=r, basis_points=1750, effective_from=now)
    assert admin.get(f"{ACCOUNTS}/{r.pk}").json()["data"]["commission"] == {
        "percent": 17.5,
        "source": "restaurant",
    }
    item = admin.get(ACCOUNTS).json()["data"]["items"]
    assert {i["id"]: i["commissionPercent"] for i in item}[str(r.pk)] == 17.5


def test_detail_unknown_and_malformed_ids(admin: APIClient) -> None:
    res = admin.get(f"{ACCOUNTS}/00000000-0000-4000-8000-000000000000")
    assert res.status_code == 404
    assert res.json()["message"] == "Restaurant not found"
    assert admin.get(f"{ACCOUNTS}/not-an-id").status_code == 422


# --- edits --------------------------------------------------------------------------------------


def test_edit_reuses_partner_validation_and_drops_other_fields(admin: APIClient) -> None:
    r = make.restaurant(status="rejected", status_reason="Blurry photos")
    owner = r.owner
    bad = admin.patch(
        f"{ACCOUNTS}/{r.pk}",
        {"name": "X", "fssaiNumber": "123", "cuisines": []},
        format="json",
    )
    assert bad.status_code == 422
    assert field_errors(bad) == {
        "name": "Name must be 2-100 characters",
        "fssaiNumber": "An FSSAI number has 14 digits",
        "cuisines": "Add between 1 and 10 cuisines",
    }
    res = admin.patch(
        f"{ACCOUNTS}/{r.pk}",
        {
            "name": "Juniper Thali",
            "ownerName": "June Fictional",
            "fssaiValidUntil": "2027-03-31",
            "address": {
                "line1": "7 Imaginary Road",
                "city": "Mysuru",
                "state": "Karnataka",
                "postalCode": "570001",
            },
            "status": "approved",
            "commissionPercent": 5,
            "email": "kitchen@bitebox.test",
            "owner": {"email": "taken@bitebox.test", "phone": "9000000999", "status": "blocked"},
            "ownerEmail": "taken@bitebox.test",
            "password": "Another-pass-1",
        },
        format="json",
    )
    assert res.status_code == 200, res.json()
    assert res.json()["message"] == "Restaurant updated"
    out = res.json()["data"]["restaurant"]
    assert out["name"] == "Juniper Thali"
    assert out["slug"].startswith("juniper-thali")
    assert out["ownerName"] == "June Fictional"
    assert out["address"]["city"] == "Mysuru"
    assert out["status"] == "rejected"  # unchanged (the partner's edit would resubmit it)
    assert out["statusReason"] == "Blurry photos"
    r.refresh_from_db()
    owner.refresh_from_db()
    assert r.status == "rejected"
    assert r.email == "kitchen@bitebox.test"
    assert owner.status == UserStatus.ACTIVE
    assert owner.email != "taken@bitebox.test"
    assert owner.check_password(make.PASSWORD)

    entry = AuditLog.objects.get(action="restaurant.update")
    assert entry.resource_type == "restaurant"
    assert entry.resource_id == str(r.pk)
    assert entry.account_type == "restaurant"
    assert entry.description == "Updated restaurant details"
    assert entry.changes["name"]["to"] == "Juniper Thali"
    assert entry.changes["ownerName"] == {"from": "", "to": "June Fictional"}
    assert entry.changes["fssaiValidUntil"] == {"from": None, "to": "2027-03-31"}
    assert entry.changes["address.city"] == {"from": "Bengaluru", "to": "Mysuru"}
    assert "reverified" not in entry.changes


def test_edit_without_changes_is_not_audited(admin: APIClient) -> None:
    r = make.restaurant(name="Same Name Cafe")
    res = admin.patch(f"{ACCOUNTS}/{r.pk}", {"name": "Same Name Cafe"}, format="json")
    assert res.status_code == 200, res.json()
    assert res.json()["data"]["restaurant"]["name"] == "Same Name Cafe"
    assert admin.patch(f"{ACCOUNTS}/{r.pk}", {}, format="json").status_code == 200
    assert not AuditLog.objects.exists()


def test_a_new_gstin_or_fssai_number_sends_the_approved_document_back_for_review(
    admin: APIClient,
) -> None:
    r = verified(make.restaurant(fssai_number=FSSAI, gst_registered=True, gstin=GSTIN))
    gst = doc(r, "gst_certificate")
    assert admin.get(f"{ACCOUNTS}/{r.pk}").json()["data"]["kyc"]["status"] == "verified"

    res = admin.patch(f"{ACCOUNTS}/{r.pk}", {"fssaiNumber": "98765432109876"}, format="json")
    assert res.status_code == 200, res.json()
    fssai = KycDocument.objects.get(user=r.owner, kind="fssai_licence")
    assert fssai.status == DocumentStatus.PENDING
    assert fssai.reviewed_at is None
    gst.refresh_from_db()
    assert gst.status == DocumentStatus.APPROVED
    assert admin.get(f"{ACCOUNTS}/{r.pk}").json()["data"]["kyc"]["status"] == "pending"
    r.refresh_from_db()
    assert r.status == "approved"
    entry = AuditLog.objects.get(action="restaurant.update")
    assert entry.changes["fssaiNumber"] == {"from": FSSAI, "to": "98765432109876"}
    assert entry.changes["reverified"] == ["fssai_licence"]

    res = admin.patch(f"{ACCOUNTS}/{r.pk}", {"gstin": "27ABCDE1234F1Z5"}, format="json")
    assert res.status_code == 200, res.json()
    gst.refresh_from_db()
    assert gst.status == DocumentStatus.PENDING
    latest = AuditLog.objects.filter(action="restaurant.update").order_by("-created_at").first()
    assert latest is not None
    assert latest.changes["reverified"] == ["gst_certificate"]


def test_edit_needs_restaurants_edit() -> None:
    r = make.restaurant()
    url = f"{ACCOUNTS}/{r.pk}"
    assert operator("restaurants:view").patch(url, {"name": "Nope"}, format="json").status_code == (
        403
    )
    res = operator("restaurants:edit").patch(url, {"name": "Fine Name"}, format="json")
    assert res.status_code == 200, res.json()
    missing = operator("restaurants:edit").patch(
        f"{ACCOUNTS}/00000000-0000-4000-8000-000000000000", {"name": "Fine"}, format="json"
    )
    assert missing.status_code == 404


# --- status -------------------------------------------------------------------------------------


def status(c: APIClient, r: Restaurant, value: str, reason: str | None = None) -> Any:
    body: dict[str, Any] = {"status": value}
    if reason is not None:
        body["reason"] = reason
    return c.patch(f"{ACCOUNTS}/{r.pk}/status", body, format="json")


def test_status_permission_split() -> None:
    approver = operator("restaurants:approve")
    switcher = operator("restaurants:status")
    pending = make.restaurant(status="pending")
    live = make.restaurant()

    assert status(switcher, pending, "approved").status_code == 403
    res = status(approver, pending, "approved")
    assert res.status_code == 200, res.json()
    assert res.json()["message"] == "Restaurant approved"
    assert res.json()["data"]["restaurant"]["status"] == "approved"

    assert status(approver, live, "suspended", "Food safety check").status_code == 403
    res = status(switcher, live, "suspended", "  Food safety check  ")
    assert res.status_code == 200, res.json()
    assert res.json()["message"] == "Restaurant suspended"
    assert res.json()["data"]["restaurant"]["statusReason"] == "Food safety check"
    assert status(approver, live, "approved").status_code == 403  # lifting is restaurants:status
    res = status(switcher, live, "approved")
    assert res.status_code == 200, res.json()
    assert res.json()["message"] == "Restaurant reactivated"

    other = make.restaurant(status="pending")
    res = status(approver, other, "resubmission_requested", "Upload a clearer licence")
    assert res.json()["message"] == "Asked for resubmission"
    rejected = make.restaurant(status="pending")
    assert status(approver, rejected, "rejected", "Not a real kitchen").json()["message"] == (
        "Restaurant rejected"
    )
    assert status(operator("restaurants:view"), rejected, "approved").status_code == 403


def test_status_reason_rules_and_audit(admin: APIClient) -> None:
    r = make.restaurant()
    for reason in (None, "", "  ", "ab", "x" * 501):
        res = status(admin, r, "suspended", reason)
        assert res.status_code == 422, reason
        assert set(field_errors(res)) == {"reason"}
    bad = status(admin, r, "pending")
    assert bad.status_code == 422
    assert set(field_errors(bad)) == {"status"}

    res = status(admin, r, "suspended", "Repeated late orders")
    assert res.status_code == 200, res.json()
    entry = AuditLog.objects.get(action="restaurant.status")
    assert entry.changes == {"status": {"from": "approved", "to": "suspended"}}
    assert entry.reason == "Repeated late orders"
    assert entry.account_type == "restaurant"
    assert entry.resource_id == str(r.pk)
    assert Notification.objects.filter(user=r.owner, type="restaurant.suspended").exists()

    again = status(admin, r, "suspended", "Repeated late orders")
    assert again.status_code == 200
    assert again.json()["message"] == "Restaurant suspended"
    assert AuditLog.objects.filter(action="restaurant.status").count() == 1


def test_status_keeps_the_existing_review_rules(admin: APIClient) -> None:
    pending = make.restaurant(status="pending")
    res = status(admin, pending, "suspended", "Cannot suspend a pending one")
    assert res.status_code == 409
    with override_settings(RESTAURANT_KYC_REQUIRED=True):
        res = status(admin, pending, "approved")
        assert res.status_code == 409
        assert res.json()["error"]["code"] == "KYC_INCOMPLETE"
        ready = verified(make.restaurant(status="pending", fssai_number=FSSAI))
        assert status(admin, ready, "approved").status_code == 200
    assert not AuditLog.objects.filter(resource_id=str(pending.pk)).exists()
    missing = admin.patch(
        f"{ACCOUNTS}/00000000-0000-4000-8000-000000000000/status",
        {"status": "approved"},
        format="json",
    )
    assert missing.status_code == 404


# --- accepting orders ---------------------------------------------------------------------------


def test_closing_and_reopening_for_orders(admin: APIClient) -> None:
    r = make.restaurant()
    url = f"{ACCOUNTS}/{r.pk}/accepting-orders"
    for reason in (None, "no"):
        body: dict[str, Any] = {"isAcceptingOrders": False}
        if reason is not None:
            body["reason"] = reason
        res = admin.patch(url, body, format="json")
        assert res.status_code == 422
        assert set(field_errors(res)) == {"reason"}
    assert set(field_errors(admin.patch(url, {}, format="json"))) == {"isAcceptingOrders"}

    res = admin.patch(
        url, {"isAcceptingOrders": False, "reason": "Kitchen fire drill"}, format="json"
    )
    assert res.status_code == 200, res.json()
    assert res.json()["message"] == "Restaurant closed for orders"
    assert res.json()["data"]["restaurant"]["isAcceptingOrders"] is False
    r.refresh_from_db()
    assert r.is_accepting_orders is False
    entry = AuditLog.objects.get(action="restaurant.accepting_orders")
    assert entry.changes == {"isAcceptingOrders": {"from": True, "to": False}}
    assert entry.reason == "Kitchen fire drill"
    assert entry.account_type == "restaurant"
    assert entry.description == "Closed the restaurant for orders"

    res = admin.patch(url, {"isAcceptingOrders": True}, format="json")
    assert res.status_code == 200, res.json()
    assert res.json()["message"] == "Restaurant open for orders"
    assert AuditLog.objects.filter(action="restaurant.accepting_orders").count() == 2
    admin.patch(url, {"isAcceptingOrders": True}, format="json")  # no change: no audit
    assert AuditLog.objects.filter(action="restaurant.accepting_orders").count() == 2

    # the partner can still reopen it themselves
    admin.patch(url, {"isAcceptingOrders": False, "reason": "Closed by support"}, format="json")
    partner = client_for(r.owner).patch(
        "/api/v1/my/restaurant/accepting-orders", {"isAcceptingOrders": True}, format="json"
    )
    assert partner.status_code == 200


def test_accepting_orders_needs_restaurants_status() -> None:
    r = make.restaurant()
    url = f"{ACCOUNTS}/{r.pk}/accepting-orders"
    body = {"isAcceptingOrders": False, "reason": "Closed for audit"}
    assert operator("restaurants:edit").patch(url, body, format="json").status_code == 403
    assert operator("restaurants:status").patch(url, body, format="json").status_code == 200


# --- restaurant filters on other admin lists ----------------------------------------------------


def test_orders_filter_by_restaurant(admin: APIClient) -> None:
    r = make.restaurant()
    mine = [make.order(restaurant=r) for _ in range(2)]
    make.order()
    res = admin.get(f"/api/v1/admin/orders?restaurant={r.pk}")
    assert res.status_code == 200, res.json()
    assert {i["id"] for i in res.json()["data"]["items"]} == {str(o.pk) for o in mine}
    bad = admin.get("/api/v1/admin/orders?restaurant=123")
    assert bad.status_code == 422
    assert set(field_errors(bad)) == {"restaurant"}


def test_coupons_filter_by_restaurant(admin: APIClient) -> None:
    r, other = make.restaurant(), make.restaurant()
    now = timezone.now()
    window = {"valid_from": now - timedelta(days=1), "valid_until": now + timedelta(days=1)}
    offer = Coupon.objects.create(
        code="OWN20",
        kind=Kind.RESTAURANT_OFFER,
        source=Source.RESTAURANT,
        restaurant=r,
        approval_status=ApprovalStatus.APPROVED,
        discount_type="percent",
        discount_value=20,
        **window,
    )
    scoped = Coupon.objects.create(
        code="SCOPED50", discount_type="flat", discount_value=5000, **window
    )
    scoped.restaurants.add(r, other)
    Coupon.objects.create(code="EVERYWHERE", discount_type="flat", discount_value=1000, **window)
    Coupon.objects.create(
        code="ELSEWHERE", discount_type="flat", discount_value=1000, restaurant=other, **window
    )

    res = admin.get(f"/api/v1/admin/coupons?restaurant={r.pk}")
    assert res.status_code == 200, res.json()
    assert {i["code"] for i in res.json()["data"]["items"]} == {offer.code, scoped.code}
    bad = admin.get("/api/v1/admin/coupons?restaurant=nope")
    assert bad.status_code == 422
    assert set(field_errors(bad)) == {"restaurant"}


def test_payouts_filter_by_restaurant(admin: APIClient) -> None:
    r, other = make.restaurant(), make.restaurant()
    by = make.user(Role.ADMIN)

    def payout(kitchen: Restaurant) -> Payout:
        return Payout.objects.create(
            type="restaurant",
            restaurant=kitchen,
            payee=kitchen.owner,
            payee_name=kitchen.name,
            amount_paise=10000,
            created_by=by,
        )

    mine = payout(r)
    payout(other)
    res = admin.get(f"/api/v1/admin/finance/payouts?restaurant={r.pk}")
    assert res.status_code == 200, res.json()
    assert [i["id"] for i in res.json()["data"]["items"]] == [str(mine.pk)]
    bad = admin.get("/api/v1/admin/finance/payouts?restaurant=1")
    assert bad.status_code == 422
    assert set(field_errors(bad)) == {"restaurant"}


def test_reviews_and_foods_filter_by_restaurant(admin: APIClient) -> None:
    r, other = make.restaurant(), make.restaurant()
    for kitchen in (r, other):
        order = make.order(restaurant=kitchen, status="delivered")
        Review.objects.create(
            target=ReviewTarget.RESTAURANT,
            customer=order.customer,
            customer_name=order.customer.name,
            order=order,
            order_number=order.order_number,
            restaurant=kitchen,
            rating=5,
            comment="Lovely food.",
        )
    res = admin.get(f"/api/v1/admin/reviews/orders?restaurantId={r.pk}")
    assert res.status_code == 200, res.json()
    assert len(res.json()["data"]["items"]) == 1
    assert admin.get("/api/v1/admin/reviews/orders?restaurantId=1").status_code == 422

    dish = make.food(restaurant=r)
    make.food(restaurant=other)
    res = admin.get(f"/api/v1/admin/foods?restaurant={r.pk}")
    assert res.status_code == 200, res.json()
    assert [i["id"] for i in res.json()["data"]["items"]] == [str(dish.pk)]
    assert admin.get("/api/v1/admin/foods?restaurant=1").status_code == 422


def test_audit_log_takes_several_resource_ids(admin: APIClient) -> None:
    r = make.restaurant()
    admin.patch(f"{ACCOUNTS}/{r.pk}", {"name": "Renamed Kitchen"}, format="json")
    admin.patch(f"/api/v1/admin/users/{r.owner_id}", {"name": "Renamed Owner"}, format="json")
    make_other = make.restaurant()
    admin.patch(f"{ACCOUNTS}/{make_other.pk}", {"name": "Other Rename"}, format="json")

    def actions(resource_id: str) -> Any:
        return admin.get(f"/api/v1/admin/audit-logs?resourceId={resource_id}")

    res = actions(f"{r.pk},{r.owner_id}")
    assert res.status_code == 200, res.json()
    assert {i["action"] for i in res.json()["data"]["items"]} == {
        "restaurant.update",
        "user.update",
    }
    assert len(actions(str(r.pk)).json()["data"]["items"]) == 1
    too_many = actions(",".join(str(i) for i in range(6)))
    assert too_many.status_code == 422
    assert set(field_errors(too_many)) == {"resourceId"}
    assert actions(",,").status_code == 422
