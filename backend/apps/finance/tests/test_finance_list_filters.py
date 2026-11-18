"""Global filters on the admin finance lists: multi-value filters (OR within one, AND across) and
`?facets=1` counts on transactions, the refund queue, payout history and the ledger. Same cases
as node-js/backend/tests/admin-filters-finance.test.js. Fictional data only."""

import uuid
from datetime import datetime
from typing import Any
from unittest import mock

import pytest
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.finance.models import LedgerEntry, Payout
from apps.orders.models import Order
from apps.payments.models import Payment
from apps.rbac.roles import Role
from apps.restaurants.models import Restaurant
from tests import factories as make
from tests.list_filters import at, client_for, counts, data, field_errors

pytestmark = pytest.mark.django_db

PAYMENTS = "/api/v1/admin/payments"
REFUNDS = "/api/v1/admin/finance/refunds"
PAYOUTS = "/api/v1/admin/finance/payouts"
LEDGER = "/api/v1/admin/finance/ledger"


@pytest.fixture
def admin() -> APIClient:
    return client_for(make.user(Role.ADMIN))


def ids(res: Any) -> set[str]:
    return {item["id"] for item in data(res)["items"]}


def payment(
    restaurant: Restaurant,
    *,
    order_status: str = "delivered",
    method: str = "cod",
    provider: str = "cash_on_delivery",
    status: str = "paid",
    customer: User | None = None,
    **fields: Any,
) -> Payment:
    order = make.order(
        restaurant=restaurant,
        status=order_status,
        payment_method=method,
        payment_status=status,
        **({"customer": customer} if customer else {}),
    )
    return Payment.objects.create(
        order=order,
        user=order.customer,
        method=method,
        provider=provider,
        amount_paise=order.total_paise,
        status=status,
        **fields,
    )


def pks(*rows: Any) -> set[str]:
    return {str(r.pk) for r in rows}


# --- transactions -------------------------------------------------------------------------------


def test_payments_multi_value_filters_and_facets(admin: APIClient) -> None:
    amber = make.restaurant(name="Amber Spoon")
    birch = make.restaurant(name="Birch Table")
    asha = make.user(name="Asha Fictional")
    a = payment(amber, order_status="pending", status="pending", customer=asha)
    b = payment(amber, method="online", provider="razorpay")
    c = payment(birch, order_status="cancelled", method="online", provider="mock")
    d = payment(birch, order_status="rejected", method="online", provider="razorpay")
    d.status = "refunded"
    d.save()

    def found(params: str) -> set[str]:
        return ids(admin.get(f"{PAYMENTS}?{params}"))

    assert found("status=pending") == pks(a)  # one value as before
    assert found("status=pending,refunded") == pks(a, d)
    assert found("method=online") == pks(b, c, d)
    assert found("provider=mock,cash_on_delivery") == pks(a, c)
    assert found("orderState=cancelled") == pks(c, d)  # rejected counts as cancelled
    assert found("orderState=active,delivered") == pks(a, b)
    assert found(f"restaurant={birch.pk}") == pks(c, d)
    assert found(f"restaurant={amber.pk},{birch.pk}") == pks(a, b, c, d)
    assert found(f"restaurant={birch.pk}&provider=razorpay") == pks(d)  # AND across
    assert found("method=online&status=paid&search=Asha") == set()
    assert found("search=asha fictional") == pks(a)

    assert "facets" not in data(admin.get(PAYMENTS))
    res = admin.get(f"{PAYMENTS}?method=online&provider=razorpay&facets=1&limit=1")
    page = data(res)
    assert page["pagination"]["total"] == 2
    assert len(page["items"]) == 1
    assert list(page["facets"]) == ["status", "method", "provider", "orderState", "restaurant"]
    assert page["facets"]["status"] == [
        {"value": "pending", "count": 0},
        {"value": "paid", "count": 1},
        {"value": "failed", "count": 0},
        {"value": "refunded", "count": 1},
        {"value": "partially_refunded", "count": 0},
        {"value": "cancelled", "count": 0},
    ]
    # method: over the Razorpay payments, its own selection left out
    assert counts(res, "method") == {"cod": 0, "online": 2}
    # provider: over the online payments
    assert counts(res, "provider") == {"cash_on_delivery": 0, "razorpay": 2, "mock": 1}
    assert counts(res, "orderState") == {"active": 0, "delivered": 1, "cancelled": 1}
    # restaurant: id facets carry the name; only those that occur, by count then name
    assert page["facets"]["restaurant"] == [
        {"value": str(amber.pk), "label": "Amber Spoon", "count": 1},
        {"value": str(birch.pk), "label": "Birch Table", "count": 1},
    ]
    res = admin.get(f"{PAYMENTS}?restaurant={amber.pk}&facets=1")
    assert len(counts(res, "restaurant")) == 2
    assert counts(res, "orderState") == {"active": 1, "delivered": 1, "cancelled": 0}

    assert field_errors(
        admin.get(
            f"{PAYMENTS}?status=paid,lost&method=card&provider=x&orderState=gone"
            f"&restaurant={amber.pk},nope&facets=maybe"
        )
    ) == {
        "status": "Invalid value",
        "method": "Invalid value",
        "provider": "Invalid value",
        "orderState": "Invalid value",
        "restaurant": "Invalid value",
        "facets": "Invalid value",
    }


# --- refund queue -------------------------------------------------------------------------------


def test_refunds_multi_value_filters_and_facets(admin: APIClient) -> None:
    amber = make.restaurant(name="Amber Spoon")
    birch = make.restaurant(name="Birch Table")
    online = {"method": "online", "provider": "mock"}
    needed = payment(amber, order_status="cancelled", **online)
    refunded = payment(amber, order_status="rejected", status="refunded", **online)
    partly = payment(birch, order_status="delivered", status="partially_refunded", **online)
    payment(birch, order_status="delivered", **online)  # paid and delivered: not in the queue
    payment(birch, order_status="cancelled", status="cancelled")  # cash, never paid
    Payment.objects.filter(pk=needed.pk).update(updated_at=at("2026-03-01", 0))
    Payment.objects.filter(pk=refunded.pk).update(updated_at=at("2026-03-02", 23))
    Payment.objects.filter(pk=partly.pk).update(updated_at=at("2026-03-03", 12))

    def found(params: str) -> set[str]:
        return ids(admin.get(f"{REFUNDS}?{params}"))

    assert found("") == pks(needed, refunded, partly)
    assert found("state=needed") == pks(needed)  # one value as before
    assert found("state=refunded") == pks(refunded, partly)  # fully or partly
    assert found("state=needed,refunded") == pks(needed, refunded, partly)
    assert found(f"restaurant={birch.pk}") == pks(partly)
    assert found(f"state=refunded&restaurant={amber.pk}") == pks(refunded)  # AND across
    assert found("updatedFrom=2026-03-02&updatedTo=2026-03-03") == pks(refunded, partly)
    assert found("updatedTo=2026-03-01") == pks(needed)
    assert found(f"search={needed.order.order_number}") == pks(needed)

    assert "facets" not in data(admin.get(REFUNDS))
    res = admin.get(f"{REFUNDS}?state=refunded&restaurant={amber.pk}&facets=1&limit=1")
    page = data(res)
    assert page["pagination"]["total"] == 1
    assert list(page["facets"]) == ["state", "restaurant"]
    assert page["facets"]["state"] == [
        {"value": "needed", "count": 1},
        {"value": "refunded", "count": 1},
    ]
    assert page["facets"]["restaurant"] == [
        {"value": str(amber.pk), "label": "Amber Spoon", "count": 1},
        {"value": str(birch.pk), "label": "Birch Table", "count": 1},
    ]

    assert field_errors(
        admin.get(f"{REFUNDS}?state=needed,lost&restaurant=nope&updatedFrom=2026-02-30")
    ) == {"state": "Invalid value", "restaurant": "Invalid value", "updatedFrom": "Invalid value"}
    assert field_errors(admin.get(f"{REFUNDS}?updatedFrom=2026-03-04&updatedTo=2026-03-01")) == {
        "updatedTo": "Must be on or after updatedFrom"
    }


# --- payout history -----------------------------------------------------------------------------


def test_payouts_multi_value_filters_and_facets(admin: APIClient) -> None:
    amber = make.restaurant(name="Amber Spoon")
    birch = make.restaurant(name="Birch Table")
    ravi = make.user(Role.DELIVERY, name="Ravi Rider")
    mira = make.user(Role.DELIVERY, name="Mira Rider")
    by = make.user(Role.ADMIN)

    def payout(type: str, payee: User, restaurant: Restaurant | None = None, **f: Any) -> Payout:
        when = f.pop("created_at", None)
        p = Payout.objects.create(
            type=type,
            payee=payee,
            payee_name=restaurant.name if restaurant else payee.name,
            restaurant=restaurant,
            amount_paise=10_000,
            created_by=by,
            **f,
        )
        if when:
            Payout.objects.filter(pk=p.pk).update(created_at=when)
        return p

    r1 = payout("restaurant", amber.owner, amber, created_at=at("2026-03-01", 0))
    r2 = payout("restaurant", amber.owner, amber, status="paid", reference="UTR-FICT-1")
    r3 = payout("restaurant", birch.owner, birch, status="cancelled")
    d1 = payout("rider", ravi, created_at=at("2026-03-02", 23))
    d2 = payout("rider", mira, status="paid")

    def found(params: str) -> set[str]:
        return ids(admin.get(f"{PAYOUTS}?{params}"))

    assert found("type=restaurant") == pks(r1, r2, r3)  # one value as before
    assert found("type=restaurant,rider") == pks(r1, r2, r3, d1, d2)
    assert found("type=restaurant&status=pending,cancelled") == pks(r1, r3)
    assert found(f"restaurant={amber.pk}") == pks(r1, r2)
    assert found(f"restaurant={amber.pk},{birch.pk}&status=paid") == pks(r2)  # AND across
    assert found(f"rider={ravi.pk}") == pks(d1)  # one rider (their account page)
    assert found(f"rider={ravi.pk},{mira.pk}") == pks(d1, d2)
    assert found(f"rider={amber.owner.pk}") == set()  # rider payouts only
    assert found("createdFrom=2026-03-01&createdTo=2026-03-02") == pks(r1, d1)
    assert found("search=utr-fict") == pks(r2)
    assert found("type=rider&search=mira") == pks(d2)

    assert "facets" not in data(admin.get(f"{PAYOUTS}?type=restaurant"))
    res = admin.get(f"{PAYOUTS}?type=restaurant&status=pending,paid&facets=1&limit=1")
    page = data(res)
    assert page["pagination"]["total"] == 2
    assert list(page["facets"]) == ["status", "restaurant", "rider"]
    assert page["facets"]["status"] == [
        {"value": "pending", "count": 1},
        {"value": "paid", "count": 1},
        {"value": "cancelled", "count": 1},
    ]
    assert page["facets"]["restaurant"] == [
        {"value": str(amber.pk), "label": "Amber Spoon", "count": 2}
    ]
    assert page["facets"]["rider"] == []  # restaurant payouts have no rider
    res = admin.get(f"{PAYOUTS}?type=rider&rider={ravi.pk}&facets=1")
    assert data(res)["facets"]["rider"] == [
        {"value": str(mira.pk), "label": "Mira Rider", "count": 1},
        {"value": str(ravi.pk), "label": "Ravi Rider", "count": 1},
    ]
    assert counts(res, "status") == {"pending": 1, "paid": 0, "cancelled": 0}

    assert field_errors(
        admin.get(f"{PAYOUTS}?type=bank&status=paid,lost&restaurant=x&rider={uuid.uuid4()},y")
    ) == {
        "type": "Invalid value",
        "status": "Invalid value",
        "restaurant": "Invalid value",
        "rider": "Invalid value",
    }


# --- ledger -------------------------------------------------------------------------------------


def test_ledger_multi_value_filters_and_facets(admin: APIClient) -> None:
    order = make.order(order_number="BB-FICT-000001")

    def group(key: str, lines: list[tuple[str, int]], description: str, when: datetime) -> None:
        group = uuid.uuid4()
        with mock.patch("django.utils.timezone.now", return_value=when):
            for account, amount in lines:
                LedgerEntry.objects.create(
                    entry_group=group,
                    key=key,
                    account=account,
                    amount_paise=amount,
                    order=order if key.startswith(("settle", "refund")) else None,
                    description=description,
                )

    group(
        f"settle:{order.pk}",
        [
            ("customer_payments", 30_000),
            ("restaurant_payable", -20_000),
            ("rider_payable", -10_000),
        ],
        "Order BB-FICT-000001 delivered",
        at("2026-03-01", 0),
    )
    group(
        "payout:p1",
        [("restaurant_payable", 20_000), ("payouts", -20_000)],
        "Payout to Amber Spoon",
        at("2026-03-02", 23),
    )
    group(
        "refund:r1",
        [("customer_payments", -5_000), ("restaurant_payable", 5_000)],
        "Refund on order BB-FICT-000001",
        at("2026-03-04", 9),
    )

    def descriptions(params: str) -> list[str]:
        items = data(admin.get(f"{LEDGER}?{params}"))["items"]
        return [f"{e['description']}/{e['account']}" for e in items]

    assert len(descriptions("")) == 7
    assert len(descriptions("account=restaurant_payable")) == 3
    assert len(descriptions("account=payouts,rider_payable")) == 2
    assert sorted(descriptions("event=payout")) == [
        "Payout to Amber Spoon/payouts",
        "Payout to Amber Spoon/restaurant_payable",
    ]
    assert len(descriptions("event=settlement,refund")) == 5
    assert len(descriptions("event=settlement,refund&account=customer_payments")) == 2  # AND
    assert len(descriptions("createdFrom=2026-03-02&createdTo=2026-03-04")) == 4
    assert len(descriptions("search=amber spoon")) == 2
    assert len(descriptions("search=bb-fict-000001")) == 5

    plain = data(admin.get(f"{LEDGER}?account=payouts"))
    assert "facets" not in plain
    # the balances stay over the whole ledger
    balances = {a["account"]: a["balancePaise"] for a in plain["accounts"]}
    assert balances["customer_payments"] == 25_000
    assert plain["balanced"] is True

    res = admin.get(f"{LEDGER}?account=restaurant_payable&event=payout,refund&facets=1&limit=1")
    page = data(res)
    assert page["pagination"]["total"] == 2
    assert list(page["facets"]) == ["account", "event"]
    # account: over the payout and refund entries
    assert page["facets"]["account"] == [
        {"value": "customer_payments", "count": 1},
        {"value": "restaurant_payable", "count": 2},
        {"value": "rider_payable", "count": 0},
        {"value": "platform_revenue", "count": 0},
        {"value": "tax_payable", "count": 0},
        {"value": "payouts", "count": 1},
    ]
    # event: over the restaurant payable entries
    assert page["facets"]["event"] == [
        {"value": "settlement", "count": 1},
        {"value": "payout", "count": 1},
        {"value": "refund", "count": 1},
    ]

    assert field_errors(
        admin.get(f"{LEDGER}?account=cash&event=payout,gift&createdTo=2026-02-30")
    ) == {"account": "Invalid value", "event": "Invalid value", "createdTo": "Invalid value"}
    assert Order.objects.count() == 1
