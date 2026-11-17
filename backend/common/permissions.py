"""
DRF permission classes: the Django side of `authorize(...roles)` and `can(PERMISSIONS.X)` in the
Node API. Use them in `permission_classes`:

    permission_classes = [role_required(Role.RESTAURANT)]
    permission_classes = [permission_required(Permission.ORDERS_MANAGE)]
    permission_classes = [permission_required(Permission.CUSTOMERS_VIEW, Permission.RIDERS_VIEW)]

With several permissions, any one of them is enough.

Admin routes check a permission, never a role. Ownership (a restaurant's own orders, a rider's
own delivery) is enforced in selectors from `request.user`, never from ids sent by the client.
"""

from typing import Any

from rest_framework.permissions import AllowAny, BasePermission
from rest_framework.request import Request

from apps.rbac.roles import Permission, Role, has_permission

# Deny by default: views without `permission_classes` need a signed-in user (REST_FRAMEWORK
# DEFAULT_PERMISSION_CLASSES). Public endpoints opt in with `permission_classes = PUBLIC`, and
# tests/test_access_control.py keeps the list of public routes explicit.
PUBLIC: list[type[BasePermission]] = [AllowAny]


def _user_role(request: Request) -> str | None:
    user = getattr(request, "user", None)
    if user is None or not getattr(user, "is_authenticated", False):
        return None
    return getattr(user, "role", None)


class IsSignedIn(BasePermission):
    def has_permission(self, request: Request, view: Any) -> bool:
        return _user_role(request) is not None


def role_required(*roles: Role) -> type[BasePermission]:
    """Any of these roles. Anonymous → 401, wrong role → 403."""
    allowed = frozenset(roles)

    class RoleRequired(IsSignedIn):
        def has_permission(self, request: Request, view: Any) -> bool:
            role = _user_role(request)
            return role is not None and role in allowed

    RoleRequired.__name__ = f"RoleRequired({', '.join(sorted(allowed))})"
    return RoleRequired


NO_ACCESS = "You do not have access to this area"  # Node: can(...)


def _user(request: Request) -> Any:
    return getattr(request, "user", None) if _user_role(request) is not None else None


def permission_required(*permissions: Permission) -> type[BasePermission]:
    """
    An admin permission, checked against the person's effective permissions (role preset or
    their custom list; the super admin has every one). With several, any one of them is enough.
    Anonymous → 401, missing → 403.
    """
    wanted = tuple(permissions)

    class PermissionRequired(IsSignedIn):
        message = NO_ACCESS

        def has_permission(self, request: Request, view: Any) -> bool:
            user = _user(request)
            return any(has_permission(user, p) for p in wanted)

    PermissionRequired.__name__ = f"PermissionRequired({' | '.join(wanted)})"
    return PermissionRequired
