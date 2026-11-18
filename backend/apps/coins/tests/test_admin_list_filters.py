"""Global filters on the admin Coins & rewards lists: multi-value filters (OR within one, AND
across) and `?facets=1` counts on campaigns, the reward history (claims), coin transactions and
referrals. Same cases as node-js/backend/tests/admin-filters-rewards.test.js. Fictional data only.
"""

import itertools
from datetime import timedelta
from typing import Any

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.coins import wallet
from apps.coins.models import Referral, RewardCampaign, RewardClaim
from apps.rbac.roles import Role
from tests import factories as make
from tests.list_filters import at, client_for, counts, data, field_errors

pytestmark = pytest.mark.django_db

CAMPAIGNS = "/api/v1/admin/rewards/campaigns"
CLAIMS = "/api/v1/admin/rewards/claims"
TRANSACTIONS = "/api/v1/admin/rewards/transactions"
REFERRALS = "/api/v1/admin/rewards/referrals"
_n = itertools.count(1)


@pytest.fixture
def admin() -> APIClient:
    return client_for(make.user(Role.ADMIN))


def ids(res: Any) -> set[str]:
    return {item["id"] for item in data(res)["items"]}


def customer(name: str) -> User:
    return make.user(name=name, email=f"rewards{next(_n)}@example.test")


def campaign(name: str, start: str, end: str, **fields: Any) -> RewardCampaign:
    return RewardCampaign.objects.create(
        name=name,
        type=fields.pop("type", "FESTIVAL"),
        reward_coins=50,
        start_at=at(start, 10),
        end_at=at(end, 18),
        **fields,
    )


class TestCampaigns:
    def test_filters_combine_and_facets_skip_their_own_selection(self, admin: APIClient) -> None:
        lamp = campaign("Lantern Night", "2026-10-01", "2026-10-05", status="ACTIVE")
        harvest = campaign(
            "Harvest Moon", "2026-10-10", "2026-10-12", status="PAUSED", trigger="ORDER"
        )
        promo = campaign(
            "Spring Hello",
            "2026-11-01",
            "2026-11-30",
            type="PROMOTIONAL",
            status="ACTIVE",
            customer_group="NEW",
        )
        campaign("Old Draft", "2026-09-01", "2026-09-02")

        assert ids(admin.get(CAMPAIGNS, {"status": "ACTIVE,PAUSED"})) == {
            str(lamp.pk),
            str(harvest.pk),
            str(promo.pk),
        }
        assert ids(admin.get(CAMPAIGNS, {"status": "ACTIVE", "type": "FESTIVAL"})) == {str(lamp.pk)}
        assert ids(admin.get(CAMPAIGNS, {"trigger": "ORDER"})) == {str(harvest.pk)}
        assert ids(admin.get(CAMPAIGNS, {"customerGroup": "NEW"})) == {str(promo.pk)}
        assert ids(admin.get(CAMPAIGNS, {"search": "moon"})) == {str(harvest.pk)}
        # Running on any day of the range: Lantern (ends 5 Oct) and Harvest (starts 10 Oct).
        assert ids(admin.get(CAMPAIGNS, {"runsFrom": "2026-10-05", "runsTo": "2026-10-10"})) == {
            str(lamp.pk),
            str(harvest.pk),
        }
        assert (
            ids(admin.get(CAMPAIGNS, {"runsFrom": "2026-10-06", "runsTo": "2026-10-09"})) == set()
        )

        res = admin.get(CAMPAIGNS, {"status": "ACTIVE", "type": "FESTIVAL", "facets": "1"})
        assert data(res)["pagination"]["total"] == 1
        # status counted over type=FESTIVAL only; type over status=ACTIVE only.
        assert counts(res, "status") == {
            "DRAFT": 1,
            "SCHEDULED": 0,
            "ACTIVE": 1,
            "PAUSED": 1,
            "EXPIRED": 0,
            "COMPLETED": 0,
        }
        assert counts(res, "type") == {"FESTIVAL": 1, "PROMOTIONAL": 1}
        assert counts(res, "trigger") == {"CLAIM": 1, "ORDER": 0}
        assert counts(res, "customerGroup") == {"ALL": 1, "NEW": 0, "EXISTING": 0, "INACTIVE": 0}
        assert "facets" not in data(admin.get(CAMPAIGNS))

    def test_rejects_invalid_values(self, admin: APIClient) -> None:
        errors = field_errors(admin.get(CAMPAIGNS, {"status": "ACTIVE,LIVE", "trigger": "x"}))
        assert errors == {"status": "Invalid value", "trigger": "Invalid value"}
        backwards = {"runsFrom": "2026-10-09", "runsTo": "2026-10-01"}
        assert field_errors(admin.get(CAMPAIGNS, backwards)) == {
            "runsTo": "Must be on or after runsFrom"
        }


class TestClaims:
    def test_filters_search_and_facets(self, admin: APIClient) -> None:
        lamp = campaign("Lantern Night", "2026-10-01", "2026-10-05", status="ACTIVE")
        harvest = campaign("Harvest Moon", "2026-10-10", "2026-10-12", status="ACTIVE")
        asha, ravi = customer("Asha Fictional"), customer("Ravi Imaginary")

        def claim(user: User, reward_type: str, day: str, **fields: Any) -> RewardClaim:
            row = RewardClaim.objects.create(
                user=user,
                reward_type=reward_type,
                coins=50,
                claim_key=f"test:{next(_n)}",
                **fields,
            )
            RewardClaim.objects.filter(pk=row.pk).update(created_at=at(day, 12))
            return row

        welcome = claim(asha, "WELCOME", "2026-10-01", status="ISSUED")
        lamp_claim = claim(asha, "FESTIVAL", "2026-10-03", campaign=lamp, status="ISSUED")
        harvest_claim = claim(ravi, "FESTIVAL", "2026-10-11", campaign=harvest)

        assert ids(admin.get(CLAIMS, {"rewardType": "WELCOME,FESTIVAL", "status": "ISSUED"})) == {
            str(welcome.pk),
            str(lamp_claim.pk),
        }
        assert ids(admin.get(CLAIMS, {"campaign": f"{lamp.pk},{harvest.pk}"})) == {
            str(lamp_claim.pk),
            str(harvest_claim.pk),
        }
        # The old single-value link still works.
        assert ids(admin.get(CLAIMS, {"campaign": str(harvest.pk)})) == {str(harvest_claim.pk)}
        assert ids(admin.get(CLAIMS, {"search": "ravi"})) == {str(harvest_claim.pk)}
        assert ids(admin.get(CLAIMS, {"search": "lantern"})) == {str(lamp_claim.pk)}
        assert ids(admin.get(CLAIMS, {"claimedFrom": "2026-10-02", "claimedTo": "2026-10-03"})) == {
            str(lamp_claim.pk)
        }

        res = admin.get(CLAIMS, {"rewardType": "FESTIVAL", "facets": "1"})
        assert counts(res, "rewardType") == {
            "WELCOME": 1,
            "BIRTHDAY": 0,
            "FESTIVAL": 2,
            "PROMOTIONAL": 0,
        }
        assert counts(res, "status") == {"PENDING": 1, "ISSUED": 1}
        # Most rows first, then by name.
        assert data(res)["facets"]["campaign"] == [
            {"value": str(harvest.pk), "label": "Harvest Moon", "count": 1},
            {"value": str(lamp.pk), "label": "Lantern Night", "count": 1},
        ]

    def test_rejects_invalid_values(self, admin: APIClient) -> None:
        errors = field_errors(admin.get(CLAIMS, {"rewardType": "GIFT", "campaign": "nope"}))
        assert errors == {"rewardType": "Invalid value", "campaign": "Invalid value"}


class TestTransactions:
    def test_filters_one_customer_and_facets(self, admin: APIClient) -> None:
        lamp = campaign("Lantern Night", "2026-10-01", "2026-10-05", status="ACTIVE")
        asha, ravi = customer("Asha Fictional"), customer("Ravi Imaginary")
        wallet.credit(asha.pk, coins=40, source="FESTIVAL_REWARD", key="t:1", campaign_id=lamp.pk)
        wallet.credit(asha.pk, coins=30, source="PROMOTIONAL_REWARD", key="t:2")
        wallet.credit(ravi.pk, coins=20, source="FESTIVAL_REWARD", key="t:3", campaign_id=lamp.pk)
        wallet.reverse_credit(asha.pk, credit_key="t:2", key="t:2:back", coins=10)

        both = admin.get(TRANSACTIONS, {"source": "FESTIVAL_REWARD,PROMOTIONAL_REWARD"})
        assert data(both)["pagination"]["total"] == 3
        credits = data(admin.get(TRANSACTIONS, {"type": "CREDIT", "userId": str(asha.pk)}))
        assert credits["pagination"]["total"] == 2
        assert data(admin.get(TRANSACTIONS, {"campaign": str(lamp.pk)}))["pagination"]["total"] == 2
        # A search and a customer link combine.
        assert (
            data(admin.get(TRANSACTIONS, {"search": "ravi", "userId": str(asha.pk)}))["pagination"][
                "total"
            ]
            == 0
        )
        later = (timezone.now() + timedelta(hours=1)).isoformat()
        assert data(admin.get(TRANSACTIONS, {"from": later}))["pagination"]["total"] == 0

        res = admin.get(TRANSACTIONS, {"type": "CREDIT", "userId": str(asha.pk), "facets": "1"})
        assert counts(res, "type") == {
            "CREDIT": 2,
            "DEBIT": 0,
            "RESERVE": 0,
            "RELEASE": 0,
            "EXPIRE": 0,
            "REVERSAL": 1,
        }
        assert counts(res, "source")["FESTIVAL_REWARD"] == 1
        assert counts(res, "source")["PROMOTIONAL_REWARD"] == 1
        assert data(res)["facets"]["campaign"] == [
            {"value": str(lamp.pk), "label": "Lantern Night", "count": 1}
        ]

    def test_rejects_invalid_values(self, admin: APIClient) -> None:
        errors = field_errors(admin.get(TRANSACTIONS, {"type": "CREDIT,GIFT", "source": "x"}))
        assert errors == {"type": "Invalid value", "source": "Invalid value"}


class TestReferrals:
    def test_filters_risk_signals_and_facets(self, admin: APIClient) -> None:
        asha = customer("Asha Fictional")

        def referral(name: str, day: str, **fields: Any) -> Referral:
            row = Referral.objects.create(
                referrer=asha,
                referred=customer(name),
                code="ASHA2026",
                attribution_expires_at=timezone.now() + timedelta(days=30),
                **fields,
            )
            Referral.objects.filter(pk=row.pk).update(created_at=at(day, 9))
            return row

        held = referral(
            "Ravi Imaginary",
            "2026-10-01",
            status="ORDER_DELIVERED",
            reward_status="HELD",
            risk_flags=["SAME_SIGNUP_IP", "REFERRER_VELOCITY"],
        )
        paid = referral(
            "Meera Madeup",
            "2026-10-05",
            status="REWARD_CREDITED",
            reward_status="CREDITED",
            risk_flags=["ADDRESS_MATCHES_REFERRER"],
        )
        fresh = referral("Kiran Pretend", "2026-10-09")

        assert ids(admin.get(REFERRALS, {"rewardStatus": "HELD,CREDITED"})) == {
            str(held.pk),
            str(paid.pk),
        }
        assert ids(admin.get(REFERRALS, {"risk": "SAME_SIGNUP_IP,ADDRESS_MATCHES_REFERRER"})) == {
            str(held.pk),
            str(paid.pk),
        }
        assert (
            ids(admin.get(REFERRALS, {"risk": "REFERRER_VELOCITY", "status": "REGISTERED"}))
            == set()
        )
        assert ids(admin.get(REFERRALS, {"flagged": "true", "status": "REWARD_CREDITED"})) == {
            str(paid.pk)
        }
        assert ids(admin.get(REFERRALS, {"createdFrom": "2026-10-05"})) == {
            str(paid.pk),
            str(fresh.pk),
        }
        assert ids(admin.get(REFERRALS, {"search": "kiran"})) == {str(fresh.pk)}

        res = admin.get(REFERRALS, {"rewardStatus": "HELD", "facets": "1"})
        body = data(res)
        assert body["counts"] == {"HELD": 1, "CREDITED": 1, "NONE": 1}
        assert counts(res, "rewardStatus") == {
            "NONE": 1,
            "HELD": 1,
            "CREDITING": 0,
            "CREDITED": 1,
            "PARTIAL": 0,
            "REJECTED": 0,
        }
        assert counts(res, "status") == {
            "REGISTERED": 0,
            "FIRST_ORDER_PLACED": 0,
            "ORDER_DELIVERED": 1,
            "REWARD_CREDITED": 0,
            "REJECTED": 0,
            "EXPIRED": 0,
        }
        assert counts(res, "risk") == {
            "SAME_SIGNUP_IP": 1,
            "ADDRESS_MATCHES_REFERRER": 0,
            "ADDRESS_SHARED_WITH_OTHER_REFERRAL": 0,
            "REFERRER_VELOCITY": 1,
        }

    def test_rejects_invalid_values(self, admin: APIClient) -> None:
        errors = field_errors(admin.get(REFERRALS, {"risk": "SHADY", "rewardStatus": "PAID"}))
        assert errors == {"risk": "Invalid value", "rewardStatus": "Invalid value"}
