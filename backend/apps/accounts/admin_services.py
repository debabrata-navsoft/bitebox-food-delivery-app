"""Account administration (Node: services/admin-staff.service.js)."""

import re
import uuid
from collections.abc import Iterable
from datetime import datetime, timedelta
from typing import Any

from django.conf import settings
from django.db import transaction
from django.db.models import Count, Max, Min, Q, QuerySet, Sum, Value
from django.db.models.functions import Coalesce, Lower
from django.utils import timezone

from apps.audit.services import change
from apps.coins.special import birth_date_from
from apps.customers import services as addresses
from apps.delivery.models import DeliveryPartner
from apps.orders.models import Order, OrderStatus
from apps.rbac.roles import (
    ADMIN_ROLE_VALUES,
    ADMIN_ROLES,
    MEMBER_ROLE_VALUES,
    MEMBER_ROLES,
    STAFF_ADMIN_ROLES,
    Permission,
    Role,
    has_permission,
    member_permission,
    user_permissions,
)
from apps.uploads.storage import is_uploaded_image_url
from common.api import ApiError
from common.filters import Facet, apply_facets, days_between, with_facets
from common.pagination import Page, paginate
from common.permissions import NO_ACCESS

from .models import RevokedReason, Session, User, UserStatus
from .otp import phone_forms
from .serializers import STAFF_ROLE_MESSAGE, user_json
from .services import check_new_account, end_sessions, send_email_verification, send_password_reset

Changes = dict[str, dict[str, Any]]


# --- what an admin may do with a member ---------------------------------------------------------
def may(actor: User, target_role: str, action: str) -> bool:
    """`<kind>:<action>` for the target's kind (customers / restaurants / riders)."""
    permission = member_permission(target_role, action)
    return permission is not None and has_permission(actor, permission)


def viewable_roles(actor: User) -> tuple[Role, ...]:
    """The member roles whose accounts this admin may see."""
    return tuple(r for r in MEMBER_ROLES if may(actor, r, "view"))


def require(allowed: bool) -> None:
    if not allowed:
        raise ApiError.forbidden(NO_ACCESS)


def status_permission(target_role: str, status: str) -> Permission | None:
    """active/inactive: `<kind>:status`; suspended/blocked: accounts:suspend."""
    if status in (UserStatus.SUSPENDED, UserStatus.BLOCKED):
        return Permission.ACCOUNTS_SUSPEND
    return member_permission(target_role, "status")


USER_STATUS_FACET = Facet("status", values=UserStatus.values)
STAFF_FACETS = (Facet("role", values=ADMIN_ROLE_VALUES), USER_STATUS_FACET)


def _staff(query: dict[str, Any]) -> QuerySet[User]:
    qs = apply_facets(User.objects.filter(role__in=ADMIN_ROLES), query, STAFF_FACETS)
    if search := (query.get("search") or "").strip():
        qs = qs.filter(
            Q(name__icontains=search) | Q(email__icontains=search) | Q(phone__icontains=search)
        )
    return qs


def list_staff(query: dict[str, Any], page: Page) -> dict[str, Any]:
    """Admins, newest first; `role` and `status` take several values (facets: STAFF_FACETS)."""
    items, meta = paginate(_staff(query).order_by("-created_at"), page)
    result = {"items": [user_json(u) for u in items], "pagination": meta}
    return with_facets(result, query, _staff, STAFF_FACETS)


def get_member(user_id: uuid.UUID) -> User:
    """A customer, restaurant partner or rider; anyone else (admins, unknown ids) is a 404."""
    user = User.objects.filter(pk=user_id, role__in=MEMBER_ROLES).first()
    if user is None:
        raise ApiError.not_found("User not found")
    return user


def get_member_for(actor: User, user_id: uuid.UUID, action: str) -> User:
    """A member this admin may `action` (view / edit): unknown → 404, not allowed → 403."""
    user = get_member(user_id)
    require(may(actor, user.role, action))
    return user


def get_customer(actor: User, user_id: uuid.UUID) -> User:
    """The member whose saved addresses an admin manages; only customers have them."""
    user = get_member_for(actor, user_id, "edit")
    if user.role != Role.CUSTOMER:
        raise ApiError.bad_request("Only customers have saved addresses")
    return user


# Final statuses that are not a delivery: the order failed (the customer was not served).
FAILED_STATUSES = (OrderStatus.CANCELLED, OrderStatus.REJECTED)


def order_totals(orders: QuerySet[Order], paid_key: str) -> dict[str, Any]:
    """Orders placed, delivered and failed, the delivered orders' total (as `paid_key`, paise) and
    the newest order's time."""
    stats = orders.aggregate(
        orders=Count("pk"),
        delivered=Count("pk", filter=Q(status=OrderStatus.DELIVERED)),
        cancelled=Count("pk", filter=Q(status__in=FAILED_STATUSES)),
        **{paid_key: Sum("total_paise", filter=Q(status=OrderStatus.DELIVERED))},
        last_order_at=Max("created_at"),
    )
    stats[paid_key] = stats[paid_key] or 0
    return stats


def member_detail(user: User) -> dict[str, Any]:
    """The admin's view of one member: account, saved addresses, order totals, their restaurant."""
    from apps.restaurants.models import Restaurant

    owns = Restaurant.objects.filter(owner=user, owner__role=Role.RESTAURANT)
    return {
        "user": user_json(user),
        "addresses": [addresses.address_json(a) for a in addresses.list_for(user)],
        "stats": order_totals(Order.objects.filter(customer=user), "spent_paise"),
        "restaurant": owns.values("id", "name", "slug", "status").first(),
    }


# Audit names of the fields an admin may correct (camelCase, as in the API).
MEMBER_FIELDS = {
    "name": "name",
    "birth_date": "birthDate",
    "gender": "gender",
    "avatar_url": "avatarUrl",
}


def update_member(user: User, data: dict[str, Any]) -> tuple[User, Changes]:
    """
    Support corrects a member's name, date of birth, gender or photo (never email, phone, role or
    status). Returns the user and what changed ({ field: { from, to } }).
    """
    before = {f: getattr(user, f) for f in MEMBER_FIELDS}
    if "name" in data:
        user.name = data["name"]
    if "birth_date" in data:  # null clears it
        user.birth_date = birth_date_from(data["birth_date"]) if data["birth_date"] else None
    if "gender" in data:
        user.gender = data["gender"] or None
    if "avatar_url" in data:  # null or "" removes it
        url = data["avatar_url"] or None
        if url and not is_uploaded_image_url(url):
            raise ApiError.bad_request("Upload the photo first")
        user.avatar_url = url
    changed = [f for f in MEMBER_FIELDS if f in data and getattr(user, f) != before[f]]
    if changed:
        user.save(update_fields=[*changed, "updated_at"])
    return user, {MEMBER_FIELDS[f]: change(before[f], getattr(user, f)) for f in changed}


STATUS_MESSAGES = {
    UserStatus.ACTIVE: "reactivated",
    UserStatus.INACTIVE: "deactivated",
    UserStatus.SUSPENDED: "suspended",
    UserStatus.BLOCKED: "blocked",
}


def apply_status(user: User, status: str, reason: str | None) -> Changes:
    """
    Sets an account status (any role). Every status but active signs the person out everywhere at
    once; a rider is taken offline first (never mid-delivery; an open offer goes to the next
    rider). The same status again changes nothing (returns {}).
    """
    if user.status == status:
        return {}
    previous = user.status
    with transaction.atomic():
        if user.role == Role.DELIVERY and status != UserStatus.ACTIVE:
            _take_rider_offline(user, status)
        user.status = status
        user.status_reason = reason if status != UserStatus.ACTIVE else None
        user.status_changed_at = timezone.now()
        end_sessions(
            user,
            RevokedReason.LOGOUT if status == UserStatus.ACTIVE else RevokedReason.SUSPENDED,
            fields=("status", "status_reason", "status_changed_at"),
        )
    return {"status": {"from": previous, "to": status}}


def set_account_status(
    actor: User,
    user_id: uuid.UUID,
    status: str,
    reason: str | None,
    roles: tuple[Role, ...],
) -> tuple[User, Changes]:
    """
    Changes the status of an account whose role is in `roles` (Users page: member roles, where
    active/inactive need `<kind>:status` and suspended/blocked `accounts:suspend`; Admin
    management: admin roles, already limited to admins:manage).
    """
    if actor.pk == user_id:
        raise ApiError.bad_request("You cannot suspend your own account")
    user = User.objects.filter(pk=user_id).first()
    if user is None:
        raise ApiError.not_found("User not found")
    if user.role not in roles:
        raise ApiError.bad_request(
            "Manage admin accounts from Admin management"
            if user.role in ADMIN_ROLES
            else "This is not an admin account"
        )
    if user.role in MEMBER_ROLES:
        permission = status_permission(user.role, status)
        require(permission is not None and has_permission(actor, permission))
    return user, apply_status(user, status, reason)


def _take_rider_offline(user: User, status: str) -> None:
    """Same rule as the riders page: never mid-delivery; an open offer goes to the next rider.
    Logged in the availability history as the system's doing (the account stopped being active)."""
    from apps.delivery.services import take_offline

    take_offline(
        user,
        DeliveryPartner.objects.filter(user=user).first(),
        "This rider is carrying an order. Unassign or finish it first.",
        reason=f"Account {STATUS_MESSAGES[UserStatus(status)]}",
    )


def get_staff(user_id: uuid.UUID) -> User:
    user = User.objects.filter(pk=user_id, role__in=ADMIN_ROLES).first()
    if user is None:
        raise ApiError.not_found("Admin not found")
    return user


def _effective(user: User) -> list[str]:
    return sorted(p.value for p in user_permissions(user))


def create_staff(data: dict[str, Any]) -> tuple[User, Changes]:
    """
    A staff admin or operator. `permissions` (a list) becomes their own permission list; left
    out or null, the role preset applies.
    """
    if data["role"] not in STAFF_ADMIN_ROLES:
        raise ApiError.bad_request(STAFF_ROLE_MESSAGE)
    phone = data.get("phone") or None
    check_new_account(data["email"], phone)
    user = User.objects.create_user(
        data["email"],
        data["password"],
        data["name"],
        phone=phone,
        role=data["role"],
        custom_permissions=data.get("permissions"),
    )
    changes: Changes = {
        "role": {"from": None, "to": user.role},
        "permissions": {"from": [], "to": _effective(user)},
    }
    return user, changes


def update_staff(actor: User, user_id: uuid.UUID, data: dict[str, Any]) -> tuple[User, Changes]:
    """
    Edits a staff admin. Super admins aren't editable here; a role change signs the admin out.
    `permissions` sets their own list (null: back to the role preset); new permissions apply on
    their next request (every request re-reads the user).
    """
    if actor.pk == user_id:
        raise ApiError.bad_request("Use your profile page to edit your own account")
    user = User.objects.filter(pk=user_id, role__in=STAFF_ADMIN_ROLES).first()
    if user is None:
        raise ApiError.not_found("Admin not found")
    phone = data.get("phone")
    if phone and phone != user.phone and User.objects.filter(phone=phone).exists():
        raise ApiError.conflict("An account with this phone number already exists")

    before_role, before_permissions = user.role, _effective(user)
    fields: list[str] = []
    if "name" in data:
        user.name = data["name"]
        fields.append("name")
    if "phone" in data:
        user.phone = phone or None
        fields.append("phone")
    if "permissions" in data:
        user.custom_permissions = data["permissions"]
        fields.append("custom_permissions")
    role = data.get("role")
    if role and role != user.role:
        user.role = role
        end_sessions(user, RevokedReason.ROLE_CHANGE, fields=(*fields, "role"))
    elif fields:
        user.save(update_fields=[*fields, "updated_at"])
    changes: Changes = {}
    if user.role != before_role:
        changes["role"] = {"from": before_role, "to": user.role}
    if (after := _effective(user)) != before_permissions:
        changes["permissions"] = {"from": before_permissions, "to": after}
    return user, changes


def login_history(user_id: uuid.UUID, roles: tuple[Role, ...], page: Page) -> dict[str, Any]:
    """
    Sign-ins of one account, newest first (master prompt §3D "login history"). A sign-in is a
    session family: refreshes rotate the token inside it, so its first row is the sign-in and its
    newest row says whether it is still active.
    """
    if not User.objects.filter(pk=user_id, role__in=roles).exists():
        raise ApiError.not_found("User not found")
    families = (
        Session.objects.filter(user_id=user_id)
        .values("family")
        .annotate(started=Min("created_at"), last=Max("created_at"))
        .order_by("-started")
    )
    rows, meta = paginate(families, page)
    firsts: dict[str, Session] = {}
    latest: dict[str, Session] = {}
    for s in Session.objects.filter(
        user_id=user_id, family__in=[r["family"] for r in rows]
    ).order_by("created_at"):
        firsts.setdefault(s.family, s)  # the sign-in
        latest[s.family] = s  # its newest refresh
    now = timezone.now()
    items = []
    for r in rows:
        first, last = firsts.get(r["family"]), latest.get(r["family"])
        if first is None or last is None:
            continue
        active = last.revoked_at is None and last.expires_at > now
        items.append(
            {
                "signed_in_at": r["started"],
                "last_active_at": r["last"],
                "ip": first.ip,
                "user_agent": first.user_agent,
                "active": active,
                "ended_reason": None if active else (last.revoked_reason or "expired"),
            }
        )
    return {"items": items, "pagination": meta}


# --- customers (Account management phase 2) -----------------------------------------------------
# The sorts every account list has (customers, restaurants, riders); each adds its own.
ACCOUNT_SORTS: dict[str, tuple[Any, ...]] = {
    "newest": ("-created_at", "-id"),
    "oldest": ("created_at", "id"),
    "name": (Lower("name"), "-created_at", "-id"),
}
CUSTOMER_SORTS: dict[str, tuple[Any, ...]] = {
    **ACCOUNT_SORTS,
    "orders": ("-stat_orders", "-created_at", "-id"),
    "spent": ("-stat_spent_paise", "-created_at", "-id"),
}
VERIFICATION_FILTERS = {
    "email_verified": Q(email_verified_at__isnull=False),
    "email_unverified": Q(email_verified_at__isnull=True),
    "phone_verified": Q(phone_verified_at__isnull=False),
    "phone_unverified": Q(phone_verified_at__isnull=True),
}
_ID_SUFFIX = re.compile(r"^[0-9a-f]{6,32}$")


def joined_between(query: dict[str, Any]) -> Q:
    """`joined_from` / `joined_to`: whole calendar days (inclusive) in the report time zone."""
    return days_between(query, "joined")


def distinct_names(values: Iterable[str | None]) -> list[str]:
    """Distinct non-empty values, trimmed, A→Z; the same name in other letter cases once."""
    names: dict[str, str] = {}
    for name in sorted({(v or "").strip() for v in values}):
        if name:
            names.setdefault(name.casefold(), name)
    return sorted(names.values(), key=lambda n: (n.casefold(), n))


def person_search(search: str, prefix: str = "") -> Q:
    """Name, email or phone (any stored form of the number) of a user (`prefix`: the path to the
    user, e.g. "owner__")."""

    def q(lookup: str, value: Any) -> Q:
        return Q(**{prefix + lookup: value})

    match = q("name__icontains", search) | q("email__icontains", search)
    match |= q("phone__icontains", search)
    digits = re.sub(r"\D", "", search)
    if len(digits) >= 10:
        match |= q("phone__in", phone_forms(search))
    elif len(digits) >= 3 and digits != search:  # "98765 43" → the digits as stored
        match |= q("phone__icontains", digits)
    return match


def id_search(search: str) -> Q:
    """The row's own id: whole, or its last 6+ hex characters, with or without the "#" the app
    shows before the last 8 (upper-cased). Matches nothing for other text."""
    hex_id = search.lstrip("#").lower()
    try:
        return Q(pk=uuid.UUID(hex_id))
    except ValueError:
        return Q(id__endswith=hex_id) if _ID_SUFFIX.match(hex_id) else Q(pk__in=[])


# --- every member (the Users page) ---------------------------------------------------------------
MEMBER_FACETS = (Facet("role", values=MEMBER_ROLE_VALUES), USER_STATUS_FACET)


def list_members(actor: User, query: dict[str, Any], page: Page) -> dict[str, Any]:
    """
    Customers, restaurant partners and riders: only the kinds this admin may view (asking for
    another kind is a 403). `role` and `status` take several values; search, joined days and the
    account sorts work as on the customers list.
    """
    roles = viewable_roles(actor)
    require(bool(roles) and set(query.get("role") or ()) <= set(roles))

    def build(q: dict[str, Any]) -> QuerySet[User]:
        return _accounts(User.objects.filter(role__in=roles), q, MEMBER_FACETS)

    items, meta = paginate(
        build(query).order_by(*ACCOUNT_SORTS[query.get("sort") or "newest"]), page
    )
    result = {"items": [user_json(u) for u in items], "pagination": meta}
    return with_facets(result, query, build, MEMBER_FACETS)


CUSTOMER_FACETS = (
    USER_STATUS_FACET,
    # The four values overlap (a customer is email_verified and phone_unverified...).
    Facet("verification", values=list(VERIFICATION_FILTERS), cases=VERIFICATION_FILTERS),
)


def _accounts(
    qs: QuerySet[User], query: dict[str, Any], specs: tuple[Facet, ...]
) -> QuerySet[User]:
    """`qs` narrowed by the facets, the joined days and the search (name, email, phone or id)."""
    qs = apply_facets(qs, query, specs).filter(joined_between(query))
    if search := (query.get("search") or "").strip():
        qs = qs.filter(person_search(search) | id_search(search))
    return qs


def _customers(query: dict[str, Any]) -> QuerySet[User]:
    return _accounts(User.objects.filter(role=Role.CUSTOMER), query, CUSTOMER_FACETS)


def list_customers(query: dict[str, Any], page: Page) -> dict[str, Any]:
    """
    Customers with their order totals, counted in the database so the orders/spent sorts page
    correctly: every order placed, money spent on delivered orders, the newest order's time.
    """
    qs = _customers(query).annotate(
        stat_orders=Count("orders"),
        stat_spent_paise=Coalesce(
            Sum("orders__total_paise", filter=Q(orders__status=OrderStatus.DELIVERED)), Value(0)
        ),
        stat_last_order_at=Max("orders__created_at"),
    )
    rows, meta = paginate(qs.order_by(*CUSTOMER_SORTS[query.get("sort") or "newest"]), page)
    items = [
        {
            **user_json(u),
            "stats": {
                "orders": u.stat_orders,
                "spent_paise": u.stat_spent_paise,
                "last_order_at": u.stat_last_order_at,
            },
        }
        for u in rows
    ]
    return with_facets({"items": items, "pagination": meta}, query, _customers, CUSTOMER_FACETS)


def get_customer_account(user_id: uuid.UUID) -> User:
    """A customer account (the /admin/customers routes); anyone else is a 404."""
    user = User.objects.filter(pk=user_id, role=Role.CUSTOMER).first()
    if user is None:
        raise ApiError.not_found("Customer not found")
    return user


# Support may send a link at most once a minute per account (the user-facing routes are limited
# per IP); a link the person asked for themselves counts too.
HELP_RESEND = timedelta(minutes=1)


def _sent_recently(expires_at: datetime | None, ttl: timedelta) -> bool:
    return expires_at is not None and expires_at - ttl > timezone.now() - HELP_RESEND


def _too_soon() -> ApiError:
    return ApiError(429, "A link was sent a moment ago. Try again in a minute", code="RATE_LIMITED")


def send_customer_password_reset(user: User) -> None:
    """The forgot-password email (same token, expiry and template); never shows a password."""
    if user.status != UserStatus.ACTIVE:
        raise ApiError.conflict("The account is not active")
    ttl = timedelta(minutes=settings.PASSWORD_RESET_TTL_MINUTES)
    if _sent_recently(user.password_reset_expires_at, ttl):
        raise _too_soon()
    send_password_reset(user)


def send_customer_email_verification(user: User) -> None:
    """The email verification link, as sent after sign-up."""
    if user.email_verified_at:
        raise ApiError.conflict("The email is already verified")
    ttl = timedelta(hours=settings.EMAIL_VERIFICATION_TTL_HOURS)
    if _sent_recently(user.email_verification_expires_at, ttl):
        raise _too_soon()
    send_email_verification(user)
