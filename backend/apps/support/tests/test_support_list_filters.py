"""Global filters on the admin support queue: multi-value filters (OR within one, AND across) and
`?facets=1` counts. Same cases as node-js/backend/tests/admin-filters-support.test.js. Fictional
data only."""

import itertools
from typing import Any

import pytest

from apps.accounts.models import User
from apps.rbac.roles import Role
from apps.support.models import SupportTicket
from tests import factories as make
from tests.list_filters import at, counts, data, field_errors
from tests.list_filters import client_for as client

pytestmark = pytest.mark.django_db

TICKETS = "/api/v1/admin/support/tickets"
_n = itertools.count(1)


def subjects(res: Any) -> set[str]:
    return {item["subject"] for item in data(res)["items"]}


def ticket(subject: str, by: User, day: str = "2026-03-10", **fields: Any) -> SupportTicket:
    row = SupportTicket.objects.create(
        number=f"TK-TEST-{next(_n):04d}",
        raised_by=by,
        requester_role=fields.pop("requester_role", "customer"),
        requester_name=by.name,
        type=fields.pop("type", "account"),
        subject=subject,
        **fields,
    )
    when = at(day)
    SupportTicket.objects.filter(pk=row.pk).update(created_at=when)
    return row


@pytest.fixture
def desk() -> dict[str, Any]:
    me = make.user(Role.SUPPORT_ADMIN, name="Mira Support")
    other = make.user(Role.SUPPORT_ADMIN, name="Kabir Support")
    customer = make.user(name="Tara Fictional")
    partner = make.user(Role.RESTAURANT, name="Neel Fictional")
    ticket("Late order", customer, priority="high", status="open", assignee=me)
    ticket("Wrong dish", customer, type="order_issue", priority="urgent", status="in_progress")
    ticket(
        "Refund please",
        customer,
        type="refund",
        priority="high",
        status="resolved",
        assignee=other,
        day="2026-03-12",
    )
    ticket(
        "Menu update",
        partner,
        requester_role="restaurant",
        priority="low",
        status="waiting_for_response",
        assignee=other,
        day="2026-03-14",
    )
    ticket("Old issue", partner, requester_role="restaurant", status="closed", day="2026-03-14")
    return {"c": client(me), "me": me, "other": other}


def test_option_filters_take_several_values_and_combine(desk: dict[str, Any]) -> None:
    c = desk["c"]
    assert subjects(c.get(TICKETS, {"status": "open,resolved"})) == {"Late order", "Refund please"}
    assert subjects(c.get(TICKETS, {"priority": "high,urgent", "status": "active"})) == {
        "Late order",
        "Wrong dish",
    }
    assert subjects(c.get(TICKETS, {"requesterRole": "restaurant", "priority": "low"})) == {
        "Menu update"
    }
    assert subjects(c.get(TICKETS, {"type": "refund,order_issue"})) == {
        "Refund please",
        "Wrong dish",
    }
    # One value still works as before.
    assert subjects(c.get(TICKETS, {"status": "closed"})) == {"Old issue"}


def test_assignee_takes_me_unassigned_and_admin_ids(desk: dict[str, Any]) -> None:
    c, other = desk["c"], desk["other"]
    assert subjects(c.get(TICKETS, {"assignee": "me"})) == {"Late order"}
    assert subjects(c.get(TICKETS, {"assignee": "unassigned"})) == {"Wrong dish", "Old issue"}
    assert subjects(c.get(TICKETS, {"assignee": f"me,{other.pk}"})) == {
        "Late order",
        "Refund please",
        "Menu update",
    }


def test_created_days_and_search_narrow_the_list(desk: dict[str, Any]) -> None:
    c = desk["c"]
    assert subjects(c.get(TICKETS, {"createdFrom": "2026-03-12", "createdTo": "2026-03-13"})) == {
        "Refund please"
    }
    assert subjects(c.get(TICKETS, {"createdFrom": "2026-03-14", "search": "menu"})) == {
        "Menu update"
    }


def test_facets_count_each_option_over_the_other_filters(desk: dict[str, Any]) -> None:
    c, me, other = desk["c"], desk["me"], desk["other"]
    plain = data(c.get(TICKETS))
    assert "facets" not in plain
    res = c.get(TICKETS, {"status": "open,in_progress", "priority": "high", "facets": "1"})
    assert subjects(res) == {"Late order"}
    # status ignores its own selection but applies priority=high
    assert counts(res, "status") == {
        "open": 1,
        "in_progress": 0,
        "waiting_for_response": 0,
        "resolved": 1,
        "closed": 0,
    }
    assert counts(res, "priority") == {"low": 0, "medium": 0, "high": 1, "urgent": 1}
    assert counts(res, "type")["account"] == 1
    assert counts(res, "requesterRole") == {"customer": 1, "restaurant": 0, "delivery": 0}
    everyone = data(c.get(TICKETS, {"facets": "true"}))["facets"]["assignee"]
    assert everyone[0] == {"value": "unassigned", "label": "Not assigned", "count": 2}
    assert everyone[1:] == [
        {"value": str(other.pk), "label": "Kabir Support", "count": 2},
        {"value": str(me.pk), "label": "Mira Support", "count": 1},
    ]


def test_invalid_values_are_422(desk: dict[str, Any]) -> None:
    c = desk["c"]
    assert field_errors(c.get(TICKETS, {"status": "open,bogus"}))["status"] == "Invalid value"
    assert field_errors(c.get(TICKETS, {"assignee": "someone"}))["assignee"] == "Invalid value"
    assert field_errors(c.get(TICKETS, {"priority": "top"}))["priority"] == "Invalid value"
    assert "createdFrom" in field_errors(c.get(TICKETS, {"createdFrom": "14-03-2026"}))
    assert "createdTo" in field_errors(
        c.get(TICKETS, {"createdFrom": "2026-03-14", "createdTo": "2026-03-10"})
    )
    assert field_errors(c.get(TICKETS, {"facets": "maybe"}))["facets"] == "Invalid value"
