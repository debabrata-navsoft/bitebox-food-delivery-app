"""
/api/v1/admin/delivery-partner-accounts (Account management phase 4; Node:
routes/admin-rider-accounts.routes.js). Viewing needs riders:view, editing riders:edit, the
verification decision riders:approve and taking a rider offline riders:status. The id is the
rider's user id.
"""

from typing import Any

from drf_spectacular.utils import OpenApiParameter, extend_schema, inline_serializer
from rest_framework import serializers
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.authentication import current_user
from apps.accounts.models import USER_STATUS_VALUES
from apps.accounts.serializers import (
    PHONE_MESSAGE,
    JoinedListQuery,
    MemberUpdateInput,
    NameField,
    PhoneField,
    ReasonInput,
    clean_reason,
    day_field,
    optional_choice,
)
from apps.audit.models import AccountType
from apps.audit.services import audited, note
from apps.kyc.models import ACCOUNT_KYC_STATES
from apps.rbac.roles import Permission
from common.api import ok
from common.pagination import Page
from common.permissions import permission_required
from common.schema import envelope, errors, pagination
from common.validation import PageQuery, parse_id, validated

from . import accounts
from .models import AvailabilitySource, VehicleType, VerificationStatus
from .views import RiderDetailsInput, VehicleInput

P = Permission
V = VerificationStatus
TAGS = ["Admin: delivery partner accounts"]
SORT_VALUES = list(accounts.SORTS)


# --- input ----------------------------------------------------------------------------------------
class RiderAccountListQuery(JoinedListQuery):
    """GET /admin/delivery-partner-accounts."""

    account_status = optional_choice(USER_STATUS_VALUES)
    verification = optional_choice(V.values)
    availability = optional_choice(list(accounts.AVAILABILITY_VALUES))
    kyc = optional_choice(ACCOUNT_KYC_STATES)
    zone = serializers.CharField(required=False, allow_blank=True, max_length=60)
    vehicle_type = optional_choice(VehicleType.values)
    joined_from = day_field()
    joined_to = day_field()
    sort = optional_choice(SORT_VALUES)


class EmergencyContactInput(serializers.Serializer):
    name = NameField()
    phone = PhoneField(
        required=True,
        allow_blank=False,
        allow_null=False,
        error_messages=dict.fromkeys(("required", "null", "blank"), PHONE_MESSAGE),
    )
    relation = serializers.CharField(
        max_length=40,
        required=False,
        allow_blank=True,
        allow_null=True,
        error_messages={"max_length": "Relation must be at most 40 characters"},
    )


class RiderAccountInput(MemberUpdateInput, RiderDetailsInput, VehicleInput):
    """
    PATCH /admin/delivery-partner-accounts/:id, every field optional: the member edit's user
    fields, the rider's own address and vehicle rules, the emergency contact (null clears it) and
    the zone (null or "" clears it). Email, phone, password, status and role are dropped.
    """

    emergency_contact = EmergencyContactInput(required=False, allow_null=True)
    zone = serializers.CharField(
        max_length=60,
        required=False,
        allow_blank=True,
        allow_null=True,
        error_messages={"max_length": "Zone must be at most 60 characters"},
    )

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        for name in ("address", "vehicle_type"):  # required on the rider's own forms
            self.fields[name].required = False


class RiderVerificationInput(ReasonInput):
    """Approve, reject or ask for documents; rejecting and asking need a reason (3-500)."""

    status = serializers.ChoiceField(
        choices=[V.APPROVED, V.REJECTED, V.RESUBMISSION_REQUESTED],
        error_messages={"invalid_choice": "Invalid status", "required": "Invalid status"},
    )

    def validate(self, attrs: dict[str, Any]) -> dict[str, Any]:
        attrs["reason"] = clean_reason(attrs, attrs["status"] != V.APPROVED)
        return attrs


class RiderOfflineInput(ReasonInput):
    """Only taking a rider offline (false, with a reason); going online is the rider's own."""

    is_online = serializers.BooleanField(
        error_messages=dict.fromkeys(
            ("invalid", "required", "null"), "isOnline must be true or false"
        )
    )

    def validate_is_online(self, value: bool) -> bool:
        if value:
            raise serializers.ValidationError("Only the rider can go online")
        return value

    def validate(self, attrs: dict[str, Any]) -> dict[str, Any]:
        attrs["reason"] = clean_reason(attrs, True)
        return attrs


# --- schema ---------------------------------------------------------------------------------------
PAGINATION = pagination("RiderAccountPagination")
RATING = inline_serializer(
    name="RiderAccountRating",
    fields={"average": serializers.FloatField(), "count": serializers.IntegerField()},
)
LIST_ITEM = inline_serializer(
    name="RiderAccountItem",
    fields={
        "id": serializers.UUIDField(),
        "name": serializers.CharField(),
        "email": serializers.EmailField(),
        "phone": serializers.CharField(allow_null=True),
        "avatar_url": serializers.URLField(allow_null=True),
        "status": serializers.ChoiceField(choices=USER_STATUS_VALUES),
        "status_reason": serializers.CharField(allow_null=True),
        "created_at": serializers.DateTimeField(),
        "verification_status": serializers.ChoiceField(choices=V.values),
        "is_online": serializers.BooleanField(),
        "busy": serializers.BooleanField(),
        "vehicle_type": serializers.ChoiceField(choices=VehicleType.values, allow_null=True),
        "vehicle_number": serializers.CharField(allow_null=True),
        "zone": serializers.CharField(allow_null=True),
        "completed_deliveries": serializers.IntegerField(),
        "rating": RATING,
        "kyc_status": serializers.ChoiceField(choices=ACCOUNT_KYC_STATES),
    },
    many=True,
)
ACCOUNT_PAGE = envelope(
    "RiderAccountPage",
    inline_serializer(
        name="RiderAccountPageData", fields={"items": LIST_ITEM, "pagination": PAGINATION}
    ),
)
ZONES = envelope(
    "RiderAccountZones",
    inline_serializer(
        name="RiderAccountZonesData",
        fields={"zones": serializers.ListField(child=serializers.CharField())},
    ),
)
DETAIL = envelope(
    "RiderAccountDetail",
    inline_serializer(
        name="RiderAccountDetailData",
        fields={
            "user": serializers.DictField(),
            "rider": serializers.DictField(),
            "stats": inline_serializer(
                name="RiderAccountStats",
                fields={
                    "deliveries": serializers.IntegerField(),
                    "cancelled": serializers.IntegerField(),
                    "earnings_paise": serializers.IntegerField(),
                    "last_delivery_at": serializers.DateTimeField(allow_null=True),
                    "rating": RATING,
                },
            ),
            "kyc": inline_serializer(
                name="RiderAccountKyc",
                fields={
                    "status": serializers.ChoiceField(choices=ACCOUNT_KYC_STATES),
                    "missing": serializers.ListField(child=serializers.CharField()),
                },
            ),
        },
    ),
)
HISTORY = envelope(
    "RiderAvailabilityHistory",
    inline_serializer(
        name="RiderAvailabilityHistoryData",
        fields={
            "items": inline_serializer(
                name="RiderAvailabilityEntry",
                fields={
                    "is_online": serializers.BooleanField(),
                    "at": serializers.DateTimeField(),
                    "source": serializers.ChoiceField(choices=AvailabilitySource.values),
                    "reason": serializers.CharField(allow_null=True),
                },
                many=True,
            ),
            "pagination": PAGINATION,
        },
    ),
)


def _audit(request: Request, changes: dict[str, Any], reason: str | None = None) -> None:
    note(request, changes, reason=reason, account_type=AccountType.DELIVERY)


# --- views ----------------------------------------------------------------------------------------
class RiderAccountsView(APIView):
    permission_classes = [permission_required(P.RIDERS_VIEW)]

    @extend_schema(
        tags=TAGS,
        operation_id="admin_rider_accounts_list",
        parameters=[
            OpenApiParameter("page", int),
            OpenApiParameter("limit", int),
            OpenApiParameter(
                "search",
                str,
                description="Name, email, phone, vehicle number, the rider id or its last 6+",
            ),
            OpenApiParameter("accountStatus", str, enum=USER_STATUS_VALUES),
            OpenApiParameter("verification", str, enum=V.values),
            OpenApiParameter(
                "availability",
                str,
                enum=list(accounts.AVAILABILITY_VALUES),
                description="online: online and free; busy: online with an order; offline",
            ),
            OpenApiParameter("kyc", str, enum=ACCOUNT_KYC_STATES),
            OpenApiParameter("zone", str, description="Exact, any letter case"),
            OpenApiParameter("vehicleType", str, enum=VehicleType.values),
            OpenApiParameter("joinedFrom", str, description="YYYY-MM-DD (report time zone)"),
            OpenApiParameter("joinedTo", str, description="YYYY-MM-DD, inclusive"),
            OpenApiParameter("sort", str, enum=SORT_VALUES),
        ],
        responses={200: ACCOUNT_PAGE, **errors(401, 403, 422)},
    )
    def get(self, request: Request) -> Response:
        query = validated(RiderAccountListQuery, request.query_params)
        return ok(accounts.list_accounts(query, Page.from_query(query)))


class RiderAccountZonesView(APIView):
    permission_classes = [permission_required(P.RIDERS_VIEW)]

    @extend_schema(
        tags=TAGS,
        operation_id="admin_rider_accounts_zones",
        responses={200: ZONES, **errors(401, 403)},
    )
    def get(self, request: Request) -> Response:
        return ok({"zones": accounts.zones()})


class RiderAccountView(APIView):
    def get_permissions(self) -> list[Any]:
        wanted = P.RIDERS_VIEW if self.request.method == "GET" else P.RIDERS_EDIT
        return [permission_required(wanted)()]

    @extend_schema(
        tags=TAGS,
        operation_id="admin_rider_accounts_detail",
        responses={200: DETAIL, **errors(401, 403, 404, 422)},
    )
    def get(self, request: Request, id: str) -> Response:
        return ok(accounts.detail(accounts.get(parse_id(id))))

    @extend_schema(
        tags=TAGS,
        operation_id="admin_rider_accounts_update",
        request=RiderAccountInput,
        responses={200: DETAIL, **errors(401, 403, 404, 422)},
    )
    @audited("rider.update", "user", lambda r: "Updated delivery partner details")
    def patch(self, request: Request, id: str) -> Response:
        user = accounts.get(parse_id(id))
        data = validated(RiderAccountInput, request.data)
        changes = accounts.update(user, data)
        _audit(request, changes)
        return ok(accounts.detail(user), message="Delivery partner updated")


class RiderAccountVerificationView(APIView):
    permission_classes = [permission_required(P.RIDERS_APPROVE)]

    @extend_schema(
        tags=TAGS,
        operation_id="admin_rider_accounts_verification",
        request=RiderVerificationInput,
        responses={200: DETAIL, **errors(400, 401, 403, 404, 409, 422)},
    )
    @audited(
        "rider.verification",
        "user",
        lambda r: f"Set delivery partner verification to {r.data.get('status')}",
    )
    def patch(self, request: Request, id: str) -> Response:
        user_id = parse_id(id)
        data = validated(RiderVerificationInput, request.data)
        user, changes, message = accounts.set_verification(
            current_user(request), user_id, data["status"], data["reason"]
        )
        _audit(request, changes, data["reason"])
        return ok(accounts.detail(user), message=message)


class RiderAccountAvailabilityView(APIView):
    def get_permissions(self) -> list[Any]:
        wanted = P.RIDERS_VIEW if self.request.method == "GET" else P.RIDERS_STATUS
        return [permission_required(wanted)()]

    @extend_schema(
        tags=TAGS,
        operation_id="admin_rider_accounts_availability_history",
        parameters=[
            OpenApiParameter("page", int),
            OpenApiParameter("limit", int),
        ],
        responses={200: HISTORY, **errors(401, 403, 404, 422)},
    )
    def get(self, request: Request, id: str) -> Response:
        user = accounts.get(parse_id(id))
        query = validated(PageQuery, request.query_params)
        return ok(accounts.availability_history(user, Page.from_query(query)))

    @extend_schema(
        tags=TAGS,
        operation_id="admin_rider_accounts_take_offline",
        request=RiderOfflineInput,
        responses={200: DETAIL, **errors(401, 403, 404, 409, 422)},
    )
    @audited("rider.availability", "user", lambda r: "Took the delivery partner offline")
    def patch(self, request: Request, id: str) -> Response:
        user = accounts.get(parse_id(id))
        data = validated(RiderOfflineInput, request.data)
        changes = accounts.take_offline(user, data["reason"])
        _audit(request, changes, data["reason"])
        return ok(accounts.detail(user), message="Delivery partner taken offline")
