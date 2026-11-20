"""Admin: the dispatch rules (how far riders may be from the restaurant to get its orders)."""

from drf_spectacular.utils import extend_schema, inline_serializer
from rest_framework import serializers
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.authentication import current_user
from apps.audit.services import audited
from apps.rbac.roles import Permission
from common.api import ok
from common.permissions import permission_required
from common.schema import envelope, errors
from common.validation import validated

from . import tunables


class DispatchSettingsInput(serializers.Serializer):
    max_pickup_distance_km = serializers.IntegerField(
        min_value=tunables.MIN_PICKUP_KM,
        max_value=tunables.MAX_PICKUP_KM,
        error_messages={
            "min_value": f"Enter at least {tunables.MIN_PICKUP_KM} km",
            "max_value": f"Enter at most {tunables.MAX_PICKUP_KM} km",
            "invalid": "Enter a whole number of km",
        },
    )


SETTINGS_RESULT = envelope(
    "DispatchSettingsResult",
    inline_serializer(
        "DispatchSettingsData",
        {
            "settings": inline_serializer(
                "DispatchSettings",
                {
                    "maxPickupDistanceKm": serializers.IntegerField(),
                    "defaultMaxPickupDistanceKm": serializers.IntegerField(),
                    "minPickupDistanceKm": serializers.IntegerField(),
                    "maxAllowedPickupDistanceKm": serializers.IntegerField(),
                    "updatedAt": serializers.DateTimeField(allow_null=True),
                    "updatedBy": serializers.CharField(allow_null=True),
                },
            )
        },
    ),
)


class DispatchSettingsView(APIView):
    permission_classes = [permission_required(Permission.RIDERS_MANAGE)]

    @extend_schema(
        tags=["Admin: dispatch"],
        operation_id="admin_dispatch_settings_get",
        responses={200: SETTINGS_RESULT, **errors(401, 403)},
    )
    def get(self, request: Request) -> Response:
        return ok({"settings": tunables.current()})

    @extend_schema(
        tags=["Admin: dispatch"],
        operation_id="admin_dispatch_settings_update",
        request=DispatchSettingsInput,
        responses={200: SETTINGS_RESULT, **errors(401, 403, 422)},
    )
    @audited(
        "dispatch.configure",
        "dispatch_settings",
        lambda r: f"Set the rider pickup distance to {r.data.get('maxPickupDistanceKm')} km",
    )
    def put(self, request: Request) -> Response:
        data = validated(DispatchSettingsInput, request.data)
        saved = tunables.update(current_user(request), data["max_pickup_distance_km"])
        return ok({"settings": saved}, message="Dispatch settings saved")
