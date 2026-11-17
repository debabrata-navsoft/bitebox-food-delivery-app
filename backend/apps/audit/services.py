"""
Admin audit log (Node: services/audit.service.js). `@audited(...)` on an admin view records one
entry after the request succeeds; recording is best-effort and never fails the admin's action.

A view adds detail by setting, before it returns:
- `request.audit_changes`: `{ field: { "from": ..., "to": ... } }` (camelCase names, no secrets);
- `request.audit_reason`: why (e.g. the reason for a suspension);
- `request.audit_account_type`: the target's kind (worked out from the user when the resource is
  a user and the view did not say);
- `request.audit_skip = True`: nothing happened (a no-op), so nothing is recorded.
"""

import functools
import ipaddress
import logging
from collections.abc import Callable
from datetime import datetime
from typing import Any

from django.core.exceptions import ValidationError
from django.db.models import Q
from rest_framework.request import Request
from rest_framework.response import Response

from common.pagination import Page, paginate

from .models import AccountType, AuditLog

logger = logging.getLogger("bitebox.audit")


def _ip(request: Request) -> str | None:
    value = request.META.get("REMOTE_ADDR", "")
    try:
        return str(ipaddress.ip_address(value))
    except ValueError:
        return None


def account_type_of(role: str | None) -> str:
    """customer | restaurant | delivery | admin for a user's role ("" when unknown)."""
    from apps.rbac.roles import ADMIN_ROLE_VALUES

    if role in ADMIN_ROLE_VALUES:
        return AccountType.ADMIN
    return role if role in AccountType.values else ""


def _target_account_type(resource_type: str, resource_id: Any) -> str:
    if resource_type != "user" or not resource_id:
        return ""
    from apps.accounts.models import User

    try:
        role = User.objects.filter(pk=resource_id).values_list("role", flat=True).first()
    except (ValueError, TypeError, ValidationError):
        return ""
    return account_type_of(role)


def change(before: Any, after: Any) -> dict[str, Any]:
    """One `{ from, to }` entry of `audit_changes` (dates as ISO strings)."""

    def plain(value: Any) -> Any:
        return value.isoformat() if hasattr(value, "isoformat") else value

    return {"from": plain(before), "to": plain(after)}


def note(
    request: Request,
    changes: dict[str, Any],
    *,
    reason: str | None = None,
    account_type: str | None = None,
    skip_unchanged: bool = True,
) -> None:
    """Fills in the `@audited` entry (see above); by default a no-op (no changes) records none."""
    if skip_unchanged and not changes:
        request.audit_skip = True  # type: ignore[attr-defined]
    request.audit_changes = changes  # type: ignore[attr-defined]
    if reason:
        request.audit_reason = reason  # type: ignore[attr-defined]
    if account_type is not None:
        request.audit_account_type = account_type  # type: ignore[attr-defined]


def record(
    user: Any,
    action: str,
    resource_type: str,
    resource_id: Any,
    description: str,
    ip: str | None,
    *,
    changes: dict[str, Any] | None = None,
    reason: str | None = None,
    account_type: str | None = None,
) -> None:
    try:
        if account_type is None:
            account_type = _target_account_type(resource_type, resource_id)
        AuditLog.objects.create(
            admin=user,
            admin_role=user.role,
            action=action,
            description=str(description)[:500],
            resource_type=resource_type,
            resource_id=str(resource_id or "")[:64],
            ip=ip,
            account_type=account_type or "",
            changes=changes or {},
            reason=str(reason or "")[:500],
        )
    except Exception:
        logger.exception("Could not write audit log", extra={"action": action})


def audited(
    action: str, resource_type: str, describe: Callable[[Request], str]
) -> Callable[..., Any]:
    """
    Decorates an admin view method. After a successful (< 400) response, records `action` against
    `kwargs["id"]`, or `request.audit_resource_id` when the view creates the resource.
    """

    def decorator(view: Callable[..., Response]) -> Callable[..., Response]:
        @functools.wraps(view)
        def wrapper(self: Any, request: Request, *args: Any, **kwargs: Any) -> Response:
            response = view(self, request, *args, **kwargs)
            skip = getattr(request, "audit_skip", False)
            if response.status_code < 400 and request.user is not None and not skip:
                record(
                    request.user,
                    action,
                    resource_type,
                    kwargs.get("id") or getattr(request, "audit_resource_id", None),
                    describe(request),
                    _ip(request),
                    changes=getattr(request, "audit_changes", None),
                    reason=getattr(request, "audit_reason", None),
                    account_type=getattr(request, "audit_account_type", None),
                )
            return response

        return wrapper

    return decorator


def list_entries(query: dict[str, Any], page: Page) -> dict[str, Any]:
    qs = AuditLog.objects.select_related("admin").order_by("-created_at")
    if query.get("action"):
        qs = qs.filter(action=query["action"])
    if query.get("role"):
        qs = qs.filter(admin_role=query["role"])
    if query.get("account_type"):
        qs = qs.filter(account_type=query["account_type"])
    if query.get("resource_id"):  # a list of up to 5 ids
        qs = qs.filter(resource_id__in=query["resource_id"])
    if search := (query.get("search") or "").strip():
        qs = qs.filter(Q(description__icontains=search) | Q(resource_id=search))
    start: datetime | None = query.get("from")
    end: datetime | None = query.get("to")
    if start:
        qs = qs.filter(created_at__gte=start)
    if end:
        qs = qs.filter(created_at__lte=end)
    items, meta = paginate(qs, page)
    return {
        "items": [
            {
                "id": str(e.pk),
                "admin": {"id": str(e.admin.pk), "name": e.admin.name, "email": e.admin.email}
                if e.admin
                else None,
                "admin_role": e.admin_role,
                "action": e.action,
                "description": e.description,
                "resource_type": e.resource_type,
                "resource_id": e.resource_id,
                "ip": e.ip,
                "account_type": e.account_type,
                "changes": e.changes or {},
                "reason": e.reason,
                "created_at": e.created_at,
            }
            for e in items
        ],
        "pagination": meta,
    }
