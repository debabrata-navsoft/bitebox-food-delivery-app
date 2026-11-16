"""
Port of the Node API's tests/referrals.test.js: codes, sign-up with a code, the rewards after the
friend's first delivered order, limits, expiry and the held-for-review flow.
"""

import json
import re
from datetime import timedelta
from typing import Any

import pytest
from django.utils import timezone

from apps.accounts.models import User
from apps.coins import config as reward_config
from apps.coins import referrals
from apps.coins.models import CoinTransaction, Referral
from apps.coins.tasks import rewards_sweep
from apps.orders.models import Order
from apps.orders.tests.test_orders import client_for

from .helpers import REFERRER_HOME, RewardsWorld

pytestmark = pytest.mark.django_db


@pytest.fixture
def w() -> RewardsWorld:
    world = RewardsWorld()
    world.code = world.c.get("/api/v1/referrals/me").json()["data"]["code"]  # type: ignore[attr-defined]
    return world


def code_of(w: RewardsWorld) -> str:
    return str(w.code)  # type: ignore[attr-defined]


def forget_ips() -> None:
    """Tests run from one machine, so every account shares an IP; clear it unless checked."""
    Referral.objects.update(signup_ip=None)


def friend_orders(
    w: RewardsWorld,
    friend: dict[str, Any],
    where: tuple[float, float] | None = None,
    qty: int = 2,
    deliver: bool = True,
) -> dict[str, Any]:
    order = w.place_as(friend, qty=qty, **({"where": where} if where else {}))
    if deliver:
        w.deliver(order["id"])
    return order


def referral_of(friend: dict[str, Any]) -> Referral:
    return Referral.objects.get(referred_id=friend["id"])


# --- codes --------------------------------------------------------------------------------------


def test_gives_every_customer_one_unique_code_and_none_to_partners(w: RewardsWorld) -> None:
    code = code_of(w)
    assert re.fullmatch(r"BITEBOX-[A-Z]{1,5}[A-Z2-9]{4}", code)
    again = w.c.get("/api/v1/referrals/me").json()["data"]
    assert again["code"] == code
    assert re.search(rf"/register\?ref={code}$", again["link"])

    friend = w.sign_up()
    friend_code = User.objects.get(pk=friend["id"]).referral_code
    assert friend_code
    assert friend_code != code

    partner = w.sign_up(role="restaurant")
    assert User.objects.get(pk=partner["id"]).referral_code is None
    assert partner["c"].get("/api/v1/referrals/me").status_code == 403


def test_generates_readable_codes() -> None:
    assert re.fullmatch(r"BITEBOX-ELODI[A-Z2-9]{4}", referrals.generate_code("Élodie Fernandes"))
    assert re.fullmatch(r"BITEBOX-FRIEND[A-Z2-9]{4}", referrals.generate_code("  "))
    codes = {referrals.generate_code("Asha") for _ in range(200)}
    assert len(codes) > 190


def test_validates_a_code_publicly_without_revealing_whose_it_is(w: RewardsWorld) -> None:
    from rest_framework.test import APIClient

    api = APIClient()
    ok = api.post("/api/v1/referrals/validate", {"code": code_of(w).lower()}, format="json")
    assert ok.status_code == 200
    assert ok.json()["data"] == {"valid": True}
    bad = api.post("/api/v1/referrals/validate", {"code": "BITEBOX-NOPE1234"}, format="json")
    assert bad.json()["data"]["valid"] is False
    assert w.customer["user"]["name"] not in json.dumps(ok.json())
    assert api.post("/api/v1/referrals/validate", {}, format="json").status_code == 422


# --- sign-up ------------------------------------------------------------------------------------


def test_records_the_relationship_when_a_friend_signs_up_with_a_code(w: RewardsWorld) -> None:
    friend = w.sign_up(code_of(w))
    assert friend["res"].status_code == 201, friend["res"].json()
    referral = referral_of(friend)
    assert referral.status == "REGISTERED"
    assert str(referral.referrer_id) == w.me
    assert referral.attribution_expires_at > timezone.now() + timedelta(days=29)


def test_rejects_an_unknown_or_unusable_code_without_creating_the_account(
    w: RewardsWorld,
) -> None:
    res = w.sign_up("BITEBOX-NOPE1234", email="nobody@example.com")["res"]
    assert res.status_code == 422
    assert res.json()["error"]["details"][0]["field"] == "referralCode"
    assert not User.objects.filter(email="nobody@example.com").exists()

    # A partner's account cannot refer customers even if it somehow had a code.
    User.objects.filter(email="restaurant@bitebox.test").update(referral_code="BITEBOX-SHOP2345")
    assert w.sign_up("BITEBOX-SHOP2345")["res"].status_code == 422


def test_refuses_self_referral_and_a_second_referrer(w: RewardsWorld) -> None:
    me = User.objects.get(pk=w.me)
    with pytest.raises(Exception, match="own code"):
        referrals.record_signup(me, {"referrer": me, "code": code_of(w)})

    friend = w.sign_up(code_of(w))
    other = w.sign_up()
    other_user = User.objects.get(pk=other["id"])
    second = referrals.record_signup(
        User.objects.get(pk=friend["id"]),
        {"referrer": other_user, "code": other_user.referral_code},
    )
    assert str(second.referrer_id) == w.me, "still the first referrer"
    assert Referral.objects.filter(referred_id=friend["id"]).count() == 1


def test_enforces_the_maximum_number_of_referrals_per_customer(w: RewardsWorld) -> None:
    reward_config.update(None, {"referral": {"max_referrals_per_customer": 1}})
    assert w.sign_up(code_of(w))["res"].status_code == 201
    res = w.sign_up(code_of(w))["res"]
    assert res.status_code == 422
    assert "no longer be used" in res.json()["message"]


def test_accepts_no_codes_while_referrals_are_switched_off(w: RewardsWorld) -> None:
    reward_config.update(None, {"referral": {"enabled": False}})
    assert w.sign_up(code_of(w))["res"].status_code == 422
    assert w.sign_up()["res"].status_code == 201, "sign-up without a code still works"


# --- rewards ------------------------------------------------------------------------------------


def test_rewards_both_sides_only_after_the_first_delivered_order_once(w: RewardsWorld) -> None:
    friend = w.sign_up(code_of(w))
    forget_ips()
    order = friend_orders(w, friend, deliver=False)
    referral = referral_of(friend)
    assert referral.status == "FIRST_ORDER_PLACED"
    assert str(referral.qualifying_order_id) == order["id"]
    assert w.coins_of(w.me) == 0, "nothing before delivery"

    w.deliver(order["id"])
    referral = referral_of(friend)
    assert referral.status == "REWARD_CREDITED"
    assert referral.reward_status == "CREDITED"
    assert (referral.referrer_coins, referral.referred_coins) == (50, 25)
    assert w.coins_of(w.me) == 50
    # Referral bonus + order reward + welcome bonus (paid at sign-up).
    assert w.coins_of(friend["id"]) == 25 + 60 + 25

    # A second delivered order pays no further referral rewards.
    friend_orders(w, friend)
    assert CoinTransaction.objects.filter(source="REFERRAL_REWARD").count() == 2

    mine = w.c.get("/api/v1/referrals/me").json()["data"]
    assert mine["stats"]["successful"] == 1
    assert mine["stats"]["coinsEarned"] == 50
    history = w.c.get("/api/v1/referrals/me/history").json()["data"]
    assert history["items"][0]["friend"] == "Asha R."
    assert "@example.com" not in json.dumps(history), "no emails"
    theirs = friend["c"].get("/api/v1/referrals/me").json()["data"]
    assert theirs["referredBy"]["coins"] == 25


def test_waits_again_if_the_first_order_is_cancelled_and_ignores_small_orders(
    w: RewardsWorld,
) -> None:
    friend = w.sign_up(code_of(w))
    forget_ips()
    first = friend_orders(w, friend, deliver=False)
    assert w.reject(first["id"]).status_code == 200
    assert referral_of(friend).status == "REGISTERED"

    reward_config.update(None, {"referral": {"min_order_paise": 100_000}})
    friend_orders(w, friend)  # ₹698 < ₹1000
    assert referral_of(friend).status == "REGISTERED"
    assert not CoinTransaction.objects.filter(source="REFERRAL_REWARD").exists()


def test_expires_referrals_with_no_qualifying_order_in_time(w: RewardsWorld) -> None:
    friend = w.sign_up(code_of(w))
    rewards_sweep(timezone.now() + timedelta(days=31))
    assert referral_of(friend).status == "EXPIRED"
    friend_orders(w, friend)
    assert not CoinTransaction.objects.filter(source="REFERRAL_REWARD").exists()


def test_does_not_reward_an_order_placed_after_the_window_closed(w: RewardsWorld) -> None:
    friend = w.sign_up(code_of(w))
    forget_ips()
    Referral.objects.filter(referred_id=friend["id"]).update(
        attribution_expires_at=timezone.now() - timedelta(seconds=1)
    )
    friend_orders(w, friend)
    assert referral_of(friend).status == "EXPIRED"
    assert w.coins_of(w.me) == 0


def test_pays_the_friend_but_not_the_referrer_beyond_the_monthly_limit(w: RewardsWorld) -> None:
    reward_config.update(None, {"referral": {"max_rewards_per_month": 1}})
    a = w.sign_up(code_of(w))
    b = w.sign_up(code_of(w))
    forget_ips()
    friend_orders(w, a)
    friend_orders(w, b, where=(12.98, 77.65))
    second = referral_of(b)
    assert second.reward_status == "PARTIAL"
    assert second.referrer_coins == 0
    assert second.referred_coins == 25
    assert w.coins_of(w.me) == 50


def test_holds_suspicious_referrals_for_an_admin_who_can_approve(w: RewardsWorld) -> None:
    friend = w.sign_up(code_of(w))  # same IP as the referrer's sessions
    friend_orders(w, friend, where=REFERRER_HOME)
    referral = referral_of(friend)
    assert referral.status == "ORDER_DELIVERED"
    assert referral.reward_status == "HELD"
    assert "SAME_SIGNUP_IP" in referral.risk_flags
    assert "ADDRESS_MATCHES_REFERRER" in referral.risk_flags
    assert w.coins_of(w.me) == 0

    # Customers never see the risk signals.
    seen = json.dumps(w.c.get("/api/v1/referrals/me/history").json())
    assert "SAME_SIGNUP_IP" not in seen
    assert "riskFlags" not in seen

    # Admins see them, and the referral's history.
    listed = w.a.get("/api/v1/admin/rewards/referrals?flagged=true").json()["data"]
    assert listed["items"][0]["riskFlags"]
    assert listed["counts"]["HELD"] == 1
    assert "signupIp" not in json.dumps(listed)

    res = w.a.post(
        f"/api/v1/admin/rewards/referrals/{referral.pk}/approve",
        {"note": "Checked: siblings in one flat"},
        format="json",
    )
    assert res.status_code == 200, res.json()
    assert res.json()["data"]["referral"]["status"] == "REWARD_CREDITED"
    assert res.json()["data"]["referral"]["decision"]["note"] == "Checked: siblings in one flat"
    assert w.coins_of(w.me) == 50
    again = w.a.post(f"/api/v1/admin/rewards/referrals/{referral.pk}/approve", {}, format="json")
    assert again.status_code == 409
    assert "held for review" in again.json()["message"]


def test_rejecting_a_held_referral_pays_nothing(w: RewardsWorld) -> None:
    friend = w.sign_up(code_of(w))
    friend_orders(w, friend, where=REFERRER_HOME)
    referral = referral_of(friend)
    url = f"/api/v1/admin/rewards/referrals/{referral.pk}/reject"
    assert w.a.post(url, {}, format="json").status_code == 422, "a reason is required"
    res = w.a.post(url, {"note": "Same household"}, format="json")
    assert res.status_code == 200, res.json()
    assert Referral.objects.get(pk=referral.pk).status == "REJECTED"
    assert not CoinTransaction.objects.filter(source="REFERRAL_REWARD").exists()
    history = w.c.get("/api/v1/referrals/me/history").json()["data"]
    assert history["items"][0]["status"] == "NOT_ELIGIBLE"


def test_never_pays_twice_when_the_qualification_runs_twice(w: RewardsWorld) -> None:
    friend = w.sign_up(code_of(w))
    forget_ips()
    order = friend_orders(w, friend)
    referrals.on_order_delivered(Order.objects.get(pk=order["id"]))
    referrals.credit_referral(referral_of(friend).pk)
    assert CoinTransaction.objects.filter(source="REFERRAL_REWARD").count() == 2


def test_only_the_super_admin_manages_referrals(w: RewardsWorld) -> None:
    from apps.accounts.tests.test_auth import create_and_login

    finance = client_for(create_and_login("finance_admin")["token"])
    referral = referral_of(w.sign_up(code_of(w)))
    assert finance.get("/api/v1/admin/rewards/referrals").status_code == 403
    res = finance.post(
        f"/api/v1/admin/rewards/referrals/{referral.pk}/reject", {"note": "Spam"}, format="json"
    )
    assert res.status_code == 403
    assert w.c.get("/api/v1/admin/rewards/referrals").status_code == 403
    assert w.a.get(f"/api/v1/admin/rewards/referrals/{referral.pk}").status_code == 200
