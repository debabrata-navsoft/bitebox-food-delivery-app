"""Admin: the distance rules (riders to the restaurant, restaurants to the customer)."""

from drf_spectacular.utils import extend_schema, inline_serializer
from rest_framework import serializers
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.authentication import current_user
from apps.audit.services import audited
from apps.rbac.roles import Permission
from common.api import ok
from common.http import PublicCacheMixin
from common.permissions import PUBLIC, permission_required
from common.schema import envelope, errors
from common.validation import validated

from . import tunables


def _km(label: str) -> serializers.IntegerField:
    return serializers.IntegerField(
        required=False,
        min_value=tunables.MIN_PICKUP_KM,
        max_value=tunables.MAX_PICKUP_KM,
        error_messages={
            "min_value": f"Enter at least {tunables.MIN_PICKUP_KM} km",
            "max_value": f"Enter at most {tunables.MAX_PICKUP_KM} km",
            "invalid": f"Enter the {label} in whole km",
        },
    )


class DispatchSettingsInput(serializers.Serializer):
    """Either distance or both (1-50 km)."""

    max_pickup_distance_km = _km("pickup distance")
    max_delivery_distance_km = _km("delivery range")

    def validate(self, attrs: dict[str, int]) -> dict[str, int]:
        if not attrs:
            raise serializers.ValidationError("Give a distance to change")
        return attrs


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
                    "maxDeliveryDistanceKm": serializers.IntegerField(),
                    "defaultMaxDeliveryDistanceKm": serializers.IntegerField(),
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
        lambda r: "; ".join(
            f"{label} {r.data[key]} km"
            for key, label in (
                ("maxPickupDistanceKm", "Rider pickup distance"),
                ("maxDeliveryDistanceKm", "Customer delivery range"),
            )
            if key in r.data
        ),
    )
    def put(self, request: Request) -> Response:
        data = validated(DispatchSettingsInput, request.data)
        saved = tunables.update(current_user(request), data)
        return ok({"settings": saved}, message="Dispatch settings saved")


class DeliveryRangeView(PublicCacheMixin, APIView):
    """Public: how far restaurants deliver (maps draw it as a circle around a pin)."""

    permission_classes = PUBLIC

    @extend_schema(
        tags=["Catalogue"],
        operation_id="delivery_range",
        responses={
            200: envelope(
                "DeliveryRangeResult",
                inline_serializer(
                    "DeliveryRange", {"maxDeliveryDistanceKm": serializers.IntegerField()}
                ),
            )
        },
    )
    def get(self, request: Request) -> Response:
        return ok({"max_delivery_distance_km": tunables.max_delivery_km()})
