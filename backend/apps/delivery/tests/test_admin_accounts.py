"""Account management phase 4: delivery partner accounts in the admin panel (list, account page,
edits, verification, taking a rider offline, availability history) and the rider filters on other
admin lists. Fictional data only."""

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
from apps.delivery.models import DeliveryPartner, RiderAvailabilityLog, RiderVehicle
from apps.dispatch.models import AssignmentStatus, DeliveryAssignment
from apps.dispatch.services import sweep
from apps.finance.models import OrderSettlement, Payout
from apps.kyc.models import DocumentStatus, KycDocument, PayoutAccount
from apps.notifications.models import Notification
from apps.orders.models import Order
from apps.orders.tests.test_orders import NEAR, World
from apps.rbac.roles import Role
from apps.reviews.models import Review, ReviewTarget
from tests import factories as make

pytestmark = pytest.mark.django_db

ACCOUNTS = "/api/v1/admin/delivery-partner-accounts"
RIDER_DOCS = ("driving_licence", "vehicle_rc", "id_proof")
ADDRESS = {
    "line1": "7 Imaginary Road",
    "area": "Lakeside",
    "city": "Mysuru",
    "state": "Karnataka",
    "postalCode": "570001",
}


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


def rider(vehicle: tuple[str, str] | None = None, profile: bool = True, **fields: Any) -> User:
    """A rider account; with a profile (`fields` for it) unless profile=False."""
    user_fields = {k: fields.pop(k) for k in ("name", "email", "phone", "status") if k in fields}
    u = make.user(Role.DELIVERY, **user_fields)
    if profile:
        p = DeliveryPartner.objects.create(user=u, **fields)
        if vehicle:
            RiderVehicle.objects.create(
                partner=p, vehicle_type=vehicle[0], vehicle_number=vehicle[1]
            )
    return u


def created(u: User, at: datetime) -> User:
    User.objects.filter(pk=u.pk).update(created_at=at)
    return u


def doc(u: User, kind: str, status: str = DocumentStatus.APPROVED) -> KycDocument:
    return KycDocument.objects.create(
        user=u,
        kind=kind,
        file_name=f"{kind}-{u.pk.hex[:8]}.pdf",
        content_type="application/pdf",
        size=100,
        status=status,
    )


def bank(u: User) -> PayoutAccount:
    return PayoutAccount.objects.create(
        user=u,
        holder_name="Fictional Holder",
        account_number_encrypted="x",
        account_last4="4321",
        ifsc="TEST0001234",
    )


def verified(u: User) -> User:
    for kind in RIDER_DOCS:
        doc(u, kind)
    bank(u)
    return u


def settle(order: Order, rider_paise: int, at: datetime | None = None) -> OrderSettlement:
    return OrderSettlement.objects.create(
        order=order,
        restaurant_paise=20000,
        rider_paise=rider_paise,
        platform_paise=1000,
        settled_at=at or timezone.now(),
    )


# --- the list -----------------------------------------------------------------------------------


def test_list_item_shape(admin: APIClient) -> None:
    u = rider(
        vehicle=("scooter", "KA01AB1234"),
        name="Tarun Brookfield",
        phone="+919000000501",
        zone="Lakeside",
        completed_deliveries=42,
        rating_average=Decimal("4.6"),
        rating_count=21,
        is_online=True,
        verification_status="approved",
    )
    res = admin.get(ACCOUNTS)
    assert res.status_code == 200, res.json()
    data = res.json()["data"]
    assert data["pagination"] == {"page": 1, "limit": 20, "total": 1, "totalPages": 1}
    assert data["items"] == [
        {
            "id": str(u.pk),
            "name": "Tarun Brookfield",
            "email": u.email,
            "phone": "+919000000501",
            "avatarUrl": None,
            "status": "active",
            "statusReason": None,
            "createdAt": data["items"][0]["createdAt"],
            "verificationStatus": "approved",
            "isOnline": True,
            "busy": False,
            "vehicleType": "scooter",
            "vehicleNumber": "KA01AB1234",
            "zone": "Lakeside",
            "completedDeliveries": 42,
            "rating": {"average": 4.6, "count": 21},
            "kycStatus": "incomplete",
        }
    ]


def test_a_rider_without_a_profile_is_listed_with_defaults(admin: APIClient) -> None:
    u = rider(profile=False)
    item = admin.get(ACCOUNTS).json()["data"]["items"][0]
    assert item["id"] == str(u.pk)
    assert {k: item[k] for k in ("verificationStatus", "isOnline", "busy", "vehicleType")} == {
        "verificationStatus": "pending",
        "isOnline": False,
        "busy": False,
        "vehicleType": None,
    }
    assert item["rating"] == {"average": 0.0, "count": 0}
    assert item["zone"] is None


def test_filters(admin: APIClient) -> None:
    free = rider(vehicle=("scooter", "KA01AA0001"), is_online=True, zone="Lakeside")
    busy = rider(vehicle=("car", "KA01AA0002"), is_online=True, zone="lakeside ")
    order = make.order(delivery_partner=busy, status="picked_up")
    DeliveryPartner.objects.filter(user=busy).update(active_order=order)
    off = rider(vehicle=("bicycle", "KA01AA0003"), verification_status="rejected", zone="Hill Town")
    nothing = rider(profile=False)
    suspended = rider(status=UserStatus.SUSPENDED, verification_status="approved")
    make.user(Role.CUSTOMER)  # never listed

    def found(q: str) -> set[str]:
        return set(ids(admin.get(f"{ACCOUNTS}?{q}")))

    assert found("availability=online") == {str(free.pk)}
    assert found("availability=busy") == {str(busy.pk)}
    assert found("availability=offline") == {str(off.pk), str(nothing.pk), str(suspended.pk)}
    item = next(i for i in admin.get(ACCOUNTS).json()["data"]["items"] if i["id"] == str(busy.pk))
    assert item["busy"] is True
    assert item["isOnline"] is True
    assert found("accountStatus=suspended") == {str(suspended.pk)}
    assert found("verification=rejected") == {str(off.pk)}
    assert found("verification=approved") == {str(suspended.pk)}
    assert found("verification=pending") == {str(free.pk), str(busy.pk), str(nothing.pk)}
    assert found("zone=LAKESIDE") == {str(free.pk), str(busy.pk)}
    assert found("zone=Lake") == set()  # exact, not contains
    assert found("vehicleType=car") == {str(busy.pk)}

    bad = admin.get(
        f"{ACCOUNTS}?accountStatus=gone&verification=maybe&availability=away"
        "&kyc=unknown&vehicleType=rocket&sort=best"
    )
    assert bad.status_code == 422
    assert field_errors(bad) == {
        "accountStatus": "Invalid value",
        "verification": "Invalid value",
        "availability": "Invalid value",
        "kyc": "Invalid value",
        "vehicleType": "Invalid value",
        "sort": "Invalid value",
    }
    assert set(field_errors(admin.get(f"{ACCOUNTS}?unknown=1&limit=0"))) == {"limit"}


def test_kyc_states(admin: APIClient) -> None:
    ok = verified(rider(name="All Good"))
    nothing = rider(name="Nothing Yet")
    no_bank = rider(name="No Bank")
    for kind in RIDER_DOCS:
        doc(no_bank, kind)
    waiting = rider(name="Waiting")
    doc(waiting, "driving_licence", DocumentStatus.PENDING)
    doc(waiting, "vehicle_rc")
    doc(waiting, "id_proof")
    bank(waiting)
    refused = rider(name="Refused")
    doc(refused, "vehicle_rc", DocumentStatus.REJECTED)  # rejected wins over missing ones

    def state(kyc: str) -> set[str]:
        return set(ids(admin.get(f"{ACCOUNTS}?kyc={kyc}")))

    assert state("verified") == {str(ok.pk)}
    assert state("incomplete") == {str(nothing.pk), str(no_bank.pk)}
    assert state("pending") == {str(waiting.pk)}
    assert state("rejected") == {str(refused.pk)}

    def kyc(u: User) -> Any:
        return admin.get(f"{ACCOUNTS}/{u.pk}").json()["data"]["kyc"]

    assert kyc(nothing) == {"status": "incomplete", "missing": list(RIDER_DOCS)}
    assert kyc(no_bank) == {"status": "incomplete", "missing": []}
    assert kyc(waiting) == {"status": "pending", "missing": []}
    assert kyc(ok) == {"status": "verified", "missing": []}
    assert kyc(refused) == {"status": "rejected", "missing": ["driving_licence", "id_proof"]}


def test_search_forms(admin: APIClient) -> None:
    u = rider(
        vehicle=("motorbike", "KA 05 MX 4321"),
        name="Ilsa Quillmore",
        email="ilsa.q@bitebox.test",
        phone="+919000000512",
    )
    rider(vehicle=("scooter", "KA05MY0001"), name="Someone Else")

    for term in (
        "ilsa%20QUILL",
        "ilsa.q@",
        "9000000512",
        "%2B91%2090000%2000512",
        "ka05mx",
        "KA%2005%20MX%2043",
        "mx%204321",
        str(u.pk),
        "%23" + u.pk.hex[-8:].upper(),
        u.pk.hex[-6:],
    ):
        assert ids(admin.get(f"{ACCOUNTS}?search={term}")) == [str(u.pk)], term
    assert ids(admin.get(f"{ACCOUNTS}?search=nobody-here")) == []
    assert "search" in field_errors(admin.get(f"{ACCOUNTS}?search={'x' * 101}"))


@override_settings(REPORT_TIMEZONE="Asia/Kolkata")
def test_joined_dates_are_whole_days_in_the_report_time_zone(admin: APIClient) -> None:
    late = created(rider(), datetime(2026, 3, 9, 18, 29, tzinfo=UTC))
    early = created(rider(), datetime(2026, 3, 9, 18, 31, tzinfo=UTC))
    assert ids(admin.get(f"{ACCOUNTS}?joinedTo=2026-03-09")) == [str(late.pk)]
    assert ids(admin.get(f"{ACCOUNTS}?joinedFrom=2026-03-10&joinedTo=2026-03-10")) == [
        str(early.pk)
    ]
    bad = admin.get(f"{ACCOUNTS}?joinedFrom=2026-03-10&joinedTo=2026-03-09")
    assert set(field_errors(bad)) == {"joinedTo"}


def test_sorts_and_pagination(admin: APIClient) -> None:
    now = timezone.now()
    a = created(
        rider(
            name="birch Rider",
            completed_deliveries=30,
            rating_average=Decimal("4.5"),
            rating_count=3,
        ),
        now - timedelta(days=3),
    )
    b = created(
        rider(
            name="Alder Rider",
            completed_deliveries=5,
            rating_average=Decimal("4.5"),
            rating_count=9,
        ),
        now - timedelta(days=2),
    )
    c = created(
        rider(
            name="Cypress Rider",
            completed_deliveries=12,
            rating_average=Decimal("3.9"),
            rating_count=50,
        ),
        now - timedelta(days=1),
    )
    d = rider(profile=False, name="Dogwood Rider")  # newest; no deliveries, no rating

    def order(sort: str) -> list[str]:
        return ids(admin.get(f"{ACCOUNTS}?sort={sort}"))

    assert order("newest") == [str(d.pk), str(c.pk), str(b.pk), str(a.pk)]
    assert order("oldest") == [str(a.pk), str(b.pk), str(c.pk), str(d.pk)]
    assert order("name") == [str(b.pk), str(a.pk), str(c.pk), str(d.pk)]
    assert order("deliveries") == [str(a.pk), str(c.pk), str(b.pk), str(d.pk)]
    assert order("rating") == [str(b.pk), str(a.pk), str(c.pk), str(d.pk)]

    page = admin.get(f"{ACCOUNTS}?sort=deliveries&page=2&limit=3").json()["data"]
    assert [i["id"] for i in page["items"]] == [str(d.pk)]
    assert page["pagination"] == {"page": 2, "limit": 3, "total": 4, "totalPages": 2}
    assert admin.get(f"{ACCOUNTS}?limit=101").status_code == 422


def test_zones_are_distinct_trimmed_and_sorted(admin: APIClient) -> None:
    for zone in ("Lakeside", " lakeside ", "Hill Town", "airport", None, "  "):
        rider(zone=zone)
    res = admin.get(f"{ACCOUNTS}/zones")
    assert res.status_code == 200, res.json()
    assert res.json()["data"] == {"zones": ["airport", "Hill Town", "Lakeside"]}


def test_view_needs_riders_view() -> None:
    u = rider()
    no = operator("restaurants:view")
    for url in (
        ACCOUNTS,
        f"{ACCOUNTS}/zones",
        f"{ACCOUNTS}/{u.pk}",
        f"{ACCOUNTS}/{u.pk}/availability",
    ):
        assert no.get(url).status_code == 403, url
    yes = operator("riders:view")
    for url in (
        ACCOUNTS,
        f"{ACCOUNTS}/zones",
        f"{ACCOUNTS}/{u.pk}",
        f"{ACCOUNTS}/{u.pk}/availability",
    ):
        assert yes.get(url).status_code == 200, url
    assert yes.patch(f"{ACCOUNTS}/{u.pk}", {"zone": "Lakeside"}, format="json").status_code == 403


# --- the account page ---------------------------------------------------------------------------


def test_detail_stats_profile_and_contact(admin: APIClient) -> None:
    u = rider(
        vehicle=("scooter", "KA01ZZ0001"),
        zone="Lakeside",
        emergency_contact={"name": "Nila Brookfield", "phone": "+919000000599"},
        rating_average=Decimal("4.2"),
        rating_count=8,
    )
    first, last = (make.order(delivery_partner=u, status="delivered") for _ in range(2))
    settle(first, 3200, timezone.now() - timedelta(days=2))
    newest = settle(last, 2800)
    make.order(delivery_partner=u, status="cancelled")
    make.order(delivery_partner=u, status="on_the_way")
    other = make.order(delivery_partner=rider(), status="delivered")  # someone else's
    settle(other, 9999)

    res = admin.get(f"{ACCOUNTS}/{u.pk}")
    assert res.status_code == 200, res.json()
    data = res.json()["data"]
    assert data["user"]["id"] == str(u.pk)
    assert data["user"]["role"] == "delivery"
    profile = admin.get(f"/api/v1/admin/delivery-partners/{u.pk}").json()["data"]["profile"]
    assert data["rider"] == {
        **profile,
        "emergencyContact": {"name": "Nila Brookfield", "phone": "+919000000599", "relation": None},
        "zone": "Lakeside",
    }
    stats = data["stats"]
    assert {k: stats[k] for k in ("deliveries", "cancelled", "earningsPaise")} == {
        "deliveries": 2,
        "cancelled": 1,
        "earningsPaise": 6000,
    }
    assert datetime.fromisoformat(stats["lastDeliveryAt"]) == newest.settled_at
    assert stats["rating"] == {"average": 4.2, "count": 8}

    blank = admin.get(f"{ACCOUNTS}/{rider(profile=False).pk}").json()["data"]
    assert blank["stats"] == {
        "deliveries": 0,
        "cancelled": 0,
        "earningsPaise": 0,
        "lastDeliveryAt": None,
        "rating": {"average": 0.0, "count": 0},
    }
    assert blank["rider"]["emergencyContact"] is None
    assert blank["rider"]["zone"] is None


def test_detail_unknown_non_rider_and_malformed_ids(admin: APIClient) -> None:
    for who in (
        make.user(Role.CUSTOMER).pk,
        make.user(Role.ADMIN).pk,
        "0" * 8 + "-0000-7000-8000-" + "0" * 12,
    ):
        res = admin.get(f"{ACCOUNTS}/{who}")
        assert res.status_code == 404, who
        assert res.json()["message"] == "Delivery partner not found"
    bad = admin.get(f"{ACCOUNTS}/123")
    assert bad.status_code == 422
    assert set(field_errors(bad)) == {"id"}


# --- edits ----------------------------------------------------------------------------------------


def test_edit_details_contact_zone_and_audit(admin: APIClient) -> None:
    u = rider(vehicle=("scooter", "KA01AB1234"), name="Old Name", phone="+919000000520")
    email = u.email
    res = admin.patch(
        f"{ACCOUNTS}/{u.pk}",
        {
            "name": "Ravi Kestrel",
            "gender": "male",
            "birthDate": "1995-04-12",
            "address": ADDRESS,
            "emergencyContact": {
                "name": "Mina Kestrel",
                "phone": "9000000521",
                "relation": "Sister",
            },
            "zone": "  Lakeside ",
            "vehicleType": "motorbike",
            # dropped
            "email": "new@bitebox.test",
            "phone": "+919000000999",
            "password": "Another-pass-1",
            "status": "blocked",
            "role": "admin",
        },
        format="json",
    )
    assert res.status_code == 200, res.json()
    assert res.json()["message"] == "Delivery partner updated"
    data = res.json()["data"]
    assert data["user"]["name"] == "Ravi Kestrel"
    assert data["rider"]["address"] == ADDRESS
    assert data["rider"]["emergencyContact"] == {
        "name": "Mina Kestrel",
        "phone": "9000000521",
        "relation": "Sister",
    }
    assert data["rider"]["zone"] == "Lakeside"
    assert data["rider"]["vehicleType"] == "motorbike"
    assert data["rider"]["vehicleNumber"] == "KA01AB1234"  # kept
    u.refresh_from_db()
    assert (u.email, u.phone, u.status, u.role) == (email, "+919000000520", "active", "delivery")

    entry = AuditLog.objects.get(action="rider.update")
    assert entry.resource_type == "user"
    assert entry.resource_id == str(u.pk)
    assert entry.account_type == "delivery"
    assert entry.description == "Updated delivery partner details"
    assert entry.changes == {
        "name": {"from": "Old Name", "to": "Ravi Kestrel"},
        "gender": {"from": None, "to": "male"},
        "birthDate": {"from": None, "to": "1995-04-12"},
        "address.line1": {"from": None, "to": "7 Imaginary Road"},
        "address.area": {"from": None, "to": "Lakeside"},
        "address.city": {"from": None, "to": "Mysuru"},
        "address.state": {"from": None, "to": "Karnataka"},
        "address.postalCode": {"from": None, "to": "570001"},
        "emergencyContact": {
            "from": None,
            "to": {"name": "Mina Kestrel", "phone": "9000000521", "relation": "Sister"},
        },
        "zone": {"from": None, "to": "Lakeside"},
        "vehicleType": {"from": "scooter", "to": "motorbike"},
    }

    # the same values again: nothing changes, nothing is recorded
    same = admin.patch(
        f"{ACCOUNTS}/{u.pk}",
        {"name": "Ravi Kestrel", "address": ADDRESS, "zone": "lakeside".title(), "email": "x@y.z"},
        format="json",
    )
    assert same.status_code == 200, same.json()
    assert AuditLog.objects.filter(action="rider.update").count() == 1

    # clearing the contact and the zone
    res = admin.patch(f"{ACCOUNTS}/{u.pk}", {"emergencyContact": None, "zone": None}, format="json")
    assert res.status_code == 200, res.json()
    assert res.json()["data"]["rider"]["emergencyContact"] is None
    assert res.json()["data"]["rider"]["zone"] is None
    cleared = AuditLog.objects.filter(action="rider.update").order_by("-created_at").first()
    assert cleared is not None
    assert cleared.changes["zone"] == {"from": "Lakeside", "to": None}
    assert cleared.changes["emergencyContact"]["to"] is None


def test_edit_reuses_the_existing_rules(admin: APIClient) -> None:
    u = rider()
    url = f"{ACCOUNTS}/{u.pk}"
    bad = admin.patch(
        url,
        {
            "name": "X",
            "gender": "robot",
            "birthDate": "12/04/1995",
            "address": {"line1": "7 Imaginary Road", "state": "Karnataka", "postalCode": "!"},
            "emergencyContact": {"name": "Mina", "phone": "12"},
            "vehicleType": "rocket",
            "vehicleNumber": "#",
            "zone": "z" * 61,
        },
        format="json",
    )
    assert bad.status_code == 422
    errors = field_errors(bad)
    assert errors["name"] == "Name must be 2-80 characters"
    assert errors["vehicleType"] == "Vehicle must be one of: bicycle, scooter, motorbike, car"
    assert errors["vehicleNumber"] == "Enter a valid vehicle number"
    assert errors["address.city"] == "City is required"
    assert errors["address.postalCode"] == "Enter a valid postal code"
    assert errors["emergencyContact.phone"] == "Enter a valid phone number (10-15 digits)"
    assert {"gender", "birthDate", "zone"} <= set(errors)
    no_phone = admin.patch(url, {"emergencyContact": {"name": "Mina"}}, format="json")
    assert set(field_errors(no_phone)) == {"emergencyContact.phone"}
    # a number alone needs a vehicle type when the rider has no vehicle yet
    alone = admin.patch(url, {"vehicleNumber": "KA01AB1234"}, format="json")
    assert alone.status_code == 422
    assert set(field_errors(alone)) == {"vehicleType"}
    photo = admin.patch(url, {"avatarUrl": "https://elsewhere.test/a.png"}, format="json")
    assert photo.status_code == 400
    assert not AuditLog.objects.filter(action="rider.update").exists()


def test_new_vehicle_number_sends_an_approved_rc_back_for_review(admin: APIClient) -> None:
    u = verified(rider(vehicle=("scooter", "KA01AB1234"), verification_status="approved"))
    res = admin.patch(f"{ACCOUNTS}/{u.pk}", {"vehicleNumber": " ka 01 cd 5678 "}, format="json")
    assert res.status_code == 200, res.json()
    data = res.json()["data"]
    assert data["rider"]["vehicleNumber"] == "KA 01 CD 5678"
    assert data["rider"]["verification"]["status"] == "approved"  # unchanged
    assert data["kyc"]["status"] == "pending"
    statuses = dict(KycDocument.objects.filter(user=u).values_list("kind", "status"))
    assert statuses == {
        "driving_licence": "approved",
        "vehicle_rc": "pending",
        "id_proof": "approved",
    }
    entry = AuditLog.objects.get(action="rider.update")
    assert entry.changes == {
        "vehicleNumber": {"from": "KA01AB1234", "to": "KA 01 CD 5678"},
        "reverified": ["vehicle_rc"],
    }
    # the type alone does not touch the documents
    doc_rc = KycDocument.objects.get(user=u, kind="vehicle_rc")
    KycDocument.objects.filter(pk=doc_rc.pk).update(status="approved")
    admin.patch(f"{ACCOUNTS}/{u.pk}", {"vehicleType": "car"}, format="json")
    assert KycDocument.objects.get(pk=doc_rc.pk).status == "approved"


def test_edit_needs_riders_edit() -> None:
    u = rider()
    url = f"{ACCOUNTS}/{u.pk}"
    assert (
        operator("riders:view").patch(url, {"zone": "Lakeside"}, format="json").status_code == 403
    )
    assert (
        operator("riders:edit").patch(url, {"zone": "Lakeside"}, format="json").status_code == 200
    )


# --- verification ---------------------------------------------------------------------------------


def test_verification_reuses_the_review(admin: APIClient) -> None:
    u = rider(is_online=True, vehicle=("scooter", "KA01AB1234"))
    url = f"{ACCOUNTS}/{u.pk}/verification"

    missing = admin.patch(url, {"status": "rejected"}, format="json")
    assert missing.status_code == 422
    assert set(field_errors(missing)) == {"reason"}
    assert set(
        field_errors(admin.patch(url, {"status": "rejected", "reason": "no"}, format="json"))
    ) == {"reason"}
    assert set(field_errors(admin.patch(url, {"status": "pending"}, format="json"))) == {"status"}

    res = admin.patch(url, {"status": "approved"}, format="json")
    assert res.status_code == 200, res.json()
    assert res.json()["message"] == "Delivery partner approved"
    assert res.json()["data"]["rider"]["verification"]["status"] == "approved"
    entry = AuditLog.objects.get(action="rider.verification")
    assert entry.changes == {"verificationStatus": {"from": "pending", "to": "approved"}}
    assert entry.account_type == "delivery"
    assert Notification.objects.filter(user=u, type="rider.verified").exists()

    again = admin.patch(url, {"status": "approved"}, format="json")
    assert again.status_code == 200
    assert AuditLog.objects.filter(action="rider.verification").count() == 1

    # approved → rejected is not one of the existing transitions
    assert (
        admin.patch(
            url, {"status": "rejected", "reason": "Fake licence"}, format="json"
        ).status_code
        == 409
    )

    res = admin.patch(
        url, {"status": "resubmission_requested", "reason": "Licence expired"}, format="json"
    )
    assert res.status_code == 200, res.json()
    assert res.json()["message"] == "Asked for documents"
    latest = AuditLog.objects.filter(action="rider.verification").order_by("-created_at").first()
    assert latest is not None
    assert latest.reason == "Licence expired"
    # no longer allowed online: the system took them offline
    assert res.json()["data"]["rider"]["isOnline"] is False
    row = RiderAvailabilityLog.objects.get(rider=u)
    assert (row.is_online, row.source, row.reason) == (False, "system", "Documents requested again")

    res = admin.patch(url, {"status": "rejected", "reason": "Licence not renewed"}, format="json")
    assert res.json()["message"] == "Delivery partner rejected"


def test_verification_keeps_the_kyc_check(admin: APIClient, settings: Any) -> None:
    settings.RIDER_KYC_REQUIRED = True
    u = rider()
    res = admin.patch(f"{ACCOUNTS}/{u.pk}/verification", {"status": "approved"}, format="json")
    assert res.status_code == 409
    assert res.json()["error"]["code"] == "KYC_INCOMPLETE"
    assert not AuditLog.objects.filter(action="rider.verification").exists()


def test_verification_needs_riders_approve() -> None:
    u = rider()
    url = f"{ACCOUNTS}/{u.pk}/verification"
    body = {"status": "approved"}
    assert (
        operator("riders:edit", "riders:status").patch(url, body, format="json").status_code == 403
    )
    assert operator("riders:approve").patch(url, body, format="json").status_code == 200


# --- availability ---------------------------------------------------------------------------------


@pytest.fixture
def w() -> World:
    return World()


def test_taking_a_rider_offline_releases_the_offer(w: World, admin: APIClient) -> None:
    rider_id = w.rider["user"]["id"]
    url = f"{ACCOUNTS}/{rider_id}/availability"
    assert w.go_online(w.r, NEAR).status_code == 200
    order_id = w.ready_order()
    assert w.offer_id(w.r) == order_id

    online = admin.patch(url, {"isOnline": True, "reason": "Back to work"}, format="json")
    assert online.status_code == 422
    assert field_errors(online) == {"isOnline": "Only the rider can go online"}
    assert set(field_errors(admin.patch(url, {"isOnline": False}, format="json"))) == {"reason"}

    res = admin.patch(url, {"isOnline": False, "reason": "Phone unreachable"}, format="json")
    assert res.status_code == 200, res.json()
    assert res.json()["message"] == "Delivery partner taken offline"
    assert res.json()["data"]["rider"]["isOnline"] is False
    assert res.json()["data"]["rider"]["currentOffer"] is None
    assert DeliveryAssignment.objects.get(order_id=order_id, rider_id=rider_id).status == (
        AssignmentStatus.DECLINED
    )
    entry = AuditLog.objects.get(action="rider.availability")
    assert entry.changes == {"isOnline": {"from": True, "to": False}}
    assert entry.reason == "Phone unreachable"
    assert entry.account_type == "delivery"

    history = admin.get(url).json()["data"]
    assert [(i["isOnline"], i["source"], i["reason"]) for i in history["items"]] == [
        (False, "admin", "Phone unreachable"),
        (True, "rider", None),
    ]

    # already offline: nothing to do, nothing recorded
    again = admin.patch(url, {"isOnline": False, "reason": "Phone unreachable"}, format="json")
    assert again.status_code == 200
    assert AuditLog.objects.filter(action="rider.availability").count() == 1
    assert RiderAvailabilityLog.objects.filter(rider_id=rider_id).count() == 2


def test_a_rider_on_a_delivery_stays_online(w: World, admin: APIClient) -> None:
    rider_id = w.rider["user"]["id"]
    w.go_online(w.r, NEAR)
    order_id = w.ready_order()
    assert w.accept(w.r, order_id).status_code == 200
    res = admin.patch(
        f"{ACCOUNTS}/{rider_id}/availability",
        {"isOnline": False, "reason": "Phone unreachable"},
        format="json",
    )
    assert res.status_code == 409
    assert res.json()["message"] == "The rider is on a delivery"
    assert DeliveryPartner.objects.get(user_id=rider_id).is_online is True
    assert not AuditLog.objects.filter(action="rider.availability").exists()
    assert ids(admin.get(f"{ACCOUNTS}?availability=busy")) == [rider_id]


def test_history_records_the_rider_admins_and_the_system(w: World, admin: APIClient) -> None:
    rider_id = w.rider["user"]["id"]
    url = f"{ACCOUNTS}/{rider_id}/availability"
    w.go_online(w.r, NEAR)
    w.go_online(w.r, NEAR)  # already online: no second row
    w.r.patch("/api/v1/delivery/me/availability", {"isOnline": False}, format="json")
    w.r.patch("/api/v1/delivery/me/availability", {"isOnline": False}, format="json")
    w.go_online(w.r, NEAR)
    # a missed offer: the sweep takes the rider offline
    order_id = w.ready_order()
    assert w.offer_id(w.r) == order_id
    sweep(timezone.now() + timedelta(minutes=2))
    w.go_online(w.r, NEAR)
    suspended = admin.patch(
        f"/api/v1/admin/users/{rider_id}/status",
        {"status": "suspended", "reason": "Repeated complaints"},
        format="json",
    )
    assert suspended.status_code == 200, suspended.json()

    res = admin.get(url)
    assert res.status_code == 200, res.json()
    items = res.json()["data"]["items"]
    assert [(i["isOnline"], i["source"], i["reason"]) for i in items] == [
        (False, "system", "Account suspended"),
        (True, "rider", None),
        (False, "system", "Did not answer a delivery offer"),
        (True, "rider", None),
        (False, "rider", None),
        (True, "rider", None),
    ]
    assert sorted(items[0]) == ["at", "isOnline", "reason", "source"]
    page = admin.get(f"{url}?limit=2&page=2").json()["data"]
    assert [i["reason"] for i in page["items"]] == ["Did not answer a delivery offer", None]
    assert page["pagination"] == {"page": 2, "limit": 2, "total": 6, "totalPages": 3}


def test_availability_needs_riders_status() -> None:
    u = rider(is_online=True)
    url = f"{ACCOUNTS}/{u.pk}/availability"
    body = {"isOnline": False, "reason": "Phone unreachable"}
    assert operator("riders:view", "riders:edit").patch(url, body, format="json").status_code == 403
    assert operator("riders:status").patch(url, body, format="json").status_code == 200
    assert operator("riders:status").get(url).status_code == 403
    missing = make.user(Role.CUSTOMER)
    assert operator("riders:view").get(f"{ACCOUNTS}/{missing.pk}/availability").status_code == 404


# --- rider filters on other admin lists ---------------------------------------------------------


def test_orders_filter_by_rider(admin: APIClient) -> None:
    u = rider()
    mine = [make.order(delivery_partner=u, status=s) for s in ("delivered", "cancelled")]
    make.order(delivery_partner=rider())
    make.order()
    res = admin.get(f"/api/v1/admin/orders?rider={u.pk}")
    assert res.status_code == 200, res.json()
    assert {i["id"] for i in res.json()["data"]["items"]} == {str(o.pk) for o in mine}
    bad = admin.get("/api/v1/admin/orders?rider=123")
    assert bad.status_code == 422
    assert set(field_errors(bad)) == {"rider"}


def test_payouts_filter_by_rider(admin: APIClient) -> None:
    u, other = rider(), rider()
    by = make.user(Role.ADMIN)

    def payout(payee: User) -> Payout:
        return Payout.objects.create(
            type="rider", payee=payee, payee_name=payee.name, amount_paise=5000, created_by=by
        )

    mine = payout(u)
    payout(other)
    res = admin.get(f"/api/v1/admin/finance/payouts?rider={u.pk}")
    assert res.status_code == 200, res.json()
    assert [i["id"] for i in res.json()["data"]["items"]] == [str(mine.pk)]
    bad = admin.get("/api/v1/admin/finance/payouts?rider=1")
    assert bad.status_code == 422
    assert set(field_errors(bad)) == {"rider"}


def test_reviews_filter_by_rider(admin: APIClient) -> None:
    u, other = rider(), rider()
    rated = make.order(delivery_partner=u, status="delivered")
    food_only = make.order(delivery_partner=u, status="delivered")
    elsewhere = make.order(delivery_partner=other, status="delivered")

    def review(order: Order, target: str) -> None:
        Review.objects.create(
            target=target,
            customer=order.customer,
            customer_name=order.customer.name,
            order=order,
            order_number=order.order_number,
            restaurant=order.restaurant,
            delivery_partner=order.delivery_partner if target == ReviewTarget.RIDER else None,
            rating=4,
            comment="Quick and polite.",
        )

    review(rated, ReviewTarget.RIDER)
    review(food_only, ReviewTarget.RESTAURANT)
    review(elsewhere, ReviewTarget.RIDER)
    res = admin.get(f"/api/v1/admin/reviews/orders?rider={u.pk}")
    assert res.status_code == 200, res.json()
    assert [i["orderNumber"] for i in res.json()["data"]["items"]] == [rated.order_number]
    bad = admin.get("/api/v1/admin/reviews/orders?rider=1")
    assert bad.status_code == 422
    assert set(field_errors(bad)) == {"rider"}
