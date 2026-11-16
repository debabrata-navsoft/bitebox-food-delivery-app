"""
The one BiteBox email layout (templates/emails/layout.{html,txt}; Node: services/email-template.js).

Every email (sign-up and verification codes, links, password reset, notifications) is an `Email`:
a title, a few lines of text, and optionally a code, a button and small print. `send()` renders the
HTML and plain-text versions and sends them through Django's mail backend (SMTP, or the console in
development).
"""

from collections.abc import Sequence
from dataclasses import dataclass

from django.core.mail import send_mail
from django.template.loader import render_to_string

ACCOUNT_FOOTER = "You are getting this email because of your BiteBox account."


@dataclass(frozen=True)
class Email:
    subject: str
    title: str
    lines: Sequence[str] = ()
    name: str = ""
    code: str = ""
    action_label: str = ""
    action_url: str = ""
    note: str = ""
    footer: str = ACCOUNT_FOOTER

    @property
    def preheader(self) -> str:
        return self.lines[0] if self.lines else self.title


def render(email: Email) -> tuple[str, str]:
    """(text, html)."""
    context = {**email.__dict__, "preheader": email.preheader}
    text = render_to_string("emails/layout.txt", context).strip()
    return text, render_to_string("emails/layout.html", context)


def send(to: str, email: Email) -> None:
    text, html = render(email)
    send_mail(email.subject, text, None, [to], html_message=html)
