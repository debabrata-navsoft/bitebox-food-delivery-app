"""
Roles and admin permissions. A port of backend/config/roles.js and backend/config/permissions.js;
the values are part of the API contract (user JSON, the Angular `Permission` type) and must not
drift. They live in code, not tables (docs/django-migration README, decision D4).

A role gives a *preset* of permissions. Admin-panel accounts may instead carry their own list
(`User.custom_permissions`); `effective_permissions` decides what a person can actually do, and
every check goes through `has_permission(user, permission)` (never the role alone).
"""

from collections.abc import Iterable
from enum import StrEnum
from typing import Any


class Role(StrEnum):
    CUSTOMER = "customer"
    ADMIN = "admin"  # the super admin: every permission, and the only role that manages admins
    RESTAURANT = "restaurant"
    DELIVERY = "delivery"
    OPERATIONS_ADMIN = "operations_admin"
    FINANCE_ADMIN = "finance_admin"
    SUPPORT_ADMIN = "support_admin"
    OPERATOR = "operator"  # admin panel; no preset, permissions come only from its custom list


ALL_ROLES: tuple[Role, ...] = tuple(Role)
STAFF_ADMIN_ROLES: tuple[Role, ...] = (
    Role.OPERATIONS_ADMIN,
    Role.FINANCE_ADMIN,
    Role.SUPPORT_ADMIN,
    Role.OPERATOR,
)
ADMIN_ROLES: tuple[Role, ...] = (Role.ADMIN, *STAFF_ADMIN_ROLES)
MEMBER_ROLES: tuple[Role, ...] = tuple(r for r in ALL_ROLES if r not in ADMIN_ROLES)

# Plain value lists (OpenAPI enum names, serializer choices).
ALL_ROLE_VALUES = [r.value for r in ALL_ROLES]
STAFF_ROLE_VALUES = [r.value for r in STAFF_ADMIN_ROLES]
ADMIN_ROLE_VALUES = [r.value for r in ADMIN_ROLES]

ROLE_LABEL: dict[Role, str] = {
    Role.CUSTOMER: "Customer",
    Role.ADMIN: "Super admin",
    Role.RESTAURANT: "Restaurant partner",
    Role.DELIVERY: "Delivery partner",
    Role.OPERATIONS_ADMIN: "Operations admin",
    Role.FINANCE_ADMIN: "Finance admin",
    Role.SUPPORT_ADMIN: "Support admin",
    Role.OPERATOR: "Operator",
}


class Permission(StrEnum):
    ADMINS_MANAGE = "admins:manage"
    AUDIT_VIEW = "audit:view"
    CATALOG_MANAGE = "catalog:manage"
    OPERATIONS_VIEW = "operations:view"
    ORDERS_VIEW = "orders:view"
    ORDERS_MANAGE = "orders:manage"
    RESTAURANTS_MANAGE = "restaurants:manage"
    RIDERS_MANAGE = "riders:manage"
    FINANCE_VIEW = "finance:view"
    REFUNDS_MANAGE = "refunds:manage"
    PAYOUTS_MANAGE = "payouts:manage"
    SUPPORT_MANAGE = "support:manage"
    REVIEWS_MODERATE = "reviews:moderate"
    REWARDS_MANAGE = "rewards:manage"
    REWARDS_VIEW = "rewards:view"
    PROMOTIONS_SEND = "promotions:send"
    # Accounts, per kind of member (replaced users:manage).
    CUSTOMERS_VIEW = "customers:view"
    CUSTOMERS_EDIT = "customers:edit"
    CUSTOMERS_STATUS = "customers:status"
    RESTAURANTS_VIEW = "restaurants:view"
    RESTAURANTS_EDIT = "restaurants:edit"
    RESTAURANTS_STATUS = "restaurants:status"
    RESTAURANTS_APPROVE = "restaurants:approve"
    RESTAURANTS_KYC = "restaurants:kyc"
    RIDERS_VIEW = "riders:view"
    RIDERS_EDIT = "riders:edit"
    RIDERS_STATUS = "riders:status"
    RIDERS_APPROVE = "riders:approve"
    RIDERS_KYC = "riders:kyc"
    ACCOUNTS_SUSPEND = "accounts:suspend"  # suspend or block any member


P = Permission
PERMISSION_VALUES = [p.value for p in Permission]
# Only the super admin has these; they can never be granted in a custom list.
SUPER_ADMIN_ONLY: frozenset[Permission] = frozenset({P.ADMINS_MANAGE})

ROLE_PERMISSIONS: dict[Role, frozenset[Permission]] = {
    Role.ADMIN: frozenset(Permission),
    Role.OPERATIONS_ADMIN: frozenset(
        {
            P.OPERATIONS_VIEW,
            P.ORDERS_VIEW,
            P.ORDERS_MANAGE,
            P.RESTAURANTS_MANAGE,
            P.RIDERS_MANAGE,
            P.RESTAURANTS_VIEW,
            P.RESTAURANTS_EDIT,
            P.RESTAURANTS_STATUS,
            P.RESTAURANTS_APPROVE,
            P.RESTAURANTS_KYC,
            P.RIDERS_VIEW,
            P.RIDERS_EDIT,
            P.RIDERS_STATUS,
            P.RIDERS_APPROVE,
            P.RIDERS_KYC,
        }
    ),
    Role.FINANCE_ADMIN: frozenset({P.FINANCE_VIEW, P.REFUNDS_MANAGE, P.PAYOUTS_MANAGE}),
    # Support reads orders to investigate complaints, but cannot change them or see finance.
    Role.SUPPORT_ADMIN: frozenset(
        {P.SUPPORT_MANAGE, P.ORDERS_VIEW, P.REVIEWS_MODERATE, P.CUSTOMERS_VIEW, P.CUSTOMERS_EDIT}
    ),
    Role.OPERATOR: frozenset(),
}

# The member kind each account permission is about (the target's role).
MEMBER_KIND: dict[Role, str] = {
    Role.CUSTOMER: "customers",
    Role.RESTAURANT: "restaurants",
    Role.DELIVERY: "riders",
}


def member_permission(role: str, action: str) -> Permission | None:
    """`customers:view` for a customer and "view", and so on; None for non-members."""
    try:
        kind = MEMBER_KIND.get(Role(role))
    except ValueError:
        return None
    return Permission(f"{kind}:{action}") if kind else None


# --- the permission editor's catalogue (GET /admin/admins/permissions) ---------------------------
PERMISSION_CATALOGUE: tuple[tuple[Permission, str, str], ...] = (
    (P.CUSTOMERS_VIEW, "View customers", "Customers"),
    (P.CUSTOMERS_EDIT, "Edit customers", "Customers"),
    (P.CUSTOMERS_STATUS, "Activate or deactivate customers", "Customers"),
    (P.RESTAURANTS_VIEW, "View restaurants", "Restaurants"),
    (P.RESTAURANTS_EDIT, "Edit restaurants", "Restaurants"),
    (P.RESTAURANTS_STATUS, "Activate or deactivate restaurants", "Restaurants"),
    (P.RESTAURANTS_APPROVE, "Approve restaurants", "Restaurants"),
    (P.RESTAURANTS_KYC, "Review restaurant documents", "Restaurants"),
    (P.RESTAURANTS_MANAGE, "Manage restaurants", "Restaurants"),
    (P.RIDERS_VIEW, "View delivery partners", "Delivery partners"),
    (P.RIDERS_EDIT, "Edit delivery partners", "Delivery partners"),
    (P.RIDERS_STATUS, "Activate or deactivate delivery partners", "Delivery partners"),
    (P.RIDERS_APPROVE, "Approve delivery partners", "Delivery partners"),
    (P.RIDERS_KYC, "Review delivery partner documents", "Delivery partners"),
    (P.RIDERS_MANAGE, "Manage delivery partners", "Delivery partners"),
    (P.ACCOUNTS_SUSPEND, "Suspend or block accounts", "Accounts"),
    (P.OPERATIONS_VIEW, "View operations", "Orders & operations"),
    (P.ORDERS_VIEW, "View orders", "Orders & operations"),
    (P.ORDERS_MANAGE, "Manage orders", "Orders & operations"),
    (P.FINANCE_VIEW, "View finance", "Finance"),
    (P.REFUNDS_MANAGE, "Manage refunds", "Finance"),
    (P.PAYOUTS_MANAGE, "Manage payouts", "Finance"),
    (P.SUPPORT_MANAGE, "Manage support tickets", "Support"),
    (P.REVIEWS_MODERATE, "Moderate reviews", "Support"),
    (P.CATALOG_MANAGE, "Manage catalog", "Catalog & marketing"),
    (P.PROMOTIONS_SEND, "Send promotions", "Catalog & marketing"),
    (P.REWARDS_VIEW, "View rewards", "Rewards"),
    (P.REWARDS_MANAGE, "Manage rewards", "Rewards"),
    (P.AUDIT_VIEW, "View audit log", "Admin"),
    (P.ADMINS_MANAGE, "Manage admins", "Admin"),
)

# Starting points for the editor (not roles).
PERMISSION_PRESETS: tuple[tuple[str, str, tuple[Permission, ...]], ...] = (
    ("support", "Support",
     (P.CUSTOMERS_VIEW, P.CUSTOMERS_EDIT, P.ORDERS_VIEW, P.SUPPORT_MANAGE, P.REVIEWS_MODERATE)),
    ("restaurant", "Restaurant management",
     (P.RESTAURANTS_VIEW, P.RESTAURANTS_EDIT, P.RESTAURANTS_APPROVE, P.RESTAURANTS_MANAGE)),
    ("delivery", "Delivery management",
     (P.RIDERS_VIEW, P.RIDERS_EDIT, P.RIDERS_APPROVE, P.RIDERS_MANAGE, P.ORDERS_VIEW)),
    ("kyc", "KYC review",
     (P.RESTAURANTS_VIEW, P.RIDERS_VIEW, P.RESTAURANTS_KYC, P.RIDERS_KYC)),
    ("finance", "Finance", (P.FINANCE_VIEW, P.REFUNDS_MANAGE, P.PAYOUTS_MANAGE)),
)  # fmt: skip


def permission_catalogue() -> dict[str, Any]:
    return {
        "permissions": [
            {"key": p.value, "label": label, "group": group}
            for p, label, group in PERMISSION_CATALOGUE
        ],
        "presets": [
            {"key": key, "label": label, "permissions": [p.value for p in perms]}
            for key, label, perms in PERMISSION_PRESETS
        ],
    }


def permissions_for(role: str | None) -> frozenset[Permission]:
    """The role's preset (the super admin: everything; members and unknown roles: nothing)."""
    try:
        return ROLE_PERMISSIONS.get(Role(role), frozenset()) if role else frozenset()
    except ValueError:
        return frozenset()


def effective_permissions(role: str | None, custom: Iterable[str] | None) -> frozenset[Permission]:
    """
    What a person may do: the super admin everything (any custom list is ignored); another
    admin-panel role its custom list when set, else the role preset; members nothing.
    """
    if role == Role.ADMIN:
        return frozenset(Permission)
    if role not in ADMIN_ROLE_VALUES:
        return frozenset()
    if custom is None:
        return permissions_for(role)
    known = {p.value: p for p in Permission}
    return frozenset(known[k] for k in custom if k in known and known[k] not in SUPER_ADMIN_ONLY)


def user_permissions(user: Any) -> frozenset[Permission]:
    """Effective permissions of a user (or anything with `role` and `custom_permissions`)."""
    if user is None:
        return frozenset()
    return effective_permissions(
        getattr(user, "role", None), getattr(user, "custom_permissions", None)
    )


def has_permission(user: Any, permission: Permission) -> bool:
    """Whether this person (not their role) holds `permission`. None / anonymous → False."""
    return permission in user_permissions(user)
