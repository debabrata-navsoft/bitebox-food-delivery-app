"""
Saved cards (the customer's Payment methods page). The gateway saves (tokenises) a card when the
customer agrees at checkout; BiteBox keeps only the token reference, network, last 4 digits and
expiry, never the card number (RBI card-on-file rules). With Razorpay the cards live with the
customer's Razorpay customer and are mirrored here; the simulated provider saves a test card.
"""

import contextlib
import logging
import secrets
import uuid
from typing import Any

from django.db import IntegrityError

from apps.accounts.models import User
from common.api import ApiError

from .models import PaymentCustomer, Provider, SavedCard
from .providers import online_provider, provider_named

logger = logging.getLogger(__name__)


def _ref(user: User, provider: str) -> str | None:
    return (
        PaymentCustomer.objects.filter(user=user, provider=provider)
        .values_list("provider_customer_id", flat=True)
        .first()
    )


def customer_ref(user: User) -> str | None:
    """The user's customer id at the online gateway, created once (None when it can't be)."""
    online = online_provider()
    if online is None:
        return None
    if found := _ref(user, online.name):
        return found
    try:
        ref = online.ensure_customer(user.name, user.email, user.phone or "")
    except Exception:
        logger.exception("Could not create the gateway customer", extra={"user_id": str(user.pk)})
        return None
    with contextlib.suppress(IntegrityError):  # created by a parallel request meanwhile
        PaymentCustomer.objects.create(user=user, provider=online.name, provider_customer_id=ref)
    return _ref(user, online.name)


def _sync(user: User, provider: str, remote: list[dict[str, Any]]) -> None:
    """Mirrors the gateway's cards: new ones are added, ones removed there are removed here."""
    tokens = {c["token_id"] for c in remote}
    SavedCard.objects.filter(user=user, provider=provider).exclude(
        provider_token_id__in=tokens
    ).delete()
    for c in remote:
        fields = {k: v for k, v in c.items() if k != "token_id"}
        SavedCard.objects.update_or_create(
            provider=provider, provider_token_id=c["token_id"], defaults={"user": user, **fields}
        )


def list_cards(user: User) -> dict[str, Any]:
    online = online_provider()
    if online is None:
        return {"cards": [], "can_save": False, "simulated": False}
    if ref := _ref(user, online.name):
        try:
            remote = online.saved_cards(ref)
            if remote is not None:
                _sync(user, online.name, remote)
        except Exception:  # show what we have; the gateway answers next time
            logger.exception("Could not load saved cards", extra={"user_id": str(user.pk)})
    cards = SavedCard.objects.filter(user=user, provider=online.name).order_by("-created_at")
    return {
        "cards": [card_json(c) for c in cards],
        "can_save": True,
        "simulated": online.simulated,
    }


def remove_card(user: User, card_id: uuid.UUID) -> None:
    card = SavedCard.objects.filter(pk=card_id, user=user).first()
    if card is None:
        raise ApiError.not_found("Card not found")
    provider = provider_named(card.provider)
    ref = _ref(user, card.provider)
    if provider is not None and ref:
        try:
            provider.delete_card(ref, card.provider_token_id)
        except Exception:
            logger.exception("Could not remove the saved card", extra={"card_id": str(card.pk)})
            raise ApiError(
                503,
                "Could not remove the card right now. Please try again.",
                code="PAYMENT_UNAVAILABLE",
            ) from None
    card.delete()


def save_test_card(user: User) -> None:
    """The simulated gateway's "Save this card": the test card, once per customer."""
    SavedCard.objects.get_or_create(
        user=user,
        provider=Provider.MOCK,
        last4="1111",
        defaults={
            "provider_token_id": f"mock_token_{secrets.token_hex(8)}",
            "network": "Visa",
            "issuer": "BiteBox Demo Bank",
            "card_type": "credit",
            "expiry_month": 12,
            "expiry_year": 2030,
        },
    )


def card_json(c: SavedCard) -> dict[str, Any]:
    return {
        "id": str(c.pk),
        "network": c.network or None,
        "last4": c.last4,
        "issuer": c.issuer or None,
        "card_type": c.card_type or None,
        "expiry_month": c.expiry_month,
        "expiry_year": c.expiry_year,
        "created_at": c.created_at,
    }
