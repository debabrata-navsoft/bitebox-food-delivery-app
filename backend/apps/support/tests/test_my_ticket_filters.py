"""Global filters on "Help & support" (a requester's own tickets): multi-value filters (OR within
one, AND across), `?facets=1` counts over the requester's own tickets only, and 422s. Same cases
as node-js/backend/tests/partner-reviews-support-filters.test.js. Fictional data only."""

import itertools
from typing import Any

import pytest

from apps.accounts.models import User
from apps.rbac.roles import Role
from apps.support.models import SupportMessage, SupportTicket
from tests import factories as make
from tests.list_filters import at, counts, data, field_errors
from tests.list_filters import client_for as client

pytestmark = pytest.mark.django_db

TICKETS = "/api/v1/support/tickets"
_n = itertools.count(1)


def subjects(res: Any) -> set[str]:
    return {item["subject"] for item in data(res)["items"]}


def ticket(subject: str, by: User, day: str = "2026-03-10", **fields: Any) -> SupportTicket:
    row = SupportTicket.objects.create(
        number=f"TK-MINE-{next(_n):04d}",
        raised_by=by,
        requester_role=fields.pop("requester_role", "restaurant"),
        requester_name=by.name,
        type=fields.pop("type", "account"),
        subject=subject,
        **fields,
    )
    when = at(day)
    SupportTicket.objects.filter(pk=row.pk).update(created_at=when)
    return row


@pytest.fixture
def world() -> dict[str, Any]:
    partner = make.user(Role.RESTAURANT, name="Neel Fictional")
    other = make.user(Role.RESTAURANT, name="Ivy Fictional")
    menu = ticket("Menu upload fails", partner, status="open")
    ticket("Payout missing", partner, type="payment", status="waiting_for_response")
    ticket(
        "Refund dispute",
        partner,
        type="refund",
        status="resolved",
        order_number="BB-260401-ABC123",
        day="2026-03-12",
    )
    ticket("Old account question", partner, status="closed", day="2026-03-14")
    # Somebody else's tickets: never listed or counted.
    ticket("Not yours", other, type="payment", status="waiting_for_response")
    ticket("Not yours either", other, type="refund", status="closed")
    # A staff-only note on the partner's own ticket: the search never reads notes.
    SupportMessage.objects.create(
        ticket=menu,
        author=make.user(Role.SUPPORT_ADMIN),
        author_role="support_admin",
        author_name="Mira Support",
        body="Internal: escalate quietly",
        internal=True,
    )
    return {"c": client(partner)}


def test_filters_take_several_values_and_combine(world: dict[str, Any]) -> None:
    c = world["c"]
    mine = {"Menu upload fails", "Payout missing", "Refund dispute", "Old account question"}
    assert subjects(c.get(TICKETS)) == mine
    # The older values still work: open = not resolved or closed yet; closed = resolved or closed.
    assert subjects(c.get(TICKETS, {"status": "open"})) == {"Menu upload fails", "Payout missing"}
    assert subjects(c.get(TICKETS, {"status": "closed"})) == {
        "Refund dispute",
        "Old account question",
    }
    assert subjects(c.get(TICKETS, {"status": "waiting_for_response,closed"})) == {
        "Payout missing",
        "Refund dispute",
        "Old account question",
    }
    assert subjects(c.get(TICKETS, {"type": "payment,refund"})) == {
        "Payout missing",
        "Refund dispute",
    }
    assert subjects(c.get(TICKETS, {"type": "payment,refund", "status": "closed"})) == {
        "Refund dispute"
    }
    assert subjects(c.get(TICKETS, {"createdFrom": "2026-03-12", "createdTo": "2026-03-13"})) == {
        "Refund dispute"
    }
    assert subjects(c.get(TICKETS, {"search": "ABC123"})) == {"Refund dispute"}
    assert subjects(c.get(TICKETS, {"search": "not yours"})) == set()
    assert subjects(c.get(TICKETS, {"search": "quietly"})) == set()


def test_facets_count_own_tickets_over_the_other_filters(world: dict[str, Any]) -> None:
    c = world["c"]
    assert "facets" not in data(c.get(TICKETS))
    everything = c.get(TICKETS, {"facets": "1"})
    assert counts(everything, "status") == {"open": 2, "waiting_for_response": 1, "closed": 2}
    assert counts(everything, "type") == {
        "order_issue": 0,
        "delivery": 0,
        "payment": 1,
        "refund": 1,
        "account": 2,
        "other": 0,
    }
    res = c.get(TICKETS, {"status": "closed", "facets": "1"})
    assert subjects(res) == {"Refund dispute", "Old account question"}
    assert counts(res, "status") == {"open": 2, "waiting_for_response": 1, "closed": 2}
    assert counts(res, "type")["refund"] == 1
    assert counts(res, "type")["payment"] == 0
    # The list rows carry no messages (and so no internal notes).
    assert all(item["messages"] == [] for item in data(res)["items"])


def test_invalid_values_are_422(world: dict[str, Any]) -> None:
    c = world["c"]
    assert field_errors(c.get(TICKETS, {"status": "in_progress"}))["status"] == "Invalid value"
    assert field_errors(c.get(TICKETS, {"type": "billing"}))["type"] == "Invalid value"
    assert "createdTo" in field_errors(
        c.get(TICKETS, {"createdFrom": "2026-03-12", "createdTo": "2026-03-01"})
    )
