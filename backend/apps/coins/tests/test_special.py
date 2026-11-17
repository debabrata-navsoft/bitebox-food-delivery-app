"""
Port of the Node API's tests/special-rewards.test.js: the welcome and birthday bonuses and
festival/promotional campaigns (claimed or earned with an order), their limits and schedules.
"""

from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from django.utils import timezone

from apps.accounts.models import User
from apps.coins import config as reward_config
from apps.coins import special
from apps.coins.models import CoinTransaction, RewardCampaign, RewardClaim
from apps.orders.models import Order
from apps.restaurants.models import Restaurant

from .helpers import RewardsWorld

pytestmark = pytest.mark.django_db
DAY = timedelta(days=1)
HOUR = timedelta(hours=1)


@pytest.fixture
def w() -> RewardsWorld:
    return RewardsWorld()


def sign_up(w: RewardsWorld) -> dict[str, Any]:
    friend = w.sign_up(name="Meera Iyer")
    assert friend["res"].status_code == 201, friend["res"].json()
    return friend


def campaign(w: RewardsWorld, activate: bool = True, **overrides: Any) -> dict[str, Any]:
    now = timezone.now()
    body = {
        "name": "Diwali Dhamaka",
        "description": "Festival coins for everyone",
        "type": "FESTIVAL",
        "trigger": "CLAIM",
        "rewardCoins": 40,
        "startAt": (now - HOUR).isoformat(),
        "endAt": (now + 3 * DAY).isoformat(),
        **overrides,
    }
    res = w.a.post("/api/v1/admin/rewards/campaigns", body, format="json")
    assert res.status_code == 201, res.json()
    created = res.json()["data"]["campaign"]
    if not activate:
        return dict(created)
    res = w.a.patch(
        f"/api/v1/admin/rewards/campaigns/{created['id']}/status",
        {"action": "activate"},
        format="json",
    )
    assert res.status_code == 200, res.json()
    return dict(res.json()["data"]["campaign"])


def claim_as(who: dict[str, Any], campaign_id: str) -> Any:
    return who["c"].post(f"/api/v1/rewards/campaigns/{campaign_id}/claim")


def order_and_deliver(w: RewardsWorld, who: dict[str, Any], qty: int = 2) -> str:
    order = w.place_as(who, qty=qty)
    w.deliver(order["id"])
    return str(order["id"])


# --- welcome ------------------------------------------------------------------------------------


def test_pays_new_customers_once_on_sign_up(w: RewardsWorld) -> None:
    a = sign_up(w)
    assert w.coins_of(a["id"]) == 25
    special.maybe_welcome(a["id"], "registration")
    assert w.coins_of(a["id"]) == 25
    assert RewardClaim.objects.filter(user_id=a["id"], reward_type="WELCOME").count() == 1
    overview = a["c"].get("/api/v1/rewards").json()["data"]
    assert overview["welcome"]["claimed"] is True
    assert overview["totals"] == {"claims": 1, "coins": 25}


def test_can_pay_on_the_first_delivered_order_instead(w: RewardsWorld) -> None:
    reward_config.update(None, {"welcome": {"trigger": "first_order"}})
    a = sign_up(w)
    assert w.coins_of(a["id"]) == 0
    order_and_deliver(w, a)
    assert CoinTransaction.objects.filter(user_id=a["id"], source="WELCOME_REWARD").count() == 1


# --- birthday -----------------------------------------------------------------------------------


def test_saves_the_birthday_once_and_validates_it(w: RewardsWorld) -> None:
    a = sign_up(w)

    def put(value: str) -> Any:
        return a["c"].put("/api/v1/rewards/birthday", {"birthDate": value}, format="json")

    assert put("1995-02-30").status_code == 422
    assert put("2020-01-01").status_code == 422
    assert put("05/11/1995").status_code == 422
    ok = put("1995-11-05")
    assert ok.status_code == 200, ok.json()
    assert ok.json()["data"] == {"birthDate": "1995-11-05"}
    assert put("1996-01-01").status_code == 409
    birth_date = User.objects.get(pk=a["id"]).birth_date
    assert birth_date is not None
    assert birth_date.isoformat() == "1995-11-05"


def test_pays_once_per_birthday_year_on_the_local_calendar_day(w: RewardsWorld) -> None:
    a = sign_up(w)
    a["c"].put("/api/v1/rewards/birthday", {"birthDate": "1995-11-05"}, format="json")
    # 20:00 UTC on 4 Nov is already 5 Nov in India.
    first = special.birthday_sweep(now=datetime(2026, 11, 4, 20, tzinfo=UTC))
    assert first["issued"] == 1
    special.birthday_sweep(now=datetime(2026, 11, 5, 10, tzinfo=UTC))
    assert w.coins_of(a["id"]) == 25 + 100
    # Not on other days; again next year.
    assert special.birthday_sweep(now=datetime(2026, 11, 7, 10, tzinfo=UTC))["issued"] == 0
    assert special.birthday_sweep(now=datetime(2027, 11, 5, 10, tzinfo=UTC))["issued"] == 1
    assert RewardClaim.objects.filter(user_id=a["id"], reward_type="BIRTHDAY").count() == 2


def test_celebrates_29_february_on_28_february_in_other_years(w: RewardsWorld) -> None:
    a = sign_up(w)
    a["c"].put("/api/v1/rewards/birthday", {"birthDate": "2000-02-29"}, format="json")
    assert special.birthday_sweep(now=datetime(2027, 2, 28, 10, tzinfo=UTC))["issued"] == 1
    assert special.birthday_sweep(now=datetime(2028, 2, 28, 10, tzinfo=UTC))["issued"] == 0
    assert special.birthday_sweep(now=datetime(2028, 2, 29, 10, tzinfo=UTC))["issued"] == 1


def test_birthday_bonus_arrives_at_local_midnight(w: RewardsWorld) -> None:
    from config.celery import app

    a = sign_up(w)
    a["c"].put("/api/v1/rewards/birthday", {"birthDate": "1995-11-05"}, format="json")
    # 12:00 AM on 5 Nov in India is 18:30 UTC on 4 Nov: Beat runs the birthday task then.
    midnight = datetime(2026, 11, 4, 18, 30, tzinfo=UTC)
    schedule = app.conf.beat_schedule["coins-birthdays"]
    assert schedule["task"] == "coins.birthday_sweep"
    assert midnight.minute in schedule["schedule"].minute
    assert special.birthday_sweep(now=midnight - timedelta(seconds=1))["issued"] == 0
    assert special.birthday_sweep(now=midnight)["issued"] == 1


def test_pays_nothing_while_birthday_rewards_are_off(w: RewardsWorld) -> None:
    a = sign_up(w)
    a["c"].put("/api/v1/rewards/birthday", {"birthDate": "1995-11-05"}, format="json")
    reward_config.update(None, {"birthday": {"enabled": False}})
    assert special.birthday_sweep(now=datetime(2026, 11, 5, 10, tzinfo=UTC))["issued"] == 0


# --- campaigns ----------------------------------------------------------------------------------


def test_lets_an_eligible_customer_claim_once_and_lists_the_state(w: RewardsWorld) -> None:
    c = campaign(w)
    assert c["status"] == "ACTIVE"
    a = sign_up(w)
    items = a["c"].get("/api/v1/rewards/campaigns").json()["data"]["items"]
    assert items[0]["canClaim"] is True
    res = claim_as(a, c["id"])
    assert res.status_code == 201, res.json()
    assert res.json()["message"] == "Reward claimed"
    assert res.json()["data"]["claim"]["coins"] == 40
    assert w.coins_of(a["id"]) == 25 + 40
    assert claim_as(a, c["id"]).status_code == 409
    after = a["c"].get("/api/v1/rewards/campaigns").json()["data"]["items"][0]
    assert [after["canClaim"], after["reason"]] == [False, "Already claimed"]
    history = a["c"].get("/api/v1/rewards/history?rewardType=FESTIVAL").json()["data"]
    assert history["items"][0]["campaign"]["name"] == "Diwali Dhamaka"


def test_coins_expire_on_the_campaigns_date_else_after_the_settings_period(
    w: RewardsWorld,
) -> None:
    expires = (timezone.now() + 10 * DAY).replace(microsecond=0)
    c = campaign(w, coinsExpireAt=expires.isoformat())
    a = sign_up(w)
    listed = a["c"].get("/api/v1/rewards/campaigns").json()["data"]["items"][0]
    assert datetime.fromisoformat(listed["coinsExpireAt"].replace("Z", "+00:00")) == expires
    assert claim_as(a, c["id"]).status_code == 201
    credit = CoinTransaction.objects.get(user_id=a["id"], source="FESTIVAL_REWARD")
    assert credit.expires_at == expires

    plain = campaign(w, name="Holi Hungama")
    assert claim_as(a, plain["id"]).status_code == 201
    later = CoinTransaction.objects.get(user_id=a["id"], campaign_id=plain["id"])
    assert later.expires_at is not None
    assert later.expires_at > timezone.now() + 170 * DAY, "180 days by default"

    # The coins must outlast the campaign.
    res = w.a.post(
        "/api/v1/admin/rewards/campaigns",
        {
            "name": "Short lived",
            "type": "FESTIVAL",
            "rewardCoins": 10,
            "startAt": timezone.now().isoformat(),
            "endAt": (timezone.now() + 3 * DAY).isoformat(),
            "coinsExpireAt": (timezone.now() + DAY).isoformat(),
        },
        format="json",
    )
    assert res.status_code == 422
    assert any(d["field"] == "coinsExpireAt" for d in res.json()["error"]["details"])


def test_never_pays_a_customer_twice_for_one_claim_campaign(w: RewardsWorld) -> None:
    c = campaign(w)
    a = sign_up(w)
    results = [claim_as(a, c["id"]).status_code for _ in range(4)]
    assert results.count(201) == 1
    assert RewardClaim.objects.filter(campaign_id=c["id"]).count() == 1
    assert RewardCampaign.objects.get(pk=c["id"]).claims_count == 1
    assert w.coins_of(a["id"]) == 25 + 40


def test_enforces_the_total_claim_limit_and_completes_the_campaign(w: RewardsWorld) -> None:
    c = campaign(w, limits={"maxTotalClaims": 2})
    people = [sign_up(w) for _ in range(3)]
    results = [claim_as(p, c["id"]).status_code for p in people]
    assert results.count(201) == 2
    saved = RewardCampaign.objects.get(pk=c["id"])
    assert saved.claims_count == 2
    assert saved.status == "COMPLETED"


def test_respects_the_coin_budget_and_repeat_claims_per_customer(w: RewardsWorld) -> None:
    c = campaign(w, rewardCoins=30, limits={"maxClaimsPerCustomer": 3, "maxTotalCoins": 70})
    a = sign_up(w)
    assert claim_as(a, c["id"]).status_code == 201
    assert claim_as(a, c["id"]).status_code == 201
    assert claim_as(a, c["id"]).status_code == 409, "a third 30 would exceed 70 coins"
    assert RewardCampaign.objects.get(pk=c["id"]).coins_issued == 60


def test_refuses_customers_outside_the_target_group(w: RewardsWorld) -> None:
    for_new = campaign(w, conditions={"customerGroup": "NEW"})
    for_existing = campaign(w, name="Loyalty thanks", conditions={"customerGroup": "EXISTING"})
    a = sign_up(w)
    assert claim_as(a, for_existing["id"]).status_code == 409
    order_and_deliver(w, a)
    res = claim_as(a, for_new["id"])
    assert res.status_code == 409
    assert "not ordered yet" in res.json()["message"]
    assert claim_as(a, for_existing["id"]).status_code == 201


def test_follows_the_campaign_dates(w: RewardsWorld) -> None:
    now = timezone.now()
    c = campaign(w, startAt=(now + DAY).isoformat(), endAt=(now + 3 * DAY).isoformat())
    assert c["status"] == "SCHEDULED"
    a = sign_up(w)
    early = claim_as(a, c["id"])
    assert early.status_code == 409
    assert "Not started" in early.json()["message"]

    assert special.campaign_sweep(now=now + DAY + HOUR)["started"] == 1
    assert RewardCampaign.objects.get(pk=c["id"]).status == "ACTIVE"
    RewardCampaign.objects.filter(pk=c["id"]).update(start_at=now - HOUR)
    assert claim_as(a, c["id"]).status_code == 201

    assert special.campaign_sweep(now=now + 4 * DAY)["ended"] == 1
    assert RewardCampaign.objects.get(pk=c["id"]).status == "EXPIRED"
    b = sign_up(w)
    assert claim_as(b, c["id"]).status_code == 409


def test_pays_order_campaigns_once_per_qualifying_delivered_order(w: RewardsWorld) -> None:
    restaurant = Restaurant.objects.get(slug="spice-route-kitchen")
    c = campaign(
        w,
        name="Weekend feast",
        type="PROMOTIONAL",
        trigger="ORDER",
        rewardCoins=75,
        conditions={"minOrderPaise": 50_000, "restaurants": [str(restaurant.pk)]},
        limits={"maxClaimsPerCustomer": 5},
    )
    a = sign_up(w)
    # Claim campaigns are claimed; order campaigns are earned.
    assert claim_as(a, c["id"]).status_code == 409

    order_and_deliver(w, a, qty=1)  # ₹349: below ₹500
    assert not RewardClaim.objects.filter(campaign_id=c["id"]).exists()

    order_id = order_and_deliver(w, a, qty=2)  # ₹698
    assert RewardClaim.objects.filter(campaign_id=c["id"]).count() == 1
    special.on_order_delivered(Order.objects.get(pk=order_id))
    assert RewardClaim.objects.filter(campaign_id=c["id"]).count() == 1, "no second reward"


def test_pays_first_order_campaigns_only_for_the_first_delivered_order(w: RewardsWorld) -> None:
    c = campaign(
        w,
        trigger="ORDER",
        conditions={"firstOrderOnly": True},
        limits={"maxClaimsPerCustomer": 5},
    )
    a = sign_up(w)
    for _ in range(2):
        order_and_deliver(w, a)
    assert RewardClaim.objects.filter(campaign_id=c["id"]).count() == 1


def test_does_not_pay_from_paused_or_draft_campaigns(w: RewardsWorld) -> None:
    draft = campaign(w, activate=False)
    paused = campaign(w, name="Holi colours")
    res = w.a.patch(
        f"/api/v1/admin/rewards/campaigns/{paused['id']}/status",
        {"action": "pause"},
        format="json",
    )
    assert res.status_code == 200
    a = sign_up(w)
    assert claim_as(a, draft["id"]).status_code == 404
    assert claim_as(a, paused["id"]).status_code == 409


def test_the_reward_cannot_change_while_active(w: RewardsWorld) -> None:
    c = campaign(w)
    url = f"/api/v1/admin/rewards/campaigns/{c['id']}"
    res = w.a.put(url, {"rewardCoins": 500}, format="json")
    assert res.status_code == 409
    assert "Pause the campaign" in res.json()["message"]
    res = w.a.put(
        url, {"name": "Diwali Dhamaka 2026", "limits": {"maxTotalClaims": 100}}, format="json"
    )
    assert res.status_code == 200, res.json()
    assert res.json()["data"]["campaign"]["name"] == "Diwali Dhamaka 2026"
    bad = w.a.post(
        "/api/v1/admin/rewards/campaigns",
        {
            "name": "Bad dates",
            "type": "FESTIVAL",
            "rewardCoins": 10,
            "startAt": timezone.now().isoformat(),
            "endAt": (timezone.now() - DAY).isoformat(),
        },
        format="json",
    )
    assert bad.status_code == 422
    assert bad.json()["message"] == "Validation failed"


def test_finishes_claims_a_crash_left_pending(w: RewardsWorld) -> None:
    a = sign_up(w)
    RewardClaim.objects.create(
        user_id=a["id"],
        reward_type="PROMOTIONAL",
        coins=15,
        claim_key="manual:test",
        status="PENDING",
    )
    RewardClaim.objects.filter(claim_key="manual:test").update(updated_at=timezone.now() - DAY)
    summary = special.campaign_sweep(now=timezone.now())
    assert summary["recovered"] == 1
    assert w.coins_of(a["id"]) == 25 + 15
