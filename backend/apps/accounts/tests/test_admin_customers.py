"""Account management phase 2: the admin customers list, customer filters on other admin lists and
the account help actions (password reset and email verification links). Fictional data only."""

import re
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from django.core import mail
from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import User, UserStatus
from apps.accounts.tokens import sign_access_token
from apps.audit.models import AuditLog
from apps.orders.models import Order, PaymentMethod, PaymentStatus
from apps.payments.models import Payment, Provider
from apps.rbac.roles import Role
from apps.reviews.models import Review, ReviewTarget
from apps.support.models import SupportTicket
from tests import factories as make

pytestmark = pytest.mark.django_db

CUSTOMERS = "/api/v1/admin/customers"


def client_for(user: User) -> APIClient:
    c = APIClient()
    c.credentials(HTTP_AUTHORIZATION=f"Bearer {sign_access_token(user)}")
    return c


def operator(*permissions: str) -> APIClient:
    return client_for(make.user(Role.OPERATOR, custom_permissions=list(permissions)))


@pytest.fixture
def admin() -> APIClient:
    return client_for(make.user(Role.ADMIN))


def joined(user: User, at: datetime) -> User:
    User.objects.filter(pk=user.pk).update(created_at=at)
    user.refresh_from_db()
    return user


def ids(res: Any) -> list[str]:
    assert res.status_code == 200, res.json()
    return [item["id"] for item in res.json()["data"]["items"]]


def field_errors(res: Any) -> dict[str, str]:
    return {d["field"]: d["message"] for d in res.json()["error"].get("details", [])}


def orders(customer: User, *statuses: str) -> list[Order]:
    return [make.order(customer=customer, status=s) for s in statuses]


# --- the list -----------------------------------------------------------------------------------


def test_lists_only_customers_with_their_order_stats(admin: APIClient) -> None:
    customer = make.user(name="Ivo Brightwater")
    make.user(Role.RESTAURANT, name="Kitchen Owner")
    make.user(Role.DELIVERY, name="Road Runner")
    make.user(Role.SUPPORT_ADMIN, name="Desk Person")
    placed = orders(customer, "delivered", "delivered", "cancelled", "pending")
    make.order(status="delivered")  # someone else's (its customer is listed with 1 order)

    res = admin.get(CUSTOMERS)
    assert res.status_code == 200, res.json()
    data = res.json()["data"]
    assert {i["role"] for i in data["items"]} == {"customer"}
    assert data["pagination"] == {"page": 1, "limit": 20, "total": 2, "totalPages": 1}
    item = next(i for i in data["items"] if i["id"] == str(customer.pk))
    assert item["name"] == "Ivo Brightwater"
    assert "password" not in item
    newest = max(o.created_at for o in placed)
    assert item["stats"]["orders"] == 4
    assert item["stats"]["spentPaise"] == sum(o.total_paise for o in placed[:2])
    assert datetime.fromisoformat(item["stats"]["lastOrderAt"]) == newest
    quiet = make.user(name="No Orders Yet")
    item = next(i for i in admin.get(CUSTOMERS).json()["data"]["items"] if i["id"] == str(quiet.pk))
    assert item["stats"] == {"orders": 0, "spentPaise": 0, "lastOrderAt": None}


def test_filters_by_status_and_verification(admin: APIClient) -> None:
    now = timezone.now()
    plain = make.user()
    blocked = make.user(status=UserStatus.BLOCKED)
    email_ok = make.user(email_verified_at=now)
    phone_ok = make.user(phone="9000000301", phone_verified_at=now)

    assert ids(admin.get(f"{CUSTOMERS}?status=blocked")) == [str(blocked.pk)]
    assert set(ids(admin.get(f"{CUSTOMERS}?status=active"))) == {
        str(u.pk) for u in (plain, email_ok, phone_ok)
    }
    assert ids(admin.get(f"{CUSTOMERS}?verification=email_verified")) == [str(email_ok.pk)]
    assert str(email_ok.pk) not in ids(admin.get(f"{CUSTOMERS}?verification=email_unverified"))
    assert ids(admin.get(f"{CUSTOMERS}?verification=phone_verified")) == [str(phone_ok.pk)]
    assert set(ids(admin.get(f"{CUSTOMERS}?verification=phone_unverified"))) == {
        str(u.pk) for u in (plain, blocked, email_ok)
    }


def test_searches_name_email_phone_and_id(admin: APIClient) -> None:
    asha = make.user(name="Asha Quillfeather", email="asha.q@bitebox.test", phone="+919000000311")
    other = make.user(name="Bruno Tallowmere", email="bruno.t@bitebox.test", phone="9000000322")

    assert ids(admin.get(f"{CUSTOMERS}?search=quillFEATHER")) == [str(asha.pk)]
    assert ids(admin.get(f"{CUSTOMERS}?search=bruno.t@")) == [str(other.pk)]
    assert ids(admin.get(f"{CUSTOMERS}?search=9000000311")) == [str(asha.pk)]  # stored +91…
    assert ids(admin.get(f"{CUSTOMERS}?search=%2B91 90000 00322")) == [str(other.pk)]
    assert ids(admin.get(f"{CUSTOMERS}?search={asha.pk}")) == [str(asha.pk)]
    shown = "%23" + asha.pk.hex[-8:].upper()  # "#" + the last 8, as the app shows it
    assert ids(admin.get(f"{CUSTOMERS}?search={shown}")) == [str(asha.pk)]
    assert ids(admin.get(f"{CUSTOMERS}?search={asha.pk.hex[-6:]}")) == [str(asha.pk)]
    assert ids(admin.get(f"{CUSTOMERS}?search=nobody-here")) == []
    res = admin.get(f"{CUSTOMERS}?search={'x' * 101}")
    assert res.status_code == 422
    assert "search" in field_errors(res)


@override_settings(REPORT_TIMEZONE="Asia/Kolkata")
def test_joined_dates_are_whole_days_in_the_report_time_zone(admin: APIClient) -> None:
    # 18:29 UTC is 23:59 on 9 March in Kolkata; 18:31 UTC is 00:01 on 10 March.
    late = joined(make.user(), datetime(2026, 3, 9, 18, 29, tzinfo=UTC))
    early = joined(make.user(), datetime(2026, 3, 10, 18, 31, tzinfo=UTC) - timedelta(days=1))
    later = joined(make.user(), datetime(2026, 3, 12, 6, 0, tzinfo=UTC))

    assert ids(admin.get(f"{CUSTOMERS}?joinedTo=2026-03-09&sort=oldest")) == [str(late.pk)]
    assert ids(admin.get(f"{CUSTOMERS}?joinedFrom=2026-03-10&joinedTo=2026-03-10")) == [
        str(early.pk)
    ]
    assert ids(admin.get(f"{CUSTOMERS}?joinedFrom=2026-03-09&joinedTo=2026-03-12&sort=oldest")) == [
        str(late.pk),
        str(early.pk),
        str(later.pk),
    ]
    bad = admin.get(f"{CUSTOMERS}?joinedFrom=2026-03-12&joinedTo=2026-03-10")
    assert bad.status_code == 422
    assert set(field_errors(bad)) == {"joinedTo"}
    bad = admin.get(f"{CUSTOMERS}?joinedFrom=12-03-2026")
    assert bad.status_code == 422
    assert set(field_errors(bad)) == {"joinedFrom"}


def test_sorts(admin: APIClient) -> None:
    base = timezone.now() - timedelta(days=10)
    cara = joined(make.user(name="cara Lumen"), base)
    abel = joined(make.user(name="Abel Fernwick"), base + timedelta(days=1))
    dina = joined(make.user(name="Dina Holloway"), base + timedelta(days=2))
    bo = joined(make.user(name="Bo Ashgrove"), base + timedelta(days=3))
    orders(cara, "delivered", "cancelled", "pending")  # 3 orders, 1 delivered
    orders(abel, "delivered", "delivered")  # 2 orders, 2 delivered
    orders(dina, "cancelled", "cancelled", "rejected")  # 3 orders, nothing spent

    def order_of(sort: str) -> list[str]:
        return ids(admin.get(f"{CUSTOMERS}?sort={sort}"))

    expect = lambda *users: [str(u.pk) for u in users]  # noqa: E731
    assert order_of("newest") == expect(bo, dina, abel, cara)
    assert ids(admin.get(CUSTOMERS)) == order_of("newest")
    assert order_of("oldest") == expect(cara, abel, dina, bo)
    assert order_of("name") == expect(abel, bo, cara, dina)
    assert order_of("orders") == expect(dina, cara, abel, bo)  # dina/cara tie: newest first
    assert order_of("spent") == expect(abel, cara, bo, dina)  # bo/dina tie (0): newest first
    bad = admin.get(f"{CUSTOMERS}?sort=richest")
    assert bad.status_code == 422
    assert set(field_errors(bad)) == {"sort"}


def test_paginates(admin: APIClient) -> None:
    for _ in range(5):
        make.user()
    data = admin.get(f"{CUSTOMERS}?page=2&limit=2&sort=orders").json()["data"]
    assert len(data["items"]) == 2
    assert data["pagination"] == {"page": 2, "limit": 2, "total": 5, "totalPages": 3}
    assert admin.get(f"{CUSTOMERS}?limit=101").status_code == 422
    assert admin.get(f"{CUSTOMERS}?page=0").status_code == 422


def test_bad_filters_and_unknown_fields(admin: APIClient) -> None:
    for query, field in (("status=gone", "status"), ("verification=maybe", "verification")):
        res = admin.get(f"{CUSTOMERS}?{query}")
        assert res.status_code == 422
        assert set(field_errors(res)) == {field}
    assert admin.get(f"{CUSTOMERS}?role=admin&color=blue").status_code == 200


def test_list_needs_customers_view() -> None:
    assert operator("customers:view").get(CUSTOMERS).status_code == 200
    for perms in (("customers:edit", "restaurants:view", "riders:view"), ()):
        assert operator(*perms).get(CUSTOMERS).status_code == 403
    assert client_for(make.user(Role.FINANCE_ADMIN)).get(CUSTOMERS).status_code == 403
    assert client_for(make.user(Role.SUPPORT_ADMIN)).get(CUSTOMERS).status_code == 200
    assert client_for(make.user()).get(CUSTOMERS).status_code == 403
    assert APIClient().get(CUSTOMERS).status_code == 401


# --- customer filters on other admin lists ------------------------------------------------------


def test_payments_filter_by_customer(admin: APIClient) -> None:
    mine, theirs = make.user(), make.user()
    for customer in (mine, mine, theirs):
        order = make.order(customer=customer)
        Payment.objects.create(
            order=order,
            user=customer,
            method=PaymentMethod.COD,
            provider=Provider.CASH_ON_DELIVERY,
            amount_paise=order.total_paise,
            status=PaymentStatus.PENDING,
        )
    res = admin.get(f"/api/v1/admin/payments?customer={mine.pk}")
    assert res.status_code == 200, res.json()
    items = res.json()["data"]["items"]
    expected = set(Order.objects.filter(customer=mine).values_list("order_number", flat=True))
    assert len(items) == 2
    assert {i["order"]["orderNumber"] for i in items} == expected
    assert len(admin.get("/api/v1/admin/payments").json()["data"]["items"]) == 3
    bad = admin.get("/api/v1/admin/payments?customer=nope")
    assert bad.status_code == 422
    assert set(field_errors(bad)) == {"customer"}


def _review(order: Order) -> Review:
    return Review.objects.create(
        target=ReviewTarget.RESTAURANT,
        customer=order.customer,
        customer_name=order.customer.name,
        order=order,
        order_number=order.order_number,
        restaurant=order.restaurant,
        rating=4,
        comment="Warm and tasty.",
    )


def test_review_orders_filter_by_customer(admin: APIClient) -> None:
    mine, theirs = make.user(), make.user()
    reviewed = [make.order(customer=mine, status="delivered") for _ in range(2)]
    for order in reviewed:
        _review(order)
    _review(make.order(customer=theirs, status="delivered"))
    make.order(customer=mine, status="delivered")  # not reviewed: not listed

    res = admin.get(f"/api/v1/admin/reviews/orders?customer={mine.pk}")
    assert res.status_code == 200, res.json()
    rows = res.json()["data"]["items"]
    assert {r["orderNumber"] for r in rows} == {o.order_number for o in reviewed}
    assert len(admin.get("/api/v1/admin/reviews/orders").json()["data"]["items"]) == 3
    bad = admin.get("/api/v1/admin/reviews/orders?customer=123")
    assert bad.status_code == 422
    assert set(field_errors(bad)) == {"customer"}


def test_tickets_filter_by_requester(admin: APIClient) -> None:
    mine, theirs = make.user(), make.user()
    for n, who in enumerate((mine, mine, theirs)):
        SupportTicket.objects.create(
            number=f"TK-T-{n:04d}",
            raised_by=who,
            requester_role="customer",
            requester_name=who.name,
            type="account",
            subject="Cannot change email",
        )
    res = admin.get(f"/api/v1/admin/support/tickets?requester={mine.pk}")
    assert res.status_code == 200, res.json()
    assert {t["number"] for t in res.json()["data"]["items"]} == {"TK-T-0000", "TK-T-0001"}
    assert len(admin.get("/api/v1/admin/support/tickets").json()["data"]["items"]) == 3
    bad = admin.get("/api/v1/admin/support/tickets?requester=x")
    assert bad.status_code == 422
    assert set(field_errors(bad)) == {"requester"}


# --- account help -------------------------------------------------------------------------------


def reset_url(user: User | str) -> str:
    return f"{CUSTOMERS}/{getattr(user, 'pk', user)}/password-reset"


def verify_url(user: User | str) -> str:
    return f"{CUSTOMERS}/{getattr(user, 'pk', user)}/email-verification"


def test_password_reset_sends_the_forgot_password_email(admin: APIClient) -> None:
    customer = make.user(email="lena.marsh@bitebox.test")
    res = admin.post(reset_url(customer))
    assert res.status_code == 200, res.json()
    assert res.json()["message"] == "Password reset link sent"
    assert res.json()["data"] is None
    assert len(mail.outbox) == 1
    sent = mail.outbox[0]
    assert sent.to == ["lena.marsh@bitebox.test"]

    # Identical to what forgot-password sends.
    customer.refresh_from_db()
    customer.password_reset_expires_at = None
    customer.save(update_fields=["password_reset_expires_at"])
    APIClient().post(
        "/api/v1/auth/forgot-password", {"email": "lena.marsh@bitebox.test"}, format="json"
    )
    own = mail.outbox[1]
    assert own.subject == sent.subject
    strip = lambda body: re.sub(r"token=\S+", "token=…", body)  # noqa: E731
    assert strip(own.body) == strip(sent.body)

    # The admin's link works on the normal reset page.
    assert admin.post(reset_url(customer)).status_code == 429  # a link went a moment ago
    User.objects.filter(pk=customer.pk).update(password_reset_expires_at=None)
    assert admin.post(reset_url(customer)).status_code == 200
    token = re.search(r"token=([\w-]+)", mail.outbox[2].body).group(1)  # type: ignore[union-attr]
    done = APIClient().post(
        "/api/v1/auth/reset-password", {"token": token, "password": "Fresh-pass-42"}, format="json"
    )
    assert done.status_code == 200, done.json()
    assert User.objects.get(pk=customer.pk).check_password("Fresh-pass-42")

    entry = AuditLog.objects.filter(action="customer.password_reset").first()
    assert AuditLog.objects.filter(action="customer.password_reset").count() == 2
    assert entry is not None
    assert entry.description == "Sent a password reset link"
    assert entry.resource_id == str(customer.pk)
    assert entry.account_type == "customer"


def test_password_reset_is_limited_to_one_a_minute(admin: APIClient) -> None:
    customer = make.user()
    assert admin.post(reset_url(customer)).status_code == 200
    again = admin.post(reset_url(customer))
    assert again.status_code == 429
    assert len(mail.outbox) == 1
    assert AuditLog.objects.filter(action="customer.password_reset").count() == 1
    # A minute later it can go again.
    User.objects.filter(pk=customer.pk).update(
        password_reset_expires_at=timezone.now() + timedelta(minutes=10)
    )
    with override_settings(PASSWORD_RESET_TTL_MINUTES=11):
        assert admin.post(reset_url(customer)).status_code == 200


@pytest.mark.parametrize("status", ["inactive", "suspended", "blocked"])
def test_password_reset_refuses_accounts_that_are_not_active(admin: APIClient, status: str) -> None:
    customer = make.user(status=status)
    res = admin.post(reset_url(customer))
    assert res.status_code == 409
    assert res.json()["message"] == "The account is not active"
    assert not mail.outbox
    assert not AuditLog.objects.filter(action="customer.password_reset").exists()


def test_email_verification_sends_the_link(admin: APIClient) -> None:
    customer = make.user(email="omar.reed@bitebox.test")
    res = admin.post(verify_url(customer))
    assert res.status_code == 200, res.json()
    assert res.json()["message"] == "Verification email sent"
    assert res.json()["data"] is None
    assert mail.outbox[-1].to == ["omar.reed@bitebox.test"]
    token = re.search(r"token=([\w-]+)", mail.outbox[-1].body).group(1)  # type: ignore[union-attr]
    assert APIClient().post("/api/v1/auth/email/verify", {"token": token}).status_code == 200
    assert User.objects.get(pk=customer.pk).email_verified_at is not None

    entry = AuditLog.objects.get(action="customer.email_verification")
    assert entry.description == "Sent an email verification link"
    assert entry.account_type == "customer"

    assert admin.post(verify_url(make.user())).status_code == 200
    assert admin.post(verify_url(customer)).json()["message"] == "The email is already verified"


def test_email_verification_conflicts_when_verified_and_is_rate_limited(admin: APIClient) -> None:
    verified = make.user(email_verified_at=timezone.now())
    res = admin.post(verify_url(verified))
    assert res.status_code == 409
    assert res.json()["message"] == "The email is already verified"
    customer = make.user()
    assert admin.post(verify_url(customer)).status_code == 200
    assert admin.post(verify_url(customer)).status_code == 429
    assert AuditLog.objects.filter(action="customer.email_verification").count() == 1


def test_help_actions_need_customers_edit_and_a_customer(admin: APIClient) -> None:
    customer = make.user()
    viewer = operator("customers:view", "customers:status")
    for url in (reset_url(customer), verify_url(customer)):
        assert viewer.post(url).status_code == 403
        assert client_for(make.user(Role.FINANCE_ADMIN)).post(url).status_code == 403
    editor = operator("customers:edit")
    assert editor.post(reset_url(customer)).status_code == 200
    assert editor.post(verify_url(customer)).status_code == 200

    for other in (make.user(Role.RESTAURANT), make.user(Role.DELIVERY), make.user(Role.ADMIN)):
        for url in (reset_url(other), verify_url(other)):
            res = admin.post(url)
            assert res.status_code == 404
            assert res.json()["message"] == "Customer not found"
    unknown = "00000000-0000-4000-8000-000000000000"
    assert admin.post(reset_url(unknown)).status_code == 404
    assert admin.post(verify_url("not-an-id")).status_code == 422
