"""
Readable names for the records an audit entry is about ("Peter Cat", "Coupon XMAS40",
"PAN card · Asha Rao"), so the log reads without looking ids up.

`label_of` names one record (used when an entry is written, before a delete removes it);
`labels_for` names many at once (used when listing older entries that have no stored name).
Unknown types, bad ids and missing records give "" — the log then shows the record type.
"""

import uuid
from collections import defaultdict
from collections.abc import Callable, Iterable
from typing import Any

from django.apps import apps

KYC_KINDS = {
    "fssai_licence": "FSSAI licence",
    "gst_certificate": "GST certificate",
    "pan_card": "PAN card",
    "cancelled_cheque": "Cancelled cheque",
    "driving_licence": "Driving licence",
    "vehicle_rc": "Vehicle RC",
    "id_proof": "ID proof",
}


def _user(u: Any) -> str:
    return (getattr(u, "name", "") or getattr(u, "email", "")) if u else ""


def _coupon(c: Any) -> str:
    return f"{c.name} ({c.code})" if c.name and c.code else c.name or c.code


# type -> (model, related fields to load, how to name one record)
NAMERS: dict[str, tuple[str, tuple[str, ...], Callable[[Any], str]]] = {
    "user": ("accounts.User", (), _user),
    "restaurant": ("restaurants.Restaurant", (), lambda r: r.name),
    "coupon": ("coupons.Coupon", (), _coupon),
    "category": ("menus.FoodCategory", (), lambda c: c.name),
    "food": ("menus.FoodItem", ("restaurant",), lambda f: f"{f.name} · {f.restaurant.name}"),
    "kyc_document": (
        "kyc.KycDocument",
        ("user",),
        lambda d: f"{KYC_KINDS.get(d.kind, d.kind)} · {_user(d.user)}",
    ),
    "order": ("orders.Order", (), lambda o: f"Order {o.order_number}"),
    "payment": (
        "payments.Payment",
        ("order",),
        lambda p: f"Payment · order {p.order.order_number}",
    ),
    "refund": (
        "payments.Refund",
        ("payment__order",),
        lambda r: f"Refund · order {r.payment.order.order_number}",
    ),
    "payout": ("finance.Payout", (), lambda p: f"Payout · {p.payee_name}" if p.payee_name else ""),
    "review": (
        "reviews.Review",
        (),
        lambda r: f"Review by {r.customer_name}" if r.customer_name else "",
    ),
    "ticket": ("support.SupportTicket", (), lambda t: f"Ticket {t.number} · {t.subject}"),
    "reward_campaign": ("coins.RewardCampaign", (), lambda c: c.name),
    "referral": ("coins.Referral", ("referred",), lambda r: f"Referral of {_user(r.referred)}"),
    "coin_transaction": ("coins.CoinTransaction", ("user",), lambda t: f"Coins · {_user(t.user)}"),
}


def _valid(ids: Iterable[str]) -> list[str]:
    out = []
    for i in ids:
        try:
            out.append(str(uuid.UUID(str(i))))
        except (ValueError, TypeError):
            continue
    return out


def labels_for(pairs: Iterable[tuple[str, str]]) -> dict[tuple[str, str], str]:
    """{(type, id): name} for every record that still exists; one query per type."""
    by_type: dict[str, set[str]] = defaultdict(set)
    for kind, rid in pairs:
        if kind in NAMERS and rid:
            by_type[kind].add(rid)
    names: dict[tuple[str, str], str] = {}
    for kind, ids in by_type.items():
        model_label, related, name = NAMERS[kind]
        valid = _valid(ids)
        if not valid:
            continue
        qs = apps.get_model(model_label).objects.filter(pk__in=valid)
        if related:
            qs = qs.select_related(*related)
        for obj in qs:
            try:
                names[(kind, str(obj.pk))] = str(name(obj) or "")[:200]
            except Exception:  # noqa: S112 (a name is a nicety; never fail the log)
                continue
    return names


def label_of(kind: str, rid: Any) -> str:
    """The name of one record ("" if unknown or gone)."""
    if not rid:
        return ""
    key = (kind, str(rid))
    return labels_for([key]).get(key, "")
