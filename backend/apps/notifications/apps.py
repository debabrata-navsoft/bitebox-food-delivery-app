from typing import Any

from django.apps import AppConfig

# Per role: the welcome notification's body and link.
WELCOME = {
    "customer": ("Find a restaurant near you and order in minutes.", "/"),
    "restaurant": ("Add your restaurant details to start receiving orders.", "/restaurant/details"),
    "delivery": ("Add your vehicle, go online and start earning.", "/delivery"),
}


def welcome(user: Any, data: Any, meta: Any) -> None:
    """A registration hook: the welcome notification (in-app, and email when allowed)."""
    from .services import notify

    body, link = WELCOME.get(user.role, WELCOME["customer"])
    title = f"Welcome to BiteBox, {user.name}!"
    notify(user.pk, type="account.welcome", title=title, body=body, link=link)


class NotificationsConfig(AppConfig):
    name = "apps.notifications"
    label = "notifications"

    def ready(self) -> None:
        from apps.accounts.services import registration_hooks

        if welcome not in registration_hooks:
            registration_hooks.append(welcome)
