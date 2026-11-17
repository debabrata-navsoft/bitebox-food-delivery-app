"""
/api/v1/admin/users, /admin/admins and /admin/audit-logs (Node: routes/admin-users.routes.js,
routes/admin-staff.routes.js). Each needs an admin permission, never just a role.

/admin/users checks per kind of member: the route needs any of the matching keys (e.g. any
`<kind>:view`), then the service checks the key for the target's kind (customers / restaurants /
riders) and answers 403 when the admin lacks it.
"""

from typing import Any

from drf_spectacular.utils import OpenApiParameter, extend_schema, inline_serializer
from rest_framework import serializers
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.audit.models import AccountType
from apps.audit.services import (
    AUDIT_ACCOUNT_TYPES,
    AUDIT_FACETS,
    account_type_of,
    audited,
    list_entries,
    note,
)
from apps.customers import services as addresses
from apps.customers.views import SavedAddressInput
from apps.rbac.roles import (
    ADMIN_ROLE_VALUES,
    ADMIN_ROLES,
    MEMBER_ROLES,
    ROLE_LABEL,
    Permission,
    Role,
    permission_catalogue,
)
from common.api import ok
from common.filters import (
    FACETS_PARAM,
    FacetQuery,
    MultiValueField,
    day_params,
    facets_page,
    multi_choice,
    multi_param,
    page_params,
)
from common.pagination import Page
from common.permissions import permission_required
from common.schema import envelope, errors, pagination
from common.validation import PageQuery, parse_id, validated

from . import admin_services as admin
from .authentication import current_user
from .models import USER_STATUS_VALUES, User, UserStatus
from .serializers import (
    CUSTOMER_SORT_VALUES,
    VERIFICATION_VALUES,
    CustomerListQuery,
    MemberUpdateInput,
    StaffCreateInput,
    StaffListQuery,
    StaffUpdateInput,
    StatusInput,
    UserListQuery,
    UserOut,
    user_json,
)

PAGINATION = pagination("Pagination")
USER_PAGE = envelope(
    "UserPage",
    inline_serializer(
        name="UserPageData", fields={"items": UserOut(many=True), "pagination": PAGINATION}
    ),
)
STAFF_PAGE = facets_page(
    "StaffPage", admin.STAFF_FACETS, items=UserOut(many=True), paging=PAGINATION
)
USER = envelope(
    "AdminUserResponse", inline_serializer(name="AdminUserData", fields={"user": UserOut()})
)
LIST_PARAMS = [
    OpenApiParameter("page", int),
    OpenApiParameter("limit", int),
    OpenApiParameter("search", str),
    OpenApiParameter("role", str),
    OpenApiParameter("status", str, enum=USER_STATUS_VALUES),
]
P = Permission
ANY_VIEW = [permission_required(P.CUSTOMERS_VIEW, P.RESTAURANTS_VIEW, P.RIDERS_VIEW)]
ANY_EDIT = [permission_required(P.CUSTOMERS_EDIT, P.RESTAURANTS_EDIT, P.RIDERS_EDIT)]
ANY_STATUS = [
    permission_required(
        P.CUSTOMERS_STATUS, P.RESTAURANTS_STATUS, P.RIDERS_STATUS, P.ACCOUNTS_SUSPEND
    )
]


def _list_query(request: Request, roles: tuple[Role, ...]) -> tuple[dict[str, Any], Page]:
    query = validated(UserListQuery, request.query_params, roles=roles)
    return query, Page.from_query(query)


def _audit(request: Request, changes: dict[str, Any], target: User) -> None:
    """The entry records the changes even when there are none (an edit that changed nothing)."""
    note(request, changes, account_type=account_type_of(target.role), skip_unchanged=False)


class MembersView(APIView):
    """Customers, restaurant partners and riders: only the kinds the admin may view."""

    permission_classes = ANY_VIEW

    @extend_schema(
        tags=["Admin: users"],
        parameters=LIST_PARAMS,
        responses={200: USER_PAGE, **errors(401, 403, 422)},
    )
    def get(self, request: Request) -> Response:
        query, page = _list_query(request, MEMBER_ROLES)
        return ok(admin.list_members(current_user(request), query, page))


def status_changed(
    request: Request, user_id: Any, status: str, reason: str | None, roles: tuple[Role, ...]
) -> User:
    """Sets the status and fills in the audit entry (none for a no-op)."""
    user, changes = admin.set_account_status(current_user(request), user_id, status, reason, roles)
    note(request, changes, reason=reason, account_type=account_type_of(user.role))
    return user


class MemberStatusView(APIView):
    """
    active / inactive need `<kind>:status`; suspended / blocked need accounts:suspend. Any status
    but active needs a reason and signs the person out everywhere.
    """

    permission_classes = ANY_STATUS

    @extend_schema(
        tags=["Admin: users"],
        request=StatusInput,
        responses={200: USER, **errors(400, 401, 403, 404, 409, 422)},
    )
    @audited("user.status", "user", lambda r: f"Set account status to {r.data.get('status')}")
    def patch(self, request: Request, id: str) -> Response:
        user_id = parse_id(id)
        data = validated(StatusInput, request.data)
        status = data["status"]
        user = status_changed(request, user_id, status, data["reason"], MEMBER_ROLES)
        return ok(
            {"user": user_json(user)},
            message=f"User {admin.STATUS_MESSAGES[UserStatus(status)]}",
        )


MEMBER_DETAIL = envelope(
    "AdminMemberDetail",
    inline_serializer(
        name="AdminMemberDetailData",
        fields={
            "user": UserOut(),
            "addresses": serializers.ListField(child=serializers.DictField()),
            "stats": inline_serializer(
                name="AdminMemberStats",
                fields={
                    "orders": serializers.IntegerField(),
                    "delivered": serializers.IntegerField(),
                    "cancelled": serializers.IntegerField(),
                    "spent_paise": serializers.IntegerField(),
                    "last_order_at": serializers.DateTimeField(allow_null=True),
                },
            ),
            "restaurant": inline_serializer(
                name="AdminMemberRestaurant",
                fields={
                    "id": serializers.UUIDField(),
                    "name": serializers.CharField(),
                    "slug": serializers.CharField(),
                    "status": serializers.CharField(),
                },
                allow_null=True,
            ),
        },
    ),
)
ADDRESS = envelope("AdminMemberAddress")


class MemberDetailView(APIView):
    """One customer, restaurant partner or rider: view (`<kind>:view`) and correct their details
    (`<kind>:edit`)."""

    def get_permissions(self) -> list[Any]:
        guard = ANY_VIEW if self.request.method == "GET" else ANY_EDIT
        return [p() for p in guard]

    @extend_schema(
        tags=["Admin: users"],
        operation_id="admin_users_detail",
        responses={200: MEMBER_DETAIL, **errors(401, 403, 404, 422)},
    )
    def get(self, request: Request, id: str) -> Response:
        user = admin.get_member_for(current_user(request), parse_id(id), "view")
        return ok(admin.member_detail(user))

    @extend_schema(
        tags=["Admin: users"],
        operation_id="admin_users_update",
        request=MemberUpdateInput,
        responses={200: USER, **errors(401, 403, 404, 409, 422)},
    )
    @audited("user.update", "user", lambda r: "Updated user details")
    def patch(self, request: Request, id: str) -> Response:
        target = admin.get_member_for(current_user(request), parse_id(id), "edit")
        data = validated(MemberUpdateInput, request.data, partial=True)
        user, changes = admin.update_member(target, data)
        _audit(request, changes, user)
        return ok({"user": user_json(user)}, message="User updated")


class MemberAddressesView(APIView):
    """A customer's saved addresses, managed by support (same rules as /addresses)."""

    permission_classes = ANY_EDIT

    @extend_schema(
        tags=["Admin: users"],
        operation_id="admin_users_addresses_create",
        request=SavedAddressInput,
        responses={201: ADDRESS, **errors(400, 401, 403, 404, 409, 422)},
    )
    @audited("user.address.create", "user", lambda r: "Added a saved address")
    def post(self, request: Request, id: str) -> Response:
        customer = admin.get_customer(current_user(request), parse_id(id))
        address = addresses.create(customer, validated(SavedAddressInput, request.data))
        return ok({"address": addresses.address_json(address)}, message="Address saved", status=201)


class MemberAddressView(APIView):
    permission_classes = ANY_EDIT

    @extend_schema(
        tags=["Admin: users"],
        operation_id="admin_users_addresses_update",
        request=SavedAddressInput,
        responses={200: ADDRESS, **errors(400, 401, 403, 404, 422)},
    )
    @audited("user.address.update", "user", lambda r: "Updated a saved address")
    def patch(self, request: Request, id: str, address_id: str) -> Response:
        customer = admin.get_customer(current_user(request), parse_id(id))
        address_pk = parse_id(address_id, "addressId")
        data = validated(SavedAddressInput, request.data, partial=True)
        address = addresses.update(customer, address_pk, data)
        return ok({"address": addresses.address_json(address)}, message="Address updated")

    @extend_schema(
        tags=["Admin: users"],
        operation_id="admin_users_addresses_delete",
        responses={200: ADDRESS, **errors(400, 401, 403, 404, 422)},
    )
    @audited("user.address.delete", "user", lambda r: "Deleted a saved address")
    def delete(self, request: Request, id: str, address_id: str) -> Response:
        customer = admin.get_customer(current_user(request), parse_id(id))
        addresses.remove(customer, parse_id(address_id, "addressId"))
        return ok(None, message="Address deleted")


class MemberDefaultAddressView(APIView):
    permission_classes = ANY_EDIT

    @extend_schema(
        tags=["Admin: users"],
        operation_id="admin_users_addresses_default",
        request=None,
        responses={200: ADDRESS, **errors(400, 401, 403, 404, 422)},
    )
    @audited("user.address.default", "user", lambda r: "Changed the default address")
    def patch(self, request: Request, id: str, address_id: str) -> Response:
        customer = admin.get_customer(current_user(request), parse_id(id))
        address = addresses.set_default(customer, parse_id(address_id, "addressId"))
        return ok({"address": addresses.address_json(address)}, message="Default address updated")


# --- customers (Account management phase 2) -----------------------------------------------------
class CustomerListStats(serializers.Serializer):
    orders = serializers.IntegerField()
    spent_paise = serializers.IntegerField()
    last_order_at = serializers.DateTimeField(allow_null=True)


class CustomerListItem(UserOut):
    """The user JSON plus order totals."""

    stats = CustomerListStats()


CUSTOMER_PAGE = facets_page(
    "CustomerPage", admin.CUSTOMER_FACETS, items=CustomerListItem(many=True), paging=PAGINATION
)
NO_DATA = envelope("CustomerHelpSent")


class CustomersView(APIView):
    """Customers with their order totals (customers:view)."""

    permission_classes = [permission_required(P.CUSTOMERS_VIEW)]

    @extend_schema(
        tags=["Admin: customers"],
        operation_id="admin_customers_list",
        parameters=[
            *page_params("Name, email, phone, the id or its last 6+ characters"),
            multi_param("status", USER_STATUS_VALUES),
            multi_param("verification", VERIFICATION_VALUES),
            *day_params("joined"),
            OpenApiParameter("sort", str, enum=CUSTOMER_SORT_VALUES),
            FACETS_PARAM,
        ],
        responses={200: CUSTOMER_PAGE, **errors(401, 403, 422)},
    )
    def get(self, request: Request) -> Response:
        query = validated(CustomerListQuery, request.query_params)
        return ok(admin.list_customers(query, Page.from_query(query)))


def _help_target(request: Request, id: str) -> User:
    user = admin.get_customer_account(parse_id(id))
    request.audit_account_type = AccountType.CUSTOMER  # type: ignore[attr-defined]
    return user


class CustomerPasswordResetView(APIView):
    """Emails the customer the forgot-password link; the admin never sees or sets a password."""

    permission_classes = [permission_required(P.CUSTOMERS_EDIT)]

    @extend_schema(
        tags=["Admin: customers"],
        operation_id="admin_customers_password_reset",
        request=None,
        responses={200: NO_DATA, **errors(401, 403, 404, 409, 422, 429)},
    )
    @audited("customer.password_reset", "user", lambda r: "Sent a password reset link")
    def post(self, request: Request, id: str) -> Response:
        admin.send_customer_password_reset(_help_target(request, id))
        return ok(None, message="Password reset link sent")


class CustomerEmailVerificationView(APIView):
    """(Re)sends the email verification link."""

    permission_classes = [permission_required(P.CUSTOMERS_EDIT)]

    @extend_schema(
        tags=["Admin: customers"],
        operation_id="admin_customers_email_verification",
        request=None,
        responses={200: NO_DATA, **errors(401, 403, 404, 409, 422, 429)},
    )
    @audited("customer.email_verification", "user", lambda r: "Sent an email verification link")
    def post(self, request: Request, id: str) -> Response:
        admin.send_customer_email_verification(_help_target(request, id))
        return ok(None, message="Verification email sent")


def _role_label(value: object) -> str:
    try:
        return ROLE_LABEL[Role(str(value))]
    except ValueError:
        return str(value)


def _staff_update_description(request: Request) -> str:
    role = request.data.get("role")
    return f"Updated admin; role set to {_role_label(role)}" if role else "Updated admin details"


class StaffListView(APIView):
    permission_classes = [permission_required(Permission.ADMINS_MANAGE)]

    @extend_schema(
        tags=["Admin: staff"],
        operation_id="admin_admins_list",
        parameters=[
            *page_params(),
            multi_param("role", ADMIN_ROLE_VALUES),
            multi_param("status", USER_STATUS_VALUES),
            FACETS_PARAM,
        ],
        responses={200: STAFF_PAGE, **errors(401, 403, 422)},
    )
    def get(self, request: Request) -> Response:
        query = validated(StaffListQuery, request.query_params)
        return ok(admin.list_staff(query, Page.from_query(query)))

    @extend_schema(
        tags=["Admin: staff"],
        request=StaffCreateInput,
        responses={201: USER, **errors(401, 403, 409, 422)},
    )
    @audited(
        "admin.create",
        "user",
        lambda r: f"Created {_role_label(r.data.get('role'))} {r.data.get('email')}",
    )
    def post(self, request: Request) -> Response:
        user, changes = admin.create_staff(validated(StaffCreateInput, request.data))
        request.audit_resource_id = user.pk  # type: ignore[attr-defined]
        _audit(request, changes, user)
        return ok({"user": user_json(user)}, message="Admin created", status=201)


PERMISSION_CATALOGUE = envelope(
    "PermissionCatalogue",
    inline_serializer(
        name="PermissionCatalogueData",
        fields={
            "permissions": inline_serializer(
                name="PermissionInfo",
                fields={
                    "key": serializers.CharField(),
                    "label": serializers.CharField(),
                    "group": serializers.CharField(),
                },
                many=True,
            ),
            "presets": inline_serializer(
                name="PermissionPreset",
                fields={
                    "key": serializers.CharField(),
                    "label": serializers.CharField(),
                    "permissions": serializers.ListField(child=serializers.CharField()),
                },
                many=True,
            ),
        },
    ),
)


class StaffPermissionsView(APIView):
    """Every permission (with a label and group) and the editor's presets."""

    permission_classes = [permission_required(Permission.ADMINS_MANAGE)]

    @extend_schema(
        tags=["Admin: staff"],
        operation_id="admin_admins_permissions",
        responses={200: PERMISSION_CATALOGUE, **errors(401, 403)},
    )
    def get(self, request: Request) -> Response:
        return ok(permission_catalogue())


class StaffDetailView(APIView):
    permission_classes = [permission_required(Permission.ADMINS_MANAGE)]

    @extend_schema(
        tags=["Admin: staff"],
        operation_id="admin_admins_detail",
        responses={200: USER, **errors(401, 403, 404, 422)},
    )
    def get(self, request: Request, id: str) -> Response:
        return ok({"user": user_json(admin.get_staff(parse_id(id)))})

    @extend_schema(
        tags=["Admin: staff"],
        request=StaffUpdateInput,
        responses={200: USER, **errors(400, 401, 403, 404, 409, 422)},
    )
    @audited("admin.update", "user", _staff_update_description)
    def patch(self, request: Request, id: str) -> Response:
        data = validated(StaffUpdateInput, request.data, partial=True)
        user, changes = admin.update_staff(current_user(request), parse_id(id), data)
        _audit(request, changes, user)
        return ok({"user": user_json(user)}, message="Admin updated")


class StaffStatusView(APIView):
    permission_classes = [permission_required(Permission.ADMINS_MANAGE)]

    @extend_schema(
        tags=["Admin: staff"],
        request=StatusInput,
        responses={200: USER, **errors(400, 401, 403, 404, 422)},
    )
    @audited(
        "admin.status",
        "user",
        lambda r: "Activated admin" if r.data.get("status") == "active" else "Deactivated admin",
    )
    def patch(self, request: Request, id: str) -> Response:
        user_id = parse_id(id)
        data = validated(StatusInput, request.data)
        status = data["status"]
        user = status_changed(request, user_id, status, data["reason"], ADMIN_ROLES)
        return ok(
            {"user": user_json(user)},
            message="Admin activated" if status == "active" else "Admin deactivated",
        )


class AuditQuery(FacetQuery, PageQuery):
    action = MultiValueField(max_length=60)
    role = multi_choice(ADMIN_ROLE_VALUES)
    account_type = multi_choice(AUDIT_ACCOUNT_TYPES)
    # One id, or up to 5 separated by commas (a restaurant's entries and its owner's).
    resource_id = serializers.CharField(
        required=False,
        max_length=5 * 65,
        error_messages=dict.fromkeys(("max_length",), "Invalid value"),
    )
    to = serializers.DateTimeField(required=False)

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        # "from" is a Python keyword, so it can't be declared as a class attribute.
        self.fields["from"] = serializers.DateTimeField(required=False)

    def validate_resource_id(self, value: str) -> list[str]:
        ids = [v.strip() for v in value.split(",") if v.strip()]
        if not ids or len(ids) > 5 or any(len(v) > 64 for v in ids):
            raise serializers.ValidationError("Invalid value")
        return ids


AUDIT_ENTRY = inline_serializer(
    name="AuditEntry",
    fields={
        "id": serializers.UUIDField(),
        "admin": inline_serializer(
            name="AuditAdmin",
            fields={
                "id": serializers.UUIDField(),
                "name": serializers.CharField(),
                "email": serializers.EmailField(),
            },
            allow_null=True,
        ),
        "admin_role": serializers.CharField(),
        "action": serializers.CharField(),
        "description": serializers.CharField(),
        "resource_type": serializers.CharField(),
        "resource_id": serializers.CharField(),
        "ip": serializers.IPAddressField(allow_null=True),
        "account_type": serializers.CharField(),
        "changes": serializers.DictField(),
        "reason": serializers.CharField(),
        "created_at": serializers.DateTimeField(),
    },
    many=True,
)


class AuditLogView(APIView):
    permission_classes = [permission_required(Permission.AUDIT_VIEW)]

    @extend_schema(
        tags=["Admin: audit"],
        parameters=[
            *page_params(),
            multi_param("action"),
            multi_param("role", ADMIN_ROLE_VALUES),
            multi_param("accountType", AUDIT_ACCOUNT_TYPES),
            OpenApiParameter("resourceId", str, description="One id, or up to 5 comma-separated"),
            OpenApiParameter("from", str),
            OpenApiParameter("to", str),
            FACETS_PARAM,
        ],
        responses={
            200: facets_page("AuditPage", AUDIT_FACETS, items=AUDIT_ENTRY, paging=PAGINATION),
            **errors(401, 403, 422),
        },
    )
    def get(self, request: Request) -> Response:
        query = validated(AuditQuery, request.query_params)
        return ok(list_entries(query, Page.from_query(query)))


class _LoginHistoryView(APIView):
    roles: tuple[Role, ...] = ()

    def check(self, request: Request, user_id: Any) -> None:
        """Extra per-target checks (members: `<kind>:view`)."""

    def get(self, request: Request, id: str) -> Response:
        user_id = parse_id(id)
        self.check(request, user_id)
        query = validated(PageQuery, request.query_params)
        return ok(admin.login_history(user_id, self.roles, Page.from_query(query)))


class MemberLoginsView(_LoginHistoryView):
    """Sign-ins of a customer, restaurant partner or rider."""

    permission_classes = ANY_VIEW
    roles = MEMBER_ROLES

    def check(self, request: Request, user_id: Any) -> None:
        admin.get_member_for(current_user(request), user_id, "view")

    @extend_schema(
        tags=["Admin: users"],
        operation_id="admin_users_logins",
        parameters=[PageQuery],
        responses={200: envelope("LoginHistory"), **errors(401, 403, 404, 422)},
    )
    def get(self, request: Request, id: str) -> Response:
        return super().get(request, id)


class StaffLoginsView(_LoginHistoryView):
    """Sign-ins of a staff admin (admin security: login history)."""

    permission_classes = [permission_required(Permission.ADMINS_MANAGE)]
    roles = ADMIN_ROLES

    @extend_schema(
        tags=["Admin: staff"],
        operation_id="admin_admins_logins",
        parameters=[PageQuery],
        responses={200: envelope("StaffLoginHistory"), **errors(401, 403, 404, 422)},
    )
    def get(self, request: Request, id: str) -> Response:
        return super().get(request, id)
