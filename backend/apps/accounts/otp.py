"""
One-time codes (Node: services/otp.service.js): by SMS to sign in with a phone number or confirm a
signed-in person's number, and by email to confirm the address at sign-up or later.

- 6 digits from `secrets`; only an HMAC (keyed with SECRET_KEY) is stored.
- A code lives OTP_TTL_SECONDS and allows OTP_MAX_ATTEMPTS tries; a new one can be asked for after
  OTP_RESEND_SECONDS, at most OTP_PER_PHONE_PER_HOUR per number or email address and
  OTP_PER_IP_PER_HOUR per IP.
- Sign-in requests get the same answer whether or not the number has an account (a code is only
  sent when it does), so the endpoint cannot be used to find out who is registered.
"""

import hashlib
import hmac
import logging
import re
import secrets
from datetime import timedelta
from typing import Any

from django.conf import settings
from django.db.models import F
from django.utils import timezone

from apps.notifications import emails
from apps.notifications.senders import deliver_sms, sms_enabled
from common.api import ApiError

from .models import OtpChallenge, OtpPurpose, User, UserStatus

logger = logging.getLogger("bitebox.auth")


def _hash(target: str, code: str) -> str:
    return hmac.new(
        settings.SECRET_KEY.encode(), f"{target}:{code}".encode(), hashlib.sha256
    ).hexdigest()


def _limit(message: str) -> ApiError:
    return ApiError(429, message, code="OTP_RATE_LIMITED")


def _normalise_email(email: str) -> str:
    return email.strip().lower()


def _create(field: str, target: str, purpose: str, ip: str | None) -> tuple[OtpChallenge, str]:
    """Checks the resend wait and hourly limits for the number or address in `field`, then stores
    a new challenge; returns it and its code."""
    now = timezone.now()
    recent = OtpChallenge.objects.filter(purpose=purpose, **{field: target})
    last = recent.order_by("-created_at").first()
    if last and (wait := settings.OTP_RESEND_SECONDS - (now - last.created_at).total_seconds()) > 0:
        raise _limit(f"Wait {int(wait) + 1} seconds before asking for a new code")
    hour_ago = now - timedelta(hours=1)
    if recent.filter(created_at__gte=hour_ago).count() >= settings.OTP_PER_PHONE_PER_HOUR:
        what = "number" if field == "phone" else "email address"
        raise _limit(f"Too many codes for this {what}. Try again in an hour")
    if (
        ip
        and OtpChallenge.objects.filter(ip=ip, created_at__gte=hour_ago).count()
        >= settings.OTP_PER_IP_PER_HOUR
    ):
        raise _limit("Too many codes requested. Try again in an hour")

    code = f"{secrets.randbelow(10**6):06d}"
    challenge = OtpChallenge.objects.create(
        purpose=purpose,
        code_hash=_hash(target, code),
        expires_at=now + timedelta(seconds=settings.OTP_TTL_SECONDS),
        ip=ip,
        **{field: target},
    )
    return challenge, code


def _sent() -> dict[str, Any]:
    return {
        "resendInSeconds": settings.OTP_RESEND_SECONDS,
        "expiresInSeconds": settings.OTP_TTL_SECONDS,
    }


def send_code(phone: str, purpose: str, ip: str | None, send: bool) -> dict[str, Any]:
    """Creates a challenge (always) and texts the code when `send` (e.g. the number has an
    account, for sign-in)."""
    if not sms_enabled():
        raise ApiError(
            503,
            "We can't send text messages right now. Please try again later",
            code="SMS_UNAVAILABLE",
        )
    _, code = _create("phone", phone, purpose, ip)
    if send:
        minutes = settings.OTP_TTL_SECONDS // 60
        deliver_sms(
            phone,
            f"{code} is your BiteBox code. It expires in {minutes} minutes. Never share it.",
            settings.MSG91_OTP_TEMPLATE_ID or None,
        )
    return _sent()


def send_email_code(email: str, purpose: str, ip: str | None, name: str = "") -> dict[str, Any]:
    """Emails a 6-digit code that proves the address (sign-up, or verifying it later)."""
    email = _normalise_email(email)
    challenge, code = _create("email", email, purpose, ip)
    minutes = settings.OTP_TTL_SECONDS // 60
    try:
        emails.send(
            email,
            emails.Email(
                subject=f"{code} is your BiteBox verification code",
                title="Your verification code",
                name=name,
                lines=["Enter this code in BiteBox to confirm your email address."],
                code=code,
                note=(
                    f"It expires in {minutes} minutes. Never share it with anyone. If you did not "
                    "ask for it, you can ignore this email."
                ),
            ),
        )
    except Exception:
        challenge.delete()  # not sent, so it should not count against the limits
        logger.exception("Verification code email failed")
        raise ApiError(
            503,
            "We can't send emails right now. Please try again later",
            code="EMAIL_UNAVAILABLE",
        ) from None
    return _sent()


def check_code(phone: str, purpose: str, code: str) -> None:
    """Uses up the latest live code for this number, or raises 400/429. Each try counts."""
    _check("phone", phone, purpose, code)


def check_email_code(email: str, purpose: str, code: str) -> None:
    """Uses up the latest live code emailed to this address, or raises 400/429."""
    _check("email", _normalise_email(email), purpose, code)


def _check(field: str, target: str, purpose: str, code: str) -> None:
    challenge = (
        OtpChallenge.objects.filter(
            purpose=purpose,
            consumed_at__isnull=True,
            expires_at__gt=timezone.now(),
            **{field: target},
        )
        .order_by("-created_at")
        .first()
    )
    if challenge is None:
        raise ApiError.bad_request("This code has expired. Ask for a new one")
    if challenge.attempts >= settings.OTP_MAX_ATTEMPTS:
        raise ApiError(429, "Too many wrong codes. Ask for a new one", code="OTP_LOCKED")
    OtpChallenge.objects.filter(pk=challenge.pk).update(attempts=F("attempts") + 1)
    if not hmac.compare_digest(challenge.code_hash, _hash(target, code)):
        left = settings.OTP_MAX_ATTEMPTS - challenge.attempts - 1
        raise ApiError.bad_request(
            f"That code is not right. {left} {'try' if left == 1 else 'tries'} left"
            if left
            else "That code is not right. Ask for a new one"
        )
    # Exactly once, even if two requests carry the right code at the same moment.
    if not OtpChallenge.objects.filter(pk=challenge.pk, consumed_at__isnull=True).update(
        consumed_at=timezone.now()
    ):
        raise ApiError.bad_request("This code has already been used. Ask for a new one")


def phone_forms(phone: str) -> set[str]:
    """The ways one Indian mobile number may be stored: as typed, 10 digits, +91 and 91 prefixed."""
    digits = re.sub(r"\D", "", phone)
    forms = {phone, digits, f"+{digits}"}
    if len(digits) >= 10:
        last10 = digits[-10:]
        forms |= {last10, f"+91{last10}", f"91{last10}"}
    return forms


def login_user(phone: str) -> User | None:
    return User.objects.filter(phone__in=phone_forms(phone), status=UserStatus.ACTIVE).first()


def request_login_code(phone: str, ip: str | None) -> dict[str, Any]:
    return send_code(phone, OtpPurpose.LOGIN, ip, login_user(phone) is not None)
