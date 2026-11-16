"""
Port of the Node API's tests/rewards-admin.test.js: access, settings, campaigns, the ledger,
reversals, reports and held referrals through /api/v1/admin/rewards.
"""

import json
from datetime import timedelta
from typing import Any

import pytest
from django.utils import timezone

from apps.accounts.tests.test_auth import create_and_login
from apps.audit.models import AuditLog
from apps.coins import wallet
from apps.coins.models import CoinTransaction, Referral
from apps.orders.tests.test_orders import client_for

from .helpers import RewardsWorld

pytestmark = pytest.mark.django_db
BASE = "/api/v1/admin/rewards"


@pytest.fixture
def w() -> RewardsWorld:
    return RewardsWorld()


def audits(action: str) -> int:
    return AuditLog.objects.filter(action=action).count()


# --- access -------------------------------------------------------------------------------------


def test_is_limited_to_the_super_admin(w: RewardsWorld) -> None:
    finance = client_for(create_and_login("finance_admin")["token"])
    urls = [
        f"{BASE}/configuration",
        f"{BASE}/campaigns",
        f"{BASE}/claims",
        f"{BASE}/transactions",
        f"{BASE}/reports",
        f"{BASE}/referrals",
        f"{BASE}/wallets/{w.me}",
    ]
    for url in urls:
        assert w.a.get(url).status_code == 200, url
        for who in (w.c, w.o, w.r, finance):
            assert who.get(url).status_code == 403, url
    change = w.c.put(f"{BASE}/configuration", {"version": 0, "coinsEnabled": False}, format="json")
    assert change.status_code == 403


# --- configuration ------------------------------------------------------------------------------


def test_saves_settings_with_a_version_check_and_an_audit_entry(w: RewardsWorld) -> None:
    current = w.a.get(f"{BASE}/configuration").json()["data"]["configuration"]
    assert current["version"] == 0
    assert current["redemption"]["coinValueCoins"] == 100
    saved = w.a.put(
        f"{BASE}/configuration",
        {
            "version": 0,
            "redemption": {"coinValueCoins": 50, "coinValuePaise": 1000, "minCoins": 50},
            "expiry": {"days": {"ORDER_REWARD": 90}},
            "referral": {"referrerCoins": 75},
        },
        format="json",
    )
    assert saved.status_code == 200, saved.json()
    cfg = saved.json()["data"]["configuration"]
    assert [
        cfg["version"],
        cfg["redemption"]["coinValueCoins"],
        cfg["expiry"]["days"]["ORDER_REWARD"],
        cfg["referral"]["referrerCoins"],
    ] == [1, 50, 90, 75]
    assert cfg["updatedBy"] == w.admin["user"]["id"]
    assert audits("rewards.configure") == 1
    note = AuditLog.objects.get(action="rewards.configure").description
    assert note == "Updated reward settings: redemption, expiry, referral"

    stale = w.a.put(
        f"{BASE}/configuration", {"version": 0, "birthday": {"coins": 1}}, format="json"
    )
    assert stale.status_code == 409
    assert stale.json()["error"]["code"] == "CONFIG_CHANGED"
    bad = w.a.put(
        f"{BASE}/configuration",
        {"version": 1, "redemption": {"maxPercentOfOrder": 500}},
        format="json",
    )
    assert bad.status_code == 422
    assert bad.json()["error"]["details"][0]["field"] == "redemption.maxPercentOfOrder"
    no_version = w.a.put(f"{BASE}/configuration", {"birthday": {"coins": 1}}, format="json")
    assert no_version.status_code == 422

    # The new conversion is used at once.
    rules = w.c.get("/api/v1/coins/wallet").json()["data"]["rules"]
    assert rules["coinValueCoins"] == 50


def test_stops_earning_and_redeeming_when_coins_are_switched_off(w: RewardsWorld) -> None:
    res = w.a.put(f"{BASE}/configuration", {"version": 0, "coinsEnabled": False}, format="json")
    assert res.status_code == 200, res.json()
    w.gift(500)
    assert w.add(w.c, qty=2).status_code == 200
    assert w.c.put("/api/v1/cart/coins", {"coins": 200}, format="json").status_code == 422
    order = w.place_as(fill=False)
    w.deliver(order["id"])
    assert not CoinTransaction.objects.filter(source="ORDER_REWARD").exists()


# --- campaigns ----------------------------------------------------------------------------------


def test_creates_schedules_edits_and_reports_on_a_campaign(w: RewardsWorld) -> None:
    now = timezone.now()
    created = w.a.post(
        f"{BASE}/campaigns",
        {
            "name": "New Year cheer",
            "type": "FESTIVAL",
            "rewardCoins": 60,
            "startAt": (now - timedelta(seconds=1)).isoformat(),
            "endAt": (now + timedelta(days=2)).isoformat(),
            "limits": {"maxTotalClaims": 100, "maxTotalCoins": None},
            "unexpected": "dropped",
        },
        format="json",
    )
    assert created.status_code == 201, created.json()
    campaign_id = created.json()["data"]["campaign"]["id"]
    assert created.json()["data"]["campaign"]["status"] == "DRAFT"

    active = w.a.patch(
        f"{BASE}/campaigns/{campaign_id}/status", {"action": "activate"}, format="json"
    )
    assert active.json()["data"]["campaign"]["status"] == "ACTIVE"
    claim = w.c.post(f"/api/v1/rewards/campaigns/{campaign_id}/claim")
    assert claim.status_code == 201, claim.json()

    edit = w.a.put(f"{BASE}/campaigns/{campaign_id}", {"rewardCoins": 600}, format="json")
    assert edit.status_code == 409, "the reward cannot change while running"
    w.a.patch(f"{BASE}/campaigns/{campaign_id}/status", {"action": "pause"}, format="json")
    edit = w.a.put(f"{BASE}/campaigns/{campaign_id}", {"rewardCoins": 80}, format="json")
    assert edit.status_code == 200, edit.json()

    detail = w.a.get(f"{BASE}/campaigns/{campaign_id}").json()["data"]
    assert detail["performance"]["claims"] == 1
    assert detail["recentClaims"][0]["coins"] == 60
    claims = w.a.get(f"{BASE}/claims?rewardType=FESTIVAL").json()["data"]
    assert len(claims["items"]) == 1
    assert audits("rewards.campaign.create") == 1
    assert audits("rewards.campaign.status") == 2
    assert audits("rewards.campaign.update") == 1
    assert w.a.post(f"{BASE}/campaigns", {"name": "x"}, format="json").status_code == 422
    assert w.a.get(f"{BASE}/campaigns/not-an-id").status_code == 422


# --- ledger -------------------------------------------------------------------------------------


def test_lists_every_customers_transactions_with_filters(w: RewardsWorld) -> None:
    wallet.credit(w.me, coins=100, source="PROMOTIONAL_REWARD", key="a")
    wallet.reserve(w.me, coins=40, key="r")
    everything = w.a.get(f"{BASE}/transactions").json()["data"]
    assert len(everything["items"]) == 2
    assert everything["items"][0]["customer"]["email"] == "customer@bitebox.test"
    credits = w.a.get(f"{BASE}/transactions?type=CREDIT&search=customer@bitebox").json()["data"]
    assert len(credits["items"]) == 1
    one = w.a.get(f"{BASE}/transactions/{credits['items'][0]['id']}").json()["data"]
    assert one["transaction"]["coins"] == 100


def test_reverses_a_reward_partially_once_per_request_with_an_audit_trail(
    w: RewardsWorld,
) -> None:
    txn = wallet.credit(w.me, coins=100, source="ORDER_REWARD", key="order-reward:x").txn
    url = f"{BASE}/transactions/{txn.pk}/reverse"

    def reverse(key: str, payload: dict[str, Any]) -> Any:
        return w.a.post(url, payload, format="json", HTTP_IDEMPOTENCY_KEY=key)

    no_key = w.a.post(url, {"reason": "Refund"}, format="json")
    assert no_key.status_code == 422, "needs an idempotency key"

    first = reverse("reverse-key-0001", {"coins": 30, "reason": "Partial refund of order"})
    assert first.status_code == 200, first.json()
    repeat = reverse("reverse-key-0001", {"coins": 30, "reason": "Partial refund of order"})
    assert repeat.status_code == 200
    assert w.coins_of(w.me) == 70, "the repeat did nothing"
    too_much = reverse("reverse-key-0002", {"coins": 80, "reason": "Too much"})
    assert too_much.status_code == 409
    rest = reverse("reverse-key-0003", {"reason": "Fraud"})
    assert rest.json()["data"]["transaction"]["coins"] == 70
    assert w.coins_of(w.me) == 0
    assert audits("rewards.reverse") == 3

    reversal = CoinTransaction.objects.filter(type="REVERSAL").order_by("seq").first()
    assert reversal is not None
    assert reversal.note == "Partial refund of order"
    assert str(reversal.created_by_id) == w.admin["user"]["id"]
    # Debits cannot be "reversed" from here.
    wallet.credit(w.me, coins=200, source="PROMOTIONAL_REWARD", key="g")
    hold = wallet.reserve(w.me, coins=100, key="h").txn
    not_a_reward = w.a.post(
        f"{BASE}/transactions/{hold.pk}/reverse",
        {"reason": "Not a reward"},
        format="json",
        HTTP_IDEMPOTENCY_KEY="reverse-key-0005",
    )
    assert not_a_reward.status_code == 409

    detail = w.a.get(f"{BASE}/wallets/{w.me}").json()["data"]
    assert detail["integrity"]["ok"] is True
    assert detail["wallet"]["reserved"] == 100


# --- reports and referrals ----------------------------------------------------------------------


def test_reports_issued_redeemed_liability_and_suspicious_activity(w: RewardsWorld) -> None:
    wallet.credit(w.me, coins=300, source="REFERRAL_REWARD", key="ref")
    wallet.credit(w.me, coins=200, source="FESTIVAL_REWARD", key="fest")
    wallet.reserve(w.me, coins=100, key="res")
    wallet.commit_reservation(w.me, reserve_key="res")
    wallet.reverse_credit(w.me, credit_key="fest", coins=50, key="rev")
    res = w.a.get(f"{BASE}/reports?days=7")
    assert res.status_code == 200, res.json()
    r = res.json()["data"]
    assert r["allTime"]["issued"] == 500
    assert r["allTime"]["netRedeemed"] == 100
    assert r["allTime"]["reversed"] == 50
    assert r["allTime"]["referralRewards"] == 300
    assert r["allTime"]["promotionalRewards"] == 200
    assert r["liability"]["coins"] == 350
    assert r["liability"]["paise"] == 3500
    assert r["wallets"]["active"] == 1
    assert len(r["daily"]) == 7
    assert r["daily"][-1]["issued"] == 500
    assert r["suspicious"]["topEarners"][0]["coins"] == 500
    assert w.a.get(f"{BASE}/reports?days=0").status_code == 422


def test_lets_the_super_admin_review_and_approve_held_referrals(w: RewardsWorld) -> None:
    code = w.c.get("/api/v1/referrals/me").json()["data"]["code"]
    friend = w.sign_up(code, name="Kabir Shah")
    order = w.place_as(friend, where=(12.9729, 77.6412))
    w.deliver(order["id"])  # same IP as the referrer: held

    held = w.a.get(f"{BASE}/referrals?rewardStatus=HELD").json()["data"]
    assert len(held["items"]) == 1
    assert "SAME_SIGNUP_IP" in held["items"][0]["riskFlags"]
    assert held["items"][0]["referrer"]["email"] == "customer@bitebox.test"
    assert "signupIp" not in json.dumps(held)
    referral_id = held["items"][0]["id"]
    rejected = w.a.post(f"{BASE}/referrals/{referral_id}/reject", {}, format="json")
    assert rejected.status_code == 422, "rejecting needs a note"
    approved = w.a.post(
        f"{BASE}/referrals/{referral_id}/approve", {"note": "Flatmates, verified"}, format="json"
    )
    assert approved.status_code == 200, approved.json()
    assert Referral.objects.get(pk=referral_id).status == "REWARD_CREDITED"
    assert audits("rewards.referral.approve") == 1
    entry = AuditLog.objects.get(action="rewards.referral.approve")
    assert entry.description == "Approved a held referral: Flatmates, verified"
