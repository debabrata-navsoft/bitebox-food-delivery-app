"""Global filters, phase A: multi-value filters and `?facets=1` counts on the admin account lists
(customers, restaurant accounts, rider accounts, admins, audit log). Fictional data only."""

from typing import Any

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.accounts.tokens import sign_access_token
from apps.audit.models import AuditLog
from apps.delivery.models import DeliveryPartner, RiderVehicle
from apps.kyc.models import DocumentStatus, KycDocument, PayoutAccount
from apps.rbac.roles import Role
from tests import factories as make

pytestmark = pytest.mark.django_db

CUSTOMERS = "/api/v1/admin/customers"
RESTAURANTS = "/api/v1/admin/restaurant-accounts"
RIDERS = "/api/v1/admin/delivery-partner-accounts"
ADMINS = "/api/v1/admin/admins"
AUDIT = "/api/v1/admin/audit-logs"


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


# --- customers ----------------------------------------------------------------------------------


def customer(status: str = "active", email: bool = False, phone: bool = False) -> User:
    now = timezone.now()
    return make.user(
        status=status,
        email_verified_at=now if email else None,
        phone_verified_at=now if phone else None,
    )


def test_customers_multi_value_filters_and_facets(admin: APIClient) -> None:
    a = customer("active", email=True)
    b = customer("suspended", phone=True)
    c = customer("inactive")
    d = customer("active", email=True, phone=True)
    make.user(Role.RESTAURANT)  # not a customer

    assert ids(admin.get(f"{CUSTOMERS}?status=active,suspended")) == {
        str(a.pk),
        str(b.pk),
        str(d.pk),
    }
    assert ids(admin.get(f"{CUSTOMERS}?status=inactive")) == {str(c.pk)}  # one value as before
    assert ids(admin.get(f"{CUSTOMERS}?status=,inactive,")) == {str(c.pk)}  # empty items ignored
    # verification values combine with OR
    assert ids(admin.get(f"{CUSTOMERS}?verification=email_verified,phone_verified")) == {
        str(a.pk),
        str(b.pk),
        str(d.pk),
    }
    # and AND across fields
    assert ids(admin.get(f"{CUSTOMERS}?status=active&verification=phone_verified")) == {str(d.pk)}

    plain = data(admin.get(f"{CUSTOMERS}?status=active"))
    assert "facets" not in plain

    res = admin.get(f"{CUSTOMERS}?status=active&verification=email_verified&facets=1&limit=1")
    page = data(res)
    assert page["pagination"]["total"] == 2  # a and d
    assert len(page["items"]) == 1
    assert list(page["facets"]) == ["status", "verification"]
    # status counts ignore the status selection but apply verification=email_verified
    assert page["facets"]["status"] == [
        {"value": "active", "count": 2},
        {"value": "inactive", "count": 0},
        {"value": "suspended", "count": 0},
        {"value": "blocked", "count": 0},
    ]
    # verification counts ignore their own selection but apply status=active
    assert page["facets"]["verification"] == [
        {"value": "email_verified", "count": 2},
        {"value": "email_unverified", "count": 0},
        {"value": "phone_verified", "count": 1},
        {"value": "phone_unverified", "count": 1},
    ]


def test_customers_invalid_items(admin: APIClient) -> None:
    res = admin.get(f"{CUSTOMERS}?status=active,gone&verification=email_verified,x&facets=maybe")
    assert field_errors(res) == {
        "status": "Invalid value",
        "verification": "Invalid value",
        "facets": "Invalid value",
    }


# --- restaurant accounts ------------------------------------------------------------------------


def verified_restaurant(**fields: Any) -> Any:
    r = make.restaurant(**fields)
    for kind in ("fssai_licence", "pan_card", "cancelled_cheque"):
        KycDocument.objects.create(
            user=r.owner,
            kind=kind,
            file_name=f"{kind}.pdf",
            content_type="application/pdf",
            size=100,
            status=DocumentStatus.APPROVED,
        )
    PayoutAccount.objects.create(
        user=r.owner,
        holder_name="Fictional Holder",
        account_number_encrypted="x",
        account_last4="4321",
        ifsc="TEST0001234",
    )
    return r


def test_restaurant_accounts_multi_value_filters_and_facets(admin: APIClient) -> None:
    live = verified_restaurant(city="Mysuru")
    waiting = make.restaurant(city=" mysuru ", status="pending")
    barred = make.restaurant(
        city="Hubballi", status="suspended", owner=make.user(Role.RESTAURANT, status="suspended")
    )
    other = make.restaurant(city="Udupi")

    assert ids(admin.get(f"{RESTAURANTS}?status=pending,suspended")) == {
        str(waiting.pk),
        str(barred.pk),
    }
    assert ids(admin.get(f"{RESTAURANTS}?city=MYSURU,udupi")) == {
        str(live.pk),
        str(waiting.pk),
        str(other.pk),
    }
    assert ids(admin.get(f"{RESTAURANTS}?kyc=verified,rejected")) == {str(live.pk)}
    assert ids(admin.get(f"{RESTAURANTS}?accountStatus=suspended,blocked")) == {str(barred.pk)}

    res = admin.get(f"{RESTAURANTS}?status=approved&city=mysuru&facets=1")
    page = data(res)
    assert page["pagination"]["total"] == 1
    assert list(page["facets"]) == ["status", "accountStatus", "kyc", "city"]
    # status: every value, counted over the Mysuru restaurants (its own selection left out)
    assert counts(res, "status") == {
        "pending": 1,
        "approved": 1,
        "rejected": 0,
        "suspended": 0,
        "resubmission_requested": 0,
    }
    assert [f["value"] for f in page["facets"]["status"]] == [
        "pending",
        "approved",
        "rejected",
        "suspended",
        "resubmission_requested",
    ]
    assert counts(res, "kyc") == {"verified": 1, "pending": 0, "incomplete": 0, "rejected": 0}
    assert counts(res, "accountStatus") == {
        "active": 1,
        "inactive": 0,
        "suspended": 0,
        "blocked": 0,
    }
    # city: the cities of approved restaurants, by count then name, any letter case merged
    assert page["facets"]["city"] == [
        {"value": "Mysuru", "count": 1},
        {"value": "Udupi", "count": 1},
    ]
    all_cities = data(admin.get(f"{RESTAURANTS}?facets=1"))["facets"]["city"]
    assert all_cities[0] == {"value": "Mysuru", "count": 2}  # "Mysuru" and " mysuru "
    assert [c["value"] for c in all_cities[1:]] == ["Hubballi", "Udupi"]

    assert field_errors(admin.get(f"{RESTAURANTS}?status=approved,closed&kyc=maybe")) == {
        "status": "Invalid value",
        "kyc": "Invalid value",
    }
    assert field_errors(admin.get(f"{RESTAURANTS}?city={'x' * 61}")) == {"city": "Invalid value"}


def test_open_facets_list_at_most_50_values(admin: APIClient) -> None:
    for n in range(52):
        make.restaurant(city=f"Town {n:02d}")
    make.restaurant(city="Town 51")
    cities = data(admin.get(f"{RESTAURANTS}?facets=1&limit=1"))["facets"]["city"]
    assert len(cities) == 50
    assert cities[0] == {"value": "Town 51", "count": 2}
    assert [c["value"] for c in cities[1:3]] == ["Town 00", "Town 01"]


# --- rider accounts -----------------------------------------------------------------------------


def rider(vehicle: str | None = None, profile: bool = True, **fields: Any) -> User:
    user_fields = {k: fields.pop(k) for k in ("status",) if k in fields}
    u = make.user(Role.DELIVERY, **user_fields)
    if profile:
        p = DeliveryPartner.objects.create(user=u, **fields)
        if vehicle:
            RiderVehicle.objects.create(partner=p, vehicle_type=vehicle, vehicle_number="KA01X1")
    return u


def test_rider_accounts_multi_value_filters_and_facets(admin: APIClient) -> None:
    free = rider("scooter", zone="Lakeside", verification_status="approved", is_online=True)
    off = rider("car", zone="lakeside ", verification_status="approved")
    refused = rider("scooter", zone="Hilltop", verification_status="rejected")
    new = rider(profile=False)  # no profile yet: pending and offline
    barred = rider(status="suspended", verification_status="pending")

    assert ids(admin.get(f"{RIDERS}?verification=pending,rejected")) == {
        str(refused.pk),
        str(new.pk),
        str(barred.pk),
    }
    assert ids(admin.get(f"{RIDERS}?vehicleType=car,bicycle")) == {str(off.pk)}
    assert ids(admin.get(f"{RIDERS}?zone=LAKESIDE,hilltop&availability=offline")) == {
        str(off.pk),
        str(refused.pk),
    }
    assert ids(admin.get(f"{RIDERS}?accountStatus=active,inactive&availability=online,busy")) == {
        str(free.pk)
    }

    res = admin.get(f"{RIDERS}?verification=approved&vehicleType=scooter&facets=1")
    page = data(res)
    assert page["pagination"]["total"] == 1
    assert list(page["facets"]) == [
        "verification",
        "availability",
        "kyc",
        "accountStatus",
        "zone",
        "vehicleType",
    ]
    assert counts(res, "verification") == {
        "pending": 0,
        "approved": 1,
        "rejected": 1,
        "resubmission_requested": 0,
    }
    assert counts(res, "vehicleType") == {"bicycle": 0, "scooter": 1, "motorbike": 0, "car": 1}
    assert counts(res, "availability") == {"online": 1, "offline": 0, "busy": 0}
    assert counts(res, "kyc") == {"verified": 0, "pending": 0, "incomplete": 1, "rejected": 0}
    assert page["facets"]["zone"] == [{"value": "Lakeside", "count": 1}]

    everyone = data(admin.get(f"{RIDERS}?facets=1"))["facets"]
    assert {f["value"]: f["count"] for f in everyone["verification"]}["pending"] == 2
    assert {f["value"]: f["count"] for f in everyone["availability"]} == {
        "online": 1,
        "offline": 4,
        "busy": 0,
    }
    assert everyone["zone"] == [
        {"value": "Lakeside", "count": 2},
        {"value": "Hilltop", "count": 1},
    ]

    assert field_errors(admin.get(f"{RIDERS}?availability=online,away&vehicleType=jet")) == {
        "availability": "Invalid value",
        "vehicleType": "Invalid value",
    }


# --- admins -------------------------------------------------------------------------------------


def test_admins_multi_value_filters_and_facets(admin: APIClient) -> None:
    ops = make.user(Role.OPERATIONS_ADMIN)
    money = make.user(Role.FINANCE_ADMIN, status="inactive")
    desk = make.user(Role.SUPPORT_ADMIN, status="suspended")
    make.user(Role.CUSTOMER)

    assert ids(admin.get(f"{ADMINS}?role=finance_admin,support_admin")) == {
        str(money.pk),
        str(desk.pk),
    }
    assert ids(admin.get(f"{ADMINS}?status=inactive,suspended&role=support_admin")) == {
        str(desk.pk)
    }
    assert str(ops.pk) in ids(admin.get(f"{ADMINS}?status=active"))
    assert "facets" not in data(admin.get(ADMINS))

    res = admin.get(f"{ADMINS}?role=operations_admin,finance_admin&facets=1&limit=1")
    page = data(res)
    assert page["pagination"]["total"] == 2
    assert page["facets"]["role"] == [
        {"value": "admin", "count": 1},  # the signed-in super admin
        {"value": "operations_admin", "count": 1},
        {"value": "finance_admin", "count": 1},
        {"value": "support_admin", "count": 1},
        {"value": "operator", "count": 0},
    ]
    assert counts(res, "status") == {"active": 1, "inactive": 1, "suspended": 0, "blocked": 0}

    assert field_errors(admin.get(f"{ADMINS}?role=admin,customer&status=gone")) == {
        "role": "Invalid value",
        "status": "Invalid value",
    }


# --- audit log ----------------------------------------------------------------------------------


def entry(by: User, action: str, account_type: str = "") -> AuditLog:
    return AuditLog.objects.create(
        admin=by,
        admin_role=by.role,
        action=action,
        description=f"Did {action}",
        account_type=account_type,
    )


def test_audit_log_multi_value_filters_and_facets(admin: APIClient) -> None:
    boss = make.user(Role.ADMIN)
    support = make.user(Role.SUPPORT_ADMIN)
    a = entry(boss, "user.status", "customer")
    b = entry(support, "user.status", "delivery")
    c = entry(support, "user.update", "customer")
    d = entry(boss, "coupon.create")
    e = entry(support, "user.status", "customer")

    assert ids(admin.get(f"{AUDIT}?action=user.update,coupon.create")) == {str(c.pk), str(d.pk)}
    assert ids(admin.get(f"{AUDIT}?accountType=customer,delivery&role=support_admin")) == {
        str(b.pk),
        str(c.pk),
        str(e.pk),
    }
    assert "facets" not in data(admin.get(AUDIT))

    res = admin.get(f"{AUDIT}?role=support_admin&accountType=customer&facets=1&limit=1")
    page = data(res)
    assert page["pagination"]["total"] == 2
    assert list(page["facets"]) == ["action", "role", "accountType"]
    # actions that occur (support_admin, customer), by count then name
    assert page["facets"]["action"] == [
        {"value": "user.status", "count": 1},
        {"value": "user.update", "count": 1},
    ]
    assert counts(res, "role") == {
        "admin": 1,
        "operations_admin": 0,
        "finance_admin": 0,
        "support_admin": 2,
        "operator": 0,
    }
    assert page["facets"]["accountType"] == [
        {"value": "customer", "count": 2},
        {"value": "restaurant", "count": 0},
        {"value": "delivery", "count": 1},
        {"value": "admin", "count": 0},
    ]
    everything = data(admin.get(f"{AUDIT}?facets=1"))["facets"]["action"]
    assert everything == [
        {"value": "user.status", "count": 3},
        {"value": "coupon.create", "count": 1},
        {"value": "user.update", "count": 1},
    ]
    assert str(a.pk) in ids(admin.get(f"{AUDIT}?action=user.status"))

    assert field_errors(admin.get(f"{AUDIT}?role=admin,customer&accountType=none")) == {
        "role": "Invalid value",
        "accountType": "Invalid value",
    }
