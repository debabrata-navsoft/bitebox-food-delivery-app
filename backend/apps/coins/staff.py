"""
Super admin views over the coin ledger: transactions, wallets, reversals and reports (Node:
services/rewards-admin.service.js).
"""

from collections.abc import Mapping
from datetime import timedelta
from typing import Any
from zoneinfo import ZoneInfo

from django.conf import settings
from django.db.models import Count, Q, QuerySet, Sum
from django.db.models.functions import TruncDate
from django.utils import timezone

from apps.accounts.models import User
from apps.finance.reports import day_keys
from common.api import ApiError
from common.filters import Facet, apply_facets, with_facets
from common.pagination import Page, paginate

from . import referrals, wallet
from .models import (
    CampaignStatus,
    CoinBatch,
    CoinSource,
    CoinTransaction,
    CoinWallet,
    ReversalOf,
    RewardCampaign,
    TxnType,
)
from .quote import coins_to_paise, get_reward_config

T = TxnType
S = CoinSource
person = referrals.person


def staff_txn_view(row: CoinTransaction) -> dict[str, Any]:
    """A ledger row with everything staff may see."""
    created_by = row.created_by if row.created_by_id else None
    return {
        **wallet.customer_txn_view(row),
        "seq": row.seq,
        "status": row.status,
        "reversal_of": row.reversal_of or None,
        "requested_coins": row.requested_coins,
        "shortfall": row.shortfall,
        "available_before": row.available_before,
        "available_after": row.available_after,
        "reserved_before": row.reserved_before,
        "reserved_after": row.reserved_after,
        "idempotency_key": row.idempotency_key,
        "campaign_id": str(row.campaign_id) if row.campaign_id else None,
        "referral_id": str(row.referral_id) if row.referral_id else None,
        "related_txn_id": str(row.related_txn_id) if row.related_txn_id else None,
        "note": row.note or None,
        "created_by": person(created_by),
        "customer": person(row.user),
        "allocations": [
            {
                "source": a.source,
                "coins": a.coins,
                "earned_at": a.earned_at,
                "expires_at": a.expires_at,
            }
            for a in row.allocations.all()
        ],
    }


def _rows() -> Any:
    return CoinTransaction.objects.select_related(
        "user", "created_by", "campaign"
    ).prefetch_related("allocations")


# The coin transactions list's Filters panel; campaign: the campaigns rows came from, with names.
TXN_FACETS = (
    Facet("type", values=T.values),
    Facet("source", values=S.values),
    Facet("campaign", field="campaign_id", label="campaign__name"),
)


def transaction_rows(query: Mapping[str, Any]) -> QuerySet[CoinTransaction]:
    """Posted rows matching the facets, one customer (`user_id`), from/to (instants) and a
    customer search (name, email, phone)."""
    qs = apply_facets(CoinTransaction.objects.filter(status="posted"), query, TXN_FACETS)
    if query.get("user_id"):
        qs = qs.filter(user_id=query["user_id"])
    if query.get("from"):
        qs = qs.filter(created_at__gte=query["from"])
    if query.get("to"):
        qs = qs.filter(created_at__lte=query["to"])
    if query.get("search"):
        qs = qs.filter(user_id__in=referrals.matching_user_ids(query["search"]))
    return qs


def list_transactions(query: dict[str, Any], page: Page) -> dict[str, Any]:
    qs = transaction_rows(query).select_related("user", "created_by", "campaign")
    rows, meta = paginate(qs.prefetch_related("allocations").order_by("-created_at", "-pk"), page)
    result = {"items": [staff_txn_view(r) for r in rows], "pagination": meta}
    return with_facets(result, query, transaction_rows, TXN_FACETS)


def get_transaction(txn_id: Any) -> dict[str, Any]:
    row = _rows().filter(pk=txn_id).first()
    if row is None:
        raise ApiError.not_found("Transaction not found")
    related = _rows().filter(related_txn=row).order_by("seq")
    return {
        "transaction": {
            **staff_txn_view(row),
            "campaign": (
                {"id": str(row.campaign.pk), "name": row.campaign.name} if row.campaign else None
            ),
        },
        "related": [staff_txn_view(r) for r in related],
    }


def reverse_transaction(
    admin: User, txn_id: Any, data: dict[str, Any], request_key: str
) -> dict[str, Any]:
    """
    Staff claw back coins from an earned reward (refund, fraud). Partial amounts add up to at most
    the reward; spent coins become a shortfall, never a negative balance. `request_key` (the
    Idempotency-Key header) makes the request safe to repeat.
    """
    row = CoinTransaction.objects.filter(pk=txn_id).first()
    if row is None:
        raise ApiError.not_found("Transaction not found")
    if row.type != T.CREDIT:
        raise ApiError.conflict("Only earned rewards can be reversed", "NOT_REVERSIBLE")
    result = wallet.reverse_credit(
        row.user_id,
        credit_key=row.idempotency_key,
        coins=data.get("coins"),
        key=f"admin-reversal:{row.pk}:{request_key}",
        description="Reward reversed by BiteBox",
        note=data["reason"],
        created_by_id=admin.pk,
    )
    return get_transaction(result.row().pk)


def wallet_detail(user_id: Any) -> dict[str, Any]:
    """One customer's wallet, its batches, the ledger check, and recent history."""
    user = User.objects.filter(pk=user_id).first()
    if user is None:
        raise ApiError.not_found("Customer not found")
    raw = CoinWallet.objects.filter(user=user).first()
    batches = (
        CoinBatch.objects.filter(wallet=raw, remaining__gt=0).order_by("earned_at", "pk")
        if raw
        else []
    )
    recent = _rows().filter(user=user, status="posted").order_by("-seq")[:20]
    return {
        "customer": {
            **(person(user) or {}),
            "role": user.role,
            "status": user.status,
            "referral_code": user.referral_code or None,
        },
        "wallet": {
            **wallet.wallet_summary(user.pk),
            "uncollected_reversal": raw.uncollected_reversal if raw else 0,
            "seq": raw.seq if raw else 0,
        },
        "batches": [
            {
                "source": b.source,
                "original": b.original,
                "remaining": b.remaining,
                "earned_at": b.earned_at,
                "expires_at": b.expires_at,
            }
            for b in batches
        ],
        "integrity": wallet.reconcile(user.pk),
        "recent": [staff_txn_view(r) for r in recent],
    }


# ---------------------------------------------------------------------------
# Reports
# ---------------------------------------------------------------------------
REDEMPTION_REFUND = Q(type=T.REVERSAL, reversal_of=ReversalOf.REDEMPTION)
TOTALS: dict[str, Q] = {
    "issued": Q(type=T.CREDIT),
    "redeemed": Q(type=T.DEBIT),
    "refunded_redemptions": REDEMPTION_REFUND,
    "expired": Q(type=T.EXPIRE),
    "reversed": Q(type=T.REVERSAL, reversal_of=ReversalOf.CREDIT),
    "order_rewards": Q(type=T.CREDIT, source=S.ORDER_REWARD),
    "review_rewards": Q(type=T.CREDIT, source=S.REVIEW_REWARD),
    "referral_rewards": Q(type=T.CREDIT, source=S.REFERRAL_REWARD),
    "welcome_rewards": Q(type=T.CREDIT, source=S.WELCOME_REWARD),
    "birthday_rewards": Q(type=T.CREDIT, source=S.BIRTHDAY_REWARD),
    "promotional_rewards": Q(type=T.CREDIT, source__in=[S.FESTIVAL_REWARD, S.PROMOTIONAL_REWARD]),
}


def _totals(qs: Any) -> dict[str, int]:
    sums = qs.aggregate(**{k: Sum("coins", filter=q) for k, q in TOTALS.items()})
    out = {k: int(v or 0) for k, v in sums.items()}
    out["net_redeemed"] = out["redeemed"] - out["refunded_redemptions"]
    return out


def reports(days: int = 30) -> dict[str, Any]:
    now = timezone.now()
    since = now - timedelta(days=days)
    config = get_reward_config()
    posted = wallet.posted()
    tz = ZoneInfo(settings.REPORT_TIMEZONE)
    daily_rows = (
        posted.filter(created_at__gte=since)
        .annotate(day=TruncDate("created_at", tzinfo=tz))
        .values("day")
        .annotate(
            issued=Sum("coins", filter=TOTALS["issued"]),
            redeemed=Sum("coins", filter=TOTALS["redeemed"]),
            expired=Sum("coins", filter=TOTALS["expired"]),
        )
        .order_by()
    )
    by_day = {row["day"].isoformat(): row for row in daily_rows}
    daily = [
        {
            "date": key,
            **{
                f: int((by_day.get(key) or {}).get(f) or 0)
                for f in ("issued", "redeemed", "expired")
            },
        }
        for key in day_keys(days, now)
    ]
    owed = CoinWallet.objects.aggregate(
        # Aliases must not match field names: Django resolves a filter's `reserved` to the alias.
        total_available=Sum("available"),
        total_reserved=Sum("reserved"),
        wallets=Count("pk"),
        active=Count("pk", filter=Q(available__gt=0) | Q(reserved__gt=0)),
    )
    available = int(owed["total_available"] or 0)
    reserved = int(owed["total_reserved"] or 0)
    top = RewardCampaign.objects.filter(claims_count__gt=0).order_by("-coins_issued")[:10]
    referral_stats = referrals.stats()
    shortfalls = CoinWallet.objects.filter(uncollected_reversal__gt=0).aggregate(
        wallets=Count("pk"), coins=Sum("uncollected_reversal")
    )
    # Unusually fast earners over the last week (order rewards track real spend, so not those).
    earners = list(
        posted.filter(type=T.CREDIT, created_at__gte=now - timedelta(days=7))
        .exclude(source=S.ORDER_REWARD)
        .values("user")
        .annotate(coins=Sum("coins"), credits=Count("pk"))
        .order_by("-coins")[:5]
    )
    users = User.objects.in_bulk([e["user"] for e in earners])
    return {
        "days": days,
        "all_time": _totals(posted),
        "period": _totals(posted.filter(created_at__gte=since)),
        "daily": daily,
        "liability": {
            "coins": available + reserved,
            "paise": coins_to_paise(available + reserved, config),
            "available_coins": available,
            "reserved_coins": reserved,
        },
        "wallets": {"total": owed["wallets"] or 0, "active": owed["active"] or 0},
        "campaigns": {
            "active": RewardCampaign.objects.filter(status=CampaignStatus.ACTIVE).count(),
            "top": [
                {
                    "id": str(c.pk),
                    "name": c.name,
                    "type": c.type,
                    "status": c.status,
                    "claims": c.claims_count,
                    "coins": c.coins_issued,
                }
                for c in top
            ],
        },
        "referrals": referral_stats,
        "suspicious": {
            "held_referrals": referral_stats["held"],
            "flagged_referrals": referral_stats["flagged"],
            "uncollected_reversals": {
                "wallets": shortfalls["wallets"] or 0,
                "coins": int(shortfalls["coins"] or 0),
            },
            "top_earners": [
                {
                    "customer": person(users.get(e["user"])),
                    "coins": int(e["coins"] or 0),
                    "credits": e["credits"],
                }
                for e in earners
            ],
        },
    }
