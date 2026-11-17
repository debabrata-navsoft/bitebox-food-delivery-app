"""
What each notification type sends where, and how it reads on email and SMS.

- Category (the preference switch): `promo.*` → promotions, `order.*`/`payment.*` → orders,
  anything else → account (the same rule as Node's push.service#categoryOf).
- Web Push and FCM carry every type the person allows. Email and SMS carry only the types below:
  receipts, money and things the person must act on (SMS costs money and is opt-in).
- Email uses the shared layout (emails.py, templates/emails/layout.{html,txt}).
"""

from django.conf import settings

from . import emails
from .models import Channel, Notification

NOTIFICATION_FOOTER = (
    "You get this email because of your BiteBox account. Change which emails you get in Account, "
    "Notifications."
)

CATEGORIES = ("orders", "account", "promotions")

EMAIL_TYPES = frozenset(
    {
        "account.welcome",
        "order.placed",
        "order.rejected",
        "order.cancelled",
        "order.delivered",
        "payment.failed",
        "payment.refund_started",
        "payment.refunded",
        "payment.refund_failed",
    }
)
SMS_TYPES = frozenset(
    {
        "order.picked_up",  # carries the delivery code
        "order.delivery_code",
        "order.approaching",
        "order.cancelled",
        "order.rejected",
    }
)
SMS_MAX = 160


def category_of(type: str) -> str:
    if type.startswith("promo."):
        return "promotions"
    if type.startswith(("order.", "payment.")):
        return "orders"
    return "account"


def channels_for(type: str) -> set[str]:
    """The external channels this type may use (preferences and targets decide the rest)."""
    channels = {Channel.PUSH.value, Channel.FCM.value}
    if type in EMAIL_TYPES:
        channels.add(Channel.EMAIL.value)
    if type in SMS_TYPES:
        channels.add(Channel.SMS.value)
    return channels


def site_path(link: str) -> str:
    """Only same-site paths are linked from a notification (Node: push.service#safeLink)."""
    return link if link.startswith("/") and not link.startswith("//") else "/"


def absolute_link(link: str) -> str:
    base = settings.CLIENT_URLS[0].rstrip("/") if settings.CLIENT_URLS else ""
    return f"{base}{site_path(link)}"


def render_email(notification: Notification, name: str) -> tuple[str, str, str]:
    """(subject, text, html)."""
    subject = f"{notification.title} | BiteBox"
    text, html = emails.render(
        emails.Email(
            subject=subject,
            title=notification.title,
            name=name,
            lines=[notification.body] if notification.body else [],
            action_label="Open BiteBox",
            action_url=absolute_link(notification.link),
            footer=NOTIFICATION_FOOTER,
        )
    )
    return subject, text, html


def render_sms(notification: Notification) -> str:
    text = f"BiteBox: {notification.title}. {notification.body}".strip()
    return text if len(text) <= SMS_MAX else text[: SMS_MAX - 1] + "…"
