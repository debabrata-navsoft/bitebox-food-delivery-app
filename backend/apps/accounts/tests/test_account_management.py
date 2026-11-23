"""
Account management, Phase 1: account statuses, per-person permissions, audit detail and profile
fields (fictional data only).
"""

import uuid
from typing import Any

import pytest
from django.conf import settings
from django.core.cache import cache
from rest_framework.test import APIClient

from apps.accounts.models import Session, User
from apps.accounts.tokens import sign_access_token
from apps.audit.models import AuditLog
from apps.delivery.models import DeliveryPartner
from apps.notifications.models import Notification
from apps.notifications.services import notify_admins
from apps.rbac.roles import Permission, Role
from apps.realtime.events import ADMINS
from apps.realtime.tracking import initial_groups
from apps.support.services import staff_list
from tests import factories as make

from .test_auth import login, me

pytestmark = pytest.mark.django_db

REASON = "Repeated abusive messages to riders"


@pytest.fixture(autouse=True)
def _clear_rate_limits() -> None:
    cache.clear()


def client_for(user: User) -> APIClient:
    c = APIClient()
    c.credentials(HTTP_AUTHORIZATION=f"Bearer {sign_access_token(user)}")
    return c


def as_role(role: Role = Role.ADMIN, **fields: Any) -> tuple[APIClient, User]:
    actor = make.user(role, **fields)
    return client_for(actor), actor


def operator(*permissions: str) -> tuple[APIClient, User]:
    return as_role(Role.OPERATOR, custom_permissions=list(permissions))


def status_url(user: User) -> str:
    return f"/api/v1/admin/users/{user.pk}/status"


def field_errors(res: Any) -> dict[str, str]:
    return {d["field"]: d["message"] for d in res.json()["error"].get("details", [])}


# --- A. statuses ----------------------------------------------------------------


@pytest.mark.parametrize(
    ("status", "message"),
    [
        ("inactive", "This account is inactive"),
        ("suspended", "This account has been suspended"),
        ("blocked", "This account is blocked"),
    ],
)
def test_every_non_active_status_blocks_sign_in_and_ends_sessions(
    status: str, message: str
) -> None:
    admin, _ = as_role()
    customer = make.user(email=f"{status}.person@example.com")
    signed_in = login(customer.email, make.PASSWORD)
    token = signed_in.json()["data"]["accessToken"]
    assert me(token).status_code == 200

    res = admin.patch(status_url(customer), {"status": status, "reason": REASON}, format="json")
    assert res.status_code == 200, res.json()
    user = res.json()["data"]["user"]
    assert user["status"] == status
    assert user["statusReason"] == REASON
    assert user["statusChangedAt"]

    assert me(token).status_code == 401
    assert not Session.objects.filter(user=customer, revoked_at__isnull=True).exists()
    refused = login(customer.email, make.PASSWORD)
    assert refused.status_code == 403
    assert refused.json()["error"]["code"] == "ACCOUNT_BLOCKED"
    assert refused.json()["message"] == f"{message}. Reason: {REASON}"
    assert field_errors(refused) == {"status": status, "reason": REASON}


def test_reactivation_clears_the_reason_and_lets_the_person_back_in() -> None:
    admin, _ = as_role()
    customer = make.user()
    admin.patch(status_url(customer), {"status": "blocked", "reason": REASON}, format="json")
    res = admin.patch(status_url(customer), {"status": "active"}, format="json")
    assert res.status_code == 200
    assert res.json()["message"] == "User reactivated"
    user = res.json()["data"]["user"]
    assert user["status"] == "active"
    assert "statusReason" not in user
    assert User.objects.get(pk=customer.pk).status_reason is None
    assert login(customer.email, make.PASSWORD).status_code == 200


@pytest.mark.parametrize(
    "body",
    [
        {"status": "suspended"},
        {"status": "inactive", "reason": "  "},
        {"status": "blocked", "reason": "no"},
        {"status": "blocked", "reason": "x" * 501},
    ],
)
def test_a_reason_is_needed_for_every_status_but_active(body: dict[str, Any]) -> None:
    admin, _ = as_role()
    customer = make.user()
    res = admin.patch(status_url(customer), body, format="json")
    assert res.status_code == 422
    assert field_errors(res) == {"reason": "Give a reason (3-500 characters)"}
    assert User.objects.get(pk=customer.pk).status == "active"


def test_unknown_status_is_refused() -> None:
    admin, _ = as_role()
    res = admin.patch(status_url(make.user()), {"status": "banned", "reason": REASON})
    assert res.status_code == 422
    assert field_errors(res)["status"] == (
        "Status must be one of: active, inactive, suspended, blocked"
    )


def test_status_messages_and_audit_detail() -> None:
    admin, actor = as_role()
    customer = make.user()
    expected = {"inactive": "deactivated", "suspended": "suspended", "blocked": "blocked"}
    for status, word in expected.items():
        res = admin.patch(status_url(customer), {"status": status, "reason": REASON})
        assert res.json()["message"] == f"User {word}"
    entries = list(AuditLog.objects.filter(action="user.status").order_by("created_at"))
    assert [e.changes for e in entries] == [
        {"status": {"from": "active", "to": "inactive"}},
        {"status": {"from": "inactive", "to": "suspended"}},
        {"status": {"from": "suspended", "to": "blocked"}},
    ]
    assert {(e.reason, e.account_type, e.admin_id) for e in entries} == {
        (REASON, "customer", actor.pk)
    }


def test_the_same_status_again_is_a_no_op() -> None:
    admin, _ = as_role()
    customer = make.user()
    admin.patch(status_url(customer), {"status": "suspended", "reason": REASON})
    versions = User.objects.get(pk=customer.pk).token_version
    again = admin.patch(status_url(customer), {"status": "suspended", "reason": "Something else"})
    assert again.status_code == 200
    stored = User.objects.get(pk=customer.pk)
    assert (stored.token_version, stored.status_reason) == (versions, REASON)
    assert AuditLog.objects.filter(action="user.status").count() == 1
    assert admin.patch(status_url(make.user()), {"status": "active"}).status_code == 200


def test_status_permissions_split_between_kind_status_and_accounts_suspend() -> None:
    customer, rider = make.user(), make.user(Role.DELIVERY)
    c, _ = operator("customers:status")
    assert (
        c.patch(status_url(customer), {"status": "inactive", "reason": REASON}).status_code == 200
    )
    assert c.patch(status_url(customer), {"status": "active"}).status_code == 200
    for status in ("suspended", "blocked"):
        res = c.patch(status_url(customer), {"status": status, "reason": REASON})
        assert res.status_code == 403
        assert res.json()["message"] == "You do not have access to this area"
    assert c.patch(status_url(rider), {"status": "inactive", "reason": REASON}).status_code == 403

    s, _ = operator("accounts:suspend")
    assert s.patch(status_url(rider), {"status": "blocked", "reason": REASON}).status_code == 200
    assert (
        s.patch(status_url(customer), {"status": "inactive", "reason": REASON}).status_code == 403
    )

    nobody, _ = operator("customers:view")
    assert nobody.patch(status_url(customer), {"status": "active"}).status_code == 403
    assert User.objects.get(pk=customer.pk).status == "active"


@pytest.mark.parametrize("status", ["inactive", "suspended", "blocked"])
def test_riders_are_taken_offline_on_any_non_active_status(status: str) -> None:
    admin, _ = as_role()
    for path in ("/api/v1/admin/users/{}/status", "/api/v1/admin/delivery-partners/{}/status"):
        rider = make.user(Role.DELIVERY)
        profile = DeliveryPartner.objects.create(user=rider, is_online=True)
        res = admin.patch(path.format(rider.pk), {"status": status, "reason": REASON})
        assert res.status_code == 200, (path, res.json())
        assert DeliveryPartner.objects.get(pk=profile.pk).is_online is False
        assert User.objects.get(pk=rider.pk).status_reason == REASON


def test_rider_status_endpoint_follows_the_same_reason_rules() -> None:
    admin, _ = as_role()
    rider = make.user(Role.DELIVERY)
    path = f"/api/v1/admin/delivery-partners/{rider.pk}/status"
    res = admin.patch(path, {"status": "blocked"}, format="json")
    assert res.status_code == 422
    assert "reason" in field_errors(res)
    res = admin.patch(path, {"status": "blocked", "reason": REASON}, format="json")
    assert res.json()["message"] == "Rider blocked"
    entry = AuditLog.objects.get(action="rider.status")
    assert entry.changes == {"status": {"from": "active", "to": "blocked"}}
    assert (entry.reason, entry.account_type) == (REASON, "delivery")


def test_staff_status_accepts_the_new_statuses() -> None:
    admin, _ = as_role()
    staff = make.user(Role.FINANCE_ADMIN)
    path = f"/api/v1/admin/admins/{staff.pk}/status"
    assert admin.patch(path, {"status": "inactive"}).status_code == 422
    res = admin.patch(path, {"status": "inactive", "reason": "Left the team"}, format="json")
    assert res.status_code == 200
    assert res.json()["data"]["user"]["status"] == "inactive"
    assert AuditLog.objects.get(action="admin.status").account_type == "admin"


# --- B. permissions ----------------------------------------------------------------


def test_effective_permissions_in_the_user_json() -> None:
    _, preset = as_role(Role.SUPPORT_ADMIN)
    assert login(preset.email, make.PASSWORD).json()["data"]["user"]["permissions"] == [
        "customers:edit",
        "customers:view",
        "orders:view",
        "reviews:moderate",
        "support:manage",
    ]
    _, custom = as_role(Role.SUPPORT_ADMIN, custom_permissions=["orders:view"])
    assert login(custom.email, make.PASSWORD).json()["data"]["user"]["permissions"] == [
        "orders:view"
    ]
    _, boss = as_role(Role.ADMIN, custom_permissions=[])
    perms = login(boss.email, make.PASSWORD).json()["data"]["user"]["permissions"]
    assert set(perms) == {p.value for p in Permission}
    _, empty = operator()
    assert login(empty.email, make.PASSWORD).json()["data"]["user"]["permissions"] == []


def test_the_user_json_shows_whether_permissions_are_the_role_preset() -> None:
    _, preset = as_role(Role.SUPPORT_ADMIN)
    assert login(preset.email, make.PASSWORD).json()["data"]["user"]["customPermissions"] is None
    _, custom = as_role(Role.SUPPORT_ADMIN, custom_permissions=["orders:view"])
    user = login(custom.email, make.PASSWORD).json()["data"]["user"]
    assert user["customPermissions"] == ["orders:view"]
    customer = make.user()
    assert "customPermissions" not in login(customer.email, make.PASSWORD).json()["data"]["user"]


def test_an_operator_without_permissions_is_refused_everywhere() -> None:
    c, _ = operator()
    customer = make.user()
    for path in (
        "/api/v1/admin/users",
        f"/api/v1/admin/users/{customer.pk}",
        f"/api/v1/admin/users/{customer.pk}/logins",
        "/api/v1/admin/admins",
        "/api/v1/admin/admins/permissions",
        "/api/v1/admin/audit-logs",
        "/api/v1/admin/orders",
        "/api/v1/admin/delivery-partners",
        "/api/v1/admin/finance/dashboard",
        f"/api/v1/admin/kyc/partners/{customer.pk}",
    ):
        assert c.get(path).status_code == 403, path
    assert c.patch(f"/api/v1/admin/users/{customer.pk}", {"name": "Nope Name"}).status_code == 403


def test_an_operator_with_customers_view_sees_customers_only() -> None:
    c, _ = operator("customers:view")
    customer, rider = make.user(), make.user(Role.DELIVERY)
    make.user(Role.RESTAURANT)
    items = c.get("/api/v1/admin/users?limit=100").json()["data"]["items"]
    assert {u["role"] for u in items} == {"customer"}
    assert c.get("/api/v1/admin/users?role=customer").status_code == 200
    assert c.get("/api/v1/admin/users?role=delivery").status_code == 403
    assert c.get(f"/api/v1/admin/users/{customer.pk}").status_code == 200
    assert c.get(f"/api/v1/admin/users/{rider.pk}").status_code == 403
    assert c.get(f"/api/v1/admin/users/{rider.pk}/logins").status_code == 403
    assert c.get(f"/api/v1/admin/users/{uuid.uuid4()}").status_code == 404
    # Viewing is not editing.
    assert c.patch(f"/api/v1/admin/users/{customer.pk}", {"name": "New Name"}).status_code == 403


def test_users_list_filters_by_several_roles_and_statuses_with_counts() -> None:
    admin, _ = as_role()
    make.user(name="Asha Customer")
    rider = make.user(Role.DELIVERY, name="Bina Rider", status="suspended")
    make.user(Role.RESTAURANT, name="Chef Restaurant")

    def get(query: str) -> Any:
        res = admin.get(f"/api/v1/admin/users?{query}")
        assert res.status_code == 200, res.json()
        return res.json()["data"]

    data = get("role=customer,delivery&sort=name&facets=1")
    assert [u["name"] for u in data["items"]] == ["Asha Customer", "Bina Rider"]
    roles = {f["value"]: f["count"] for f in data["facets"]["role"]}
    assert roles == {"customer": 1, "restaurant": 1, "delivery": 1}
    assert [u["id"] for u in get("status=suspended,blocked")["items"]] == [str(rider.pk)]
    assert [u["name"] for u in get(f"search=%23{str(rider.pk)[-8:]}")["items"]] == ["Bina Rider"]
    assert admin.get("/api/v1/admin/users?status=gone").status_code == 422


def test_permission_changes_apply_on_the_next_request() -> None:
    admin, _ = as_role()
    c, staff = operator()
    assert c.get("/api/v1/admin/users").status_code == 403
    res = admin.patch(
        f"/api/v1/admin/admins/{staff.pk}",
        {"permissions": ["customers:view", "orders:view"]},
        format="json",
    )
    assert res.status_code == 200, res.json()
    assert res.json()["data"]["user"]["permissions"] == ["customers:view", "orders:view"]
    assert c.get("/api/v1/admin/users").status_code == 200  # same token, new permissions
    entry = AuditLog.objects.get(action="admin.update")
    assert entry.changes == {"permissions": {"from": [], "to": ["customers:view", "orders:view"]}}
    assert entry.account_type == "admin"


def test_null_permissions_go_back_to_the_role_preset() -> None:
    admin, _ = as_role()
    staff = make.user(Role.FINANCE_ADMIN, custom_permissions=["orders:view"])
    res = admin.patch(f"/api/v1/admin/admins/{staff.pk}", {"permissions": None}, format="json")
    assert res.json()["data"]["user"]["permissions"] == [
        "finance:view",
        "payouts:manage",
        "refunds:manage",
    ]
    assert User.objects.get(pk=staff.pk).custom_permissions is None


def test_creates_an_operator_with_its_own_permissions() -> None:
    admin, _ = as_role()
    res = admin.post(
        "/api/v1/admin/admins",
        {
            "name": "Ola Operator",
            "email": "ola.operator@example.com",
            "password": "Ops-pass-123",
            "role": "operator",
            "permissions": ["riders:view", "riders:kyc", "riders:view"],
        },
        format="json",
    )
    assert res.status_code == 201, res.json()
    assert res.json()["data"]["user"]["permissions"] == ["riders:kyc", "riders:view"]
    entry = AuditLog.objects.get(action="admin.create")
    assert entry.description == "Created Operator ola.operator@example.com"
    assert entry.changes["permissions"] == {"from": [], "to": ["riders:kyc", "riders:view"]}


@pytest.mark.parametrize(
    ("permissions", "message"),
    [
        (["admins:manage"], "admins:manage can only belong to the super admin"),
        (["customers:view", "users:manage"], "Unknown permission: users:manage"),
        ("customers:view", "Permissions must be a list of permission keys"),
    ],
)
def test_custom_lists_are_validated(permissions: Any, message: str) -> None:
    admin, _ = as_role()
    staff = make.user(Role.OPERATOR)
    res = admin.patch(
        f"/api/v1/admin/admins/{staff.pk}", {"permissions": permissions}, format="json"
    )
    assert res.status_code == 422
    assert field_errors(res) == {"permissions": message}
    assert User.objects.get(pk=staff.pk).custom_permissions is None


def test_role_change_is_audited_with_permissions() -> None:
    admin, _ = as_role()
    staff = make.user(Role.FINANCE_ADMIN)
    res = admin.patch(f"/api/v1/admin/admins/{staff.pk}", {"role": "operator"}, format="json")
    assert res.status_code == 200
    entry = AuditLog.objects.get(action="admin.update")
    assert entry.changes == {
        "role": {"from": "finance_admin", "to": "operator"},
        "permissions": {"from": ["finance:view", "payouts:manage", "refunds:manage"], "to": []},
    }


def test_the_permission_catalogue() -> None:
    admin, _ = as_role()
    res = admin.get("/api/v1/admin/admins/permissions")
    assert res.status_code == 200
    data = res.json()["data"]
    keys = [p["key"] for p in data["permissions"]]
    assert set(keys) == {p.value for p in Permission}
    assert len(keys) == len(set(keys))
    assert {p["group"] for p in data["permissions"]} == {
        "Customers",
        "Restaurants",
        "Delivery partners",
        "Accounts",
        "Orders & operations",
        "Finance",
        "Support",
        "Catalog & marketing",
        "Rewards",
        "Admin",
    }
    assert {
        "key": "restaurants:approve",
        "label": "Approve restaurants",
        "group": "Restaurants",
    } in (data["permissions"])
    presets = {p["key"]: p for p in data["presets"]}
    assert set(presets) == {"support", "restaurant", "delivery", "kyc", "finance"}
    assert presets["kyc"]["permissions"] == [
        "restaurants:view",
        "riders:view",
        "restaurants:kyc",
        "riders:kyc",
    ]
    assert all(p["label"] for p in data["presets"])
    ops, _ = as_role(Role.OPERATIONS_ADMIN)
    assert ops.get("/api/v1/admin/admins/permissions").status_code == 403


def test_notify_admins_reads_effective_permissions() -> None:
    _, boss = as_role()
    _, with_custom = operator("support:manage")
    _, support_without = as_role(Role.SUPPORT_ADMIN, custom_permissions=["orders:view"])
    _, support_preset = as_role(Role.SUPPORT_ADMIN)
    _, suspended = operator("support:manage")
    User.objects.filter(pk=suspended.pk).update(status="blocked")
    notify_admins(Permission.SUPPORT_MANAGE, type="support.ticket", title="A ticket")
    reached = set(Notification.objects.values_list("user_id", flat=True))
    assert reached == {boss.pk, with_custom.pk, support_preset.pk}
    assigneable = {i["id"] for i in staff_list()["items"]}
    assert assigneable == {str(boss.pk), str(with_custom.pk), str(support_preset.pk)}
    assert str(support_without.pk) not in assigneable


def test_socket_admin_room_reads_effective_permissions() -> None:
    _, viewer = operator("orders:view")
    _, plain = operator()
    _, finance = as_role(Role.FINANCE_ADMIN)
    _, custom_finance = as_role(Role.FINANCE_ADMIN, custom_permissions=["orders:view"])
    assert ADMINS in initial_groups(viewer)
    assert ADMINS in initial_groups(custom_finance)
    assert ADMINS not in initial_groups(plain)
    assert ADMINS not in initial_groups(finance)


def test_kyc_review_reads_effective_permissions() -> None:
    kitchen_owner = make.restaurant().owner
    rider = make.user(Role.DELIVERY)
    path = "/api/v1/admin/kyc/partners/{}"
    kyc, _ = operator("restaurants:kyc")
    assert kyc.get(path.format(kitchen_owner.pk)).status_code == 200
    assert kyc.get(path.format(rider.pk)).status_code == 404
    riders, _ = operator("riders:kyc")
    assert riders.get(path.format(rider.pk)).status_code == 200
    assert riders.get(path.format(kitchen_owner.pk)).status_code == 404
    legacy, _ = operator("restaurants:manage")  # the key that reviewed documents before
    assert legacy.get(path.format(kitchen_owner.pk)).status_code == 200
    none, _ = operator("customers:view")
    assert none.get(path.format(kitchen_owner.pk)).status_code == 403


# --- C. audit log ----------------------------------------------------------------


def test_audit_log_filters_by_account_type_and_resource() -> None:
    admin, _ = as_role()
    customer, rider = make.user(), make.user(Role.DELIVERY)
    admin.patch(status_url(customer), {"status": "inactive", "reason": REASON})
    admin.patch(status_url(rider), {"status": "inactive", "reason": REASON})
    admin.patch(f"/api/v1/admin/users/{customer.pk}", {"name": "Tara Vale"}, format="json")

    page = admin.get("/api/v1/admin/audit-logs?accountType=delivery").json()["data"]
    assert [e["resourceId"] for e in page["items"]] == [str(rider.pk)]
    entry = page["items"][0]
    assert entry["accountType"] == "delivery"
    assert entry["reason"] == REASON
    assert entry["changes"] == {"status": {"from": "active", "to": "inactive"}}

    page = admin.get(f"/api/v1/admin/audit-logs?resourceId={customer.pk}").json()["data"]
    assert [e["action"] for e in page["items"]] == ["user.update", "user.status"]
    assert page["items"][0]["reason"] == ""
    assert admin.get("/api/v1/admin/audit-logs?accountType=robot").status_code == 422


# --- D. profile fields ----------------------------------------------------------------


def uploaded() -> str:
    return f"{settings.PUBLIC_BASE_URL}/uploads/images/{uuid.uuid4()}.png"


def test_admin_edits_gender_and_photo_and_the_changes_are_audited() -> None:
    admin, _ = as_role()
    customer = make.user(name="Ivo Brook")
    photo = uploaded()
    res = admin.patch(
        f"/api/v1/admin/users/{customer.pk}",
        {"name": "Ivo Brookes", "gender": "male", "avatarUrl": photo, "email": "x@example.com"},
        format="json",
    )
    assert res.status_code == 200, res.json()
    user = res.json()["data"]["user"]
    assert (user["gender"], user["avatarUrl"], user["name"]) == ("male", photo, "Ivo Brookes")
    assert user["email"] == customer.email
    entry = AuditLog.objects.get(action="user.update")
    assert entry.changes == {
        "name": {"from": "Ivo Brook", "to": "Ivo Brookes"},
        "gender": {"from": None, "to": "male"},
        "avatarUrl": {"from": None, "to": photo},
    }
    assert entry.account_type == "customer"

    res = admin.patch(
        f"/api/v1/admin/users/{customer.pk}", {"gender": None, "avatarUrl": None}, format="json"
    )
    assert "gender" not in res.json()["data"]["user"]
    assert "avatarUrl" not in res.json()["data"]["user"]


def test_admin_profile_edit_validates_gender_and_photo() -> None:
    admin, _ = as_role()
    customer = make.user()
    res = admin.patch(f"/api/v1/admin/users/{customer.pk}", {"gender": "robot"}, format="json")
    assert res.status_code == 422
    assert field_errors(res) == {
        "gender": "Gender must be one of: female, male, other, prefer_not_to_say"
    }
    res = admin.patch(
        f"/api/v1/admin/users/{customer.pk}",
        {"avatarUrl": "https://elsewhere.example/face.png"},
        format="json",
    )
    assert res.status_code == 400
    assert res.json()["message"] == "Upload the photo first"


def test_customers_set_their_own_gender() -> None:
    customer = make.user()
    c = client_for(customer)
    res = c.patch("/api/v1/auth/me", {"gender": "prefer_not_to_say"}, format="json")
    assert res.status_code == 200
    assert res.json()["data"]["user"]["gender"] == "prefer_not_to_say"
    assert c.patch("/api/v1/auth/me", {"gender": "x"}, format="json").status_code == 422
