"""Admin user page: view and correct a member's details and saved addresses (fictional data)."""

import uuid
from datetime import date
from typing import Any

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.accounts.tokens import sign_access_token
from apps.audit.models import AuditLog
from apps.customers.models import Address
from apps.rbac.roles import Role
from tests import factories as make

pytestmark = pytest.mark.django_db

ADDRESS = {
    "recipientName": "Mira Sen",
    "phone": "9000000042",
    "line1": "12 Lantern Lane",
    "city": "Lanternvale",
    "state": "Meadow State",
    "postalCode": "560099",
    "location": {"latitude": 12.95, "longitude": 77.61},
}


def client_as(role: Role = Role.ADMIN) -> tuple[APIClient, User]:
    actor = make.user(role)
    c = APIClient()
    c.credentials(HTTP_AUTHORIZATION=f"Bearer {sign_access_token(actor)}")
    return c, actor


@pytest.fixture
def admin() -> APIClient:
    return client_as()[0]


def url(user: User | str, rest: str = "") -> str:
    return f"/api/v1/admin/users/{getattr(user, 'pk', user)}{rest}"


def years_ago(years: int) -> str:
    today = timezone.now().date()
    return date(today.year - years, 6, 15).isoformat()


def field_errors(res: Any) -> dict[str, str]:
    return {d["field"]: d["message"] for d in res.json()["error"].get("details", [])}


# --- detail -------------------------------------------------------------------------------------


def test_detail_has_the_user_addresses_and_order_stats(admin: APIClient) -> None:
    customer = make.user(phone="9000000101")
    kitchen = make.restaurant()
    a = make.order(customer=customer, restaurant=kitchen, status="delivered")
    make.order(customer=customer, restaurant=kitchen, status="delivered")
    make.order(customer=customer, restaurant=kitchen, status="cancelled")
    make.order(customer=customer, restaurant=kitchen, status="rejected")
    latest = make.order(customer=customer, restaurant=kitchen, status="pending")
    make.order(restaurant=kitchen, status="delivered")  # someone else's
    own = APIClient()
    own.credentials(HTTP_AUTHORIZATION=f"Bearer {sign_access_token(customer)}")
    assert own.post("/api/v1/addresses", ADDRESS, format="json").status_code == 201

    res = admin.get(url(customer))
    assert res.status_code == 200, res.json()
    data = res.json()["data"]
    assert data["user"]["id"] == str(customer.pk)
    assert data["user"]["phone"] == "9000000101"
    assert "password" not in data["user"]
    assert data["addresses"] == own.get("/api/v1/addresses").json()["data"]["addresses"]
    assert data["stats"]["orders"] == 5
    assert data["stats"]["delivered"] == 2
    assert data["stats"]["cancelled"] == 2
    assert data["stats"]["spentPaise"] == 2 * a.total_paise
    assert data["stats"]["lastOrderAt"].startswith(latest.created_at.isoformat()[:19])
    assert data["restaurant"] is None


def test_detail_of_a_new_member_has_empty_stats(admin: APIClient) -> None:
    rider = make.user(Role.DELIVERY)
    data = admin.get(url(rider)).json()["data"]
    assert data["stats"] == {
        "orders": 0,
        "delivered": 0,
        "cancelled": 0,
        "spentPaise": 0,
        "lastOrderAt": None,
    }
    assert data["addresses"] == []
    assert data["restaurant"] is None


def test_detail_links_a_partner_to_their_restaurant(admin: APIClient) -> None:
    kitchen = make.restaurant(status="pending")
    data = admin.get(url(kitchen.owner)).json()["data"]
    assert data["restaurant"] == {
        "id": str(kitchen.pk),
        "name": kitchen.name,
        "slug": kitchen.slug,
        "status": "pending",
    }


@pytest.mark.parametrize("role", [Role.ADMIN, Role.SUPPORT_ADMIN])
def test_admins_and_unknown_ids_are_not_users_here(admin: APIClient, role: Role) -> None:
    staff = make.user(role)
    for target in (staff, uuid.uuid4()):
        for res in (
            admin.get(url(target)),
            admin.patch(url(target), {"name": "Changed Name"}, format="json"),
        ):
            assert res.status_code == 404
            assert res.json()["message"] == "User not found"
    assert User.objects.get(pk=staff.pk).name != "Changed Name"
    assert admin.get(url("not-an-id")).status_code == 422


def test_admin_roles_without_the_customer_permissions_are_refused() -> None:
    customer, rider = make.user(), make.user(Role.DELIVERY)
    refused = [(r, customer) for r in (Role.FINANCE_ADMIN, Role.OPERATOR, Role.CUSTOMER)]
    refused.append((Role.SUPPORT_ADMIN, rider))  # support: customers only
    refused.append((Role.OPERATIONS_ADMIN, customer))  # operations: partners and riders only
    for role, target in refused:
        c, _ = client_as(role)
        assert c.get(url(target)).status_code == 403, role
        assert c.patch(url(target), {"name": "Nope Name"}, format="json").status_code == 403
        assert c.post(url(target, "/addresses"), ADDRESS, format="json").status_code == 403
    assert not AuditLog.objects.exists()


# --- PATCH profile ------------------------------------------------------------------------------


def test_patch_updates_name_and_birthday_only_and_is_audited() -> None:
    admin, actor = client_as()
    now = timezone.now()
    customer = make.user(
        email="kavi@example.com",
        phone="9000000201",
        email_verified_at=now,
        phone_verified_at=now,
    )
    versions = customer.token_version
    res = admin.patch(
        url(customer),
        {
            "name": "Kavi Rao",
            "birthDate": years_ago(30),
            # Only the person changes their sign-in details; role and status have their own pages.
            "email": "other@example.com",
            "phone": "9000000202",
            "role": "admin",
            "status": "suspended",
        },
        format="json",
    )
    assert res.status_code == 200, res.json()
    body = res.json()
    assert body["message"] == "User updated"
    user = body["data"]["user"]
    assert user["name"] == "Kavi Rao"
    assert user["birthDate"] == years_ago(30)
    assert user["email"] == "kavi@example.com"
    assert user["phone"] == "9000000201"
    assert user["emailVerified"] is True
    assert user["phoneVerified"] is True
    stored = User.objects.get(pk=customer.pk)
    assert stored.role == Role.CUSTOMER
    assert stored.status == "active"
    assert stored.token_version == versions  # sessions untouched
    log = AuditLog.objects.get(action="user.update")
    assert log.admin_id == actor.pk
    assert log.resource_type == "user"
    assert log.resource_id == str(customer.pk)
    assert log.description == "Updated user details"


def test_patch_validates_the_name_like_sign_up(admin: APIClient) -> None:
    res = admin.patch(url(make.user()), {"name": "K"}, format="json")
    assert res.status_code == 422
    assert set(field_errors(res)) == {"name"}


def test_birth_date_follows_the_age_rule_can_be_corrected_and_cleared(admin: APIClient) -> None:
    customer = make.user(birth_date=date(1990, 1, 1))
    for bad in (years_ago(5), years_ago(130), "2000-02-30", "15/06/1990"):
        res = admin.patch(url(customer), {"birthDate": bad}, format="json")
        assert res.status_code == 422, bad
        assert "birthDate" in field_errors(res), bad
    assert User.objects.get(pk=customer.pk).birth_date == date(1990, 1, 1)

    res = admin.patch(url(customer), {"birthDate": "1991-03-04"}, format="json")
    assert res.status_code == 200  # already set: the admin may still correct it
    assert User.objects.get(pk=customer.pk).birth_date == date(1991, 3, 4)

    res = admin.patch(url(customer), {"birthDate": None}, format="json")
    assert res.status_code == 200
    assert "birthDate" not in res.json()["data"]["user"]
    assert User.objects.get(pk=customer.pk).birth_date is None


# --- addresses ----------------------------------------------------------------------------------


def test_admin_manages_a_customers_addresses_with_the_customer_rules() -> None:
    admin, actor = client_as()
    customer = make.user()

    first = admin.post(url(customer, "/addresses"), ADDRESS, format="json")
    assert first.status_code == 201, first.json()
    assert first.json()["message"] == "Address saved"
    first_id = first.json()["data"]["address"]["id"]
    assert first.json()["data"]["address"]["isDefault"] is True  # the first one is the default
    assert first.json()["data"]["address"]["user"] == str(customer.pk)

    second = admin.post(url(customer, "/addresses"), {**ADDRESS, "label": "work"}, format="json")
    second_id = second.json()["data"]["address"]["id"]
    assert second.json()["data"]["address"]["isDefault"] is False

    res = admin.patch(url(customer, f"/addresses/{second_id}"), {"line1": "7 Quiet Row"})
    assert res.status_code == 200
    assert res.json()["message"] == "Address updated"
    assert res.json()["data"]["address"]["line1"] == "7 Quiet Row"

    res = admin.patch(url(customer, f"/addresses/{second_id}/default"))
    assert res.status_code == 200
    assert res.json()["message"] == "Default address updated"
    assert Address.objects.get(pk=second_id).is_default
    assert not Address.objects.get(pk=first_id).is_default

    res = admin.delete(url(customer, f"/addresses/{second_id}"))
    assert res.status_code == 200
    assert res.json()["message"] == "Address deleted"
    assert Address.objects.get(pk=first_id).is_default  # the default moves on

    detail = admin.get(url(customer)).json()["data"]
    assert [a["id"] for a in detail["addresses"]] == [first_id]

    logs = AuditLog.objects.order_by("created_at")
    assert [log.action for log in logs] == [
        "user.address.create",
        "user.address.create",
        "user.address.update",
        "user.address.default",
        "user.address.delete",
    ]
    assert {(log.resource_type, log.resource_id, log.admin_id) for log in logs} == {
        ("user", str(customer.pk), actor.pk)
    }


def test_address_input_is_validated_like_the_customer_route(admin: APIClient) -> None:
    customer = make.user()
    res = admin.post(url(customer, "/addresses"), {**ADDRESS, "postalCode": "!"}, format="json")
    assert res.status_code == 422
    assert "postalCode" in field_errors(res)
    assert not Address.objects.exists()


def test_another_users_address_is_404(admin: APIClient) -> None:
    customer, other = make.user(), make.user()
    theirs = admin.post(url(other, "/addresses"), ADDRESS, format="json").json()["data"]["address"]
    for res in (
        admin.patch(url(customer, f"/addresses/{theirs['id']}"), {"line1": "Not Mine"}),
        admin.patch(url(customer, f"/addresses/{theirs['id']}/default")),
        admin.delete(url(customer, f"/addresses/{theirs['id']}")),
        admin.delete(url(customer, f"/addresses/{uuid.uuid4()}")),
    ):
        assert res.status_code == 404
    assert Address.objects.get(pk=theirs["id"]).line1 == ADDRESS["line1"]
    assert admin.delete(url(customer, "/addresses/nope")).status_code == 422


def test_only_customers_have_addresses(admin: APIClient) -> None:
    for role in (Role.RESTAURANT, Role.DELIVERY):
        member = make.user(role)
        res = admin.post(url(member, "/addresses"), ADDRESS, format="json")
        assert res.status_code == 400
        assert res.json()["message"] == "Only customers have saved addresses"
        assert admin.delete(url(member, f"/addresses/{uuid.uuid4()}")).status_code == 400
    staff = make.user(Role.OPERATIONS_ADMIN)
    assert admin.post(url(staff, "/addresses"), ADDRESS, format="json").status_code == 404
    assert not AuditLog.objects.exists()


# --- orders filter ------------------------------------------------------------------------------


def test_admin_orders_filter_by_customer_including_counts(admin: APIClient) -> None:
    customer = make.user()
    kitchen = make.restaurant()
    mine = {
        str(make.order(customer=customer, restaurant=kitchen, status="delivered").pk),
        str(make.order(customer=customer, restaurant=kitchen, status="pending").pk),
    }
    make.order(restaurant=kitchen, status="pending")
    make.order(restaurant=kitchen, status="cancelled")

    data = admin.get(f"/api/v1/admin/orders?customer={customer.pk}").json()["data"]
    assert {o["id"] for o in data["items"]} == mine
    assert data["counts"] == {"delivered": 1, "pending": 1}

    data = admin.get(f"/api/v1/admin/orders?customer={customer.pk}&status=pending").json()["data"]
    assert len(data["items"]) == 1
    assert data["counts"] == {"delivered": 1, "pending": 1}

    everyone = admin.get("/api/v1/admin/orders").json()["data"]
    assert everyone["pagination"]["total"] == 4

    res = admin.get("/api/v1/admin/orders?customer=not-an-id")
    assert res.status_code == 422
    assert "customer" in field_errors(res)
