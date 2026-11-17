"""
/api/v1/admin/restaurant-accounts (Account management phase 3; Node:
routes/admin-restaurant-accounts.routes.js). Viewing needs restaurants:view, editing
restaurants:edit, closing for orders restaurants:status; a status change needs restaurants:status
(suspending or lifting a suspension) or restaurants:approve (reviewing), checked per change.
"""

from typing import Any

from drf_spectacular.utils import OpenApiParameter, extend_schema, inline_serializer
from rest_framework import serializers
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.authentication import current_user
from apps.accounts.models import USER_STATUS_VALUES
from apps.audit.models import AccountType
from apps.audit.services import audited, note
from apps.kyc.models import ACCOUNT_KYC_STATES
from apps.rbac.roles import Permission
from common.api import ok
from common.filters import FACETS_PARAM, day_params, facets_page, multi_param, page_params
from common.pagination import Page
from common.permissions import permission_required
from common.schema import envelope, errors, pagination
from common.validation import parse_id, validated

from . import accounts
from .models import RestaurantStatus
from .serializers import (
    ACCOUNT_SORT_VALUES,
    AccountAcceptingOrdersInput,
    AccountListQuery,
    AccountStatusInput,
    RestaurantInput,
)

P = Permission
TAGS = ["Admin: restaurant accounts"]

PAGINATION = pagination("RestaurantAccountPagination")
RATING = inline_serializer(
    name="RestaurantAccountRating",
    fields={"average": serializers.FloatField(), "count": serializers.IntegerField()},
)
OWNER_CARD = inline_serializer(
    name="RestaurantAccountOwner",
    fields={
        "id": serializers.UUIDField(),
        "name": serializers.CharField(),
        "email": serializers.EmailField(),
        "phone": serializers.CharField(allow_null=True),
        "status": serializers.ChoiceField(choices=USER_STATUS_VALUES),
        "avatar_url": serializers.URLField(allow_null=True),
    },
    allow_null=True,
)
LIST_ITEM = inline_serializer(
    name="RestaurantAccountItem",
    fields={
        "id": serializers.UUIDField(),
        "name": serializers.CharField(),
        "slug": serializers.CharField(),
        "image_url": serializers.URLField(allow_null=True),
        "city": serializers.CharField(),
        "status": serializers.ChoiceField(choices=RestaurantStatus.values),
        "status_reason": serializers.CharField(allow_null=True),
        "is_accepting_orders": serializers.BooleanField(),
        "created_at": serializers.DateTimeField(),
        "owner": OWNER_CARD,
        "stats": inline_serializer(
            name="RestaurantAccountItemStats",
            fields={"orders": serializers.IntegerField(), "rating": RATING},
        ),
        "commission_percent": serializers.FloatField(),
        "kyc_status": serializers.ChoiceField(choices=ACCOUNT_KYC_STATES),
    },
    many=True,
)
ACCOUNT_PAGE = facets_page(
    "RestaurantAccountPage", accounts.FACETS, items=LIST_ITEM, paging=PAGINATION
)
CITIES = envelope(
    "RestaurantAccountCities",
    inline_serializer(
        name="RestaurantAccountCitiesData",
        fields={"cities": serializers.ListField(child=serializers.CharField())},
    ),
)
RESTAURANT = envelope(
    "RestaurantAccountRestaurant",
    inline_serializer(
        name="RestaurantAccountRestaurantData", fields={"restaurant": serializers.DictField()}
    ),
)
DETAIL = envelope(
    "RestaurantAccountDetail",
    inline_serializer(
        name="RestaurantAccountDetailData",
        fields={
            "restaurant": serializers.DictField(),
            "owner": serializers.DictField(allow_null=True),
            "stats": inline_serializer(
                name="RestaurantAccountStats",
                fields={
                    "orders": serializers.IntegerField(),
                    "delivered": serializers.IntegerField(),
                    "cancelled": serializers.IntegerField(),
                    "gross_paise": serializers.IntegerField(),
                    "last_order_at": serializers.DateTimeField(allow_null=True),
                    "rating": RATING,
                },
            ),
            "commission": inline_serializer(
                name="RestaurantAccountCommission",
                fields={
                    "percent": serializers.FloatField(),
                    "source": serializers.ChoiceField(choices=["default", "restaurant"]),
                },
            ),
            "kyc": inline_serializer(
                name="RestaurantAccountKyc",
                fields={
                    "status": serializers.ChoiceField(choices=ACCOUNT_KYC_STATES),
                    "missing": serializers.ListField(child=serializers.CharField()),
                },
            ),
        },
    ),
)


def _audit(request: Request, changes: dict[str, Any], reason: str | None = None) -> None:
    note(request, changes, reason=reason, account_type=AccountType.RESTAURANT)


def _restaurant(restaurant: Any, message: str) -> Response:
    return ok({"restaurant": accounts.restaurant_out(restaurant)}, message=message)


class RestaurantAccountsView(APIView):
    permission_classes = [permission_required(P.RESTAURANTS_VIEW)]

    @extend_schema(
        tags=TAGS,
        operation_id="admin_restaurant_accounts_list",
        parameters=[
            *page_params("Name or slug, owner name, email or phone, the id or its last 6+"),
            multi_param("status", RestaurantStatus.values),
            multi_param("accountStatus", USER_STATUS_VALUES),
            multi_param("kyc", ACCOUNT_KYC_STATES),
            multi_param("city", description="Each exact, any letter case"),
            *day_params("joined"),
            OpenApiParameter("sort", str, enum=ACCOUNT_SORT_VALUES),
            FACETS_PARAM,
        ],
        responses={200: ACCOUNT_PAGE, **errors(401, 403, 422)},
    )
    def get(self, request: Request) -> Response:
        query = validated(AccountListQuery, request.query_params)
        return ok(accounts.list_accounts(query, Page.from_query(query)))


class RestaurantAccountCitiesView(APIView):
    permission_classes = [permission_required(P.RESTAURANTS_VIEW)]

    @extend_schema(
        tags=TAGS,
        operation_id="admin_restaurant_accounts_cities",
        responses={200: CITIES, **errors(401, 403)},
    )
    def get(self, request: Request) -> Response:
        return ok({"cities": accounts.cities()})


class RestaurantAccountView(APIView):
    def get_permissions(self) -> list[Any]:
        wanted = P.RESTAURANTS_VIEW if self.request.method == "GET" else P.RESTAURANTS_EDIT
        return [permission_required(wanted)()]

    @extend_schema(
        tags=TAGS,
        operation_id="admin_restaurant_accounts_detail",
        responses={200: DETAIL, **errors(401, 403, 404, 422)},
    )
    def get(self, request: Request, id: str) -> Response:
        return ok(accounts.detail(accounts.get(parse_id(id))))

    @extend_schema(
        tags=TAGS,
        operation_id="admin_restaurant_accounts_update",
        request=RestaurantInput(partial=True),
        responses={200: RESTAURANT, **errors(401, 403, 404, 422)},
    )
    @audited("restaurant.update", "restaurant", lambda r: "Updated restaurant details")
    def patch(self, request: Request, id: str) -> Response:
        restaurant = accounts.get(parse_id(id))
        data = validated(RestaurantInput, request.data, partial=True)
        restaurant, changes = accounts.update(restaurant, data)
        _audit(request, changes)
        return _restaurant(restaurant, "Restaurant updated")


class RestaurantAccountStatusView(APIView):
    # Either key gets in; the service checks the one this change needs.
    permission_classes = [permission_required(P.RESTAURANTS_STATUS, P.RESTAURANTS_APPROVE)]

    @extend_schema(
        tags=TAGS,
        operation_id="admin_restaurant_accounts_status",
        request=AccountStatusInput,
        responses={200: RESTAURANT, **errors(400, 401, 403, 404, 409, 422)},
    )
    @audited(
        "restaurant.status",
        "restaurant",
        lambda r: f"Set restaurant status to {r.data.get('status')}",
    )
    def patch(self, request: Request, id: str) -> Response:
        restaurant_id = parse_id(id)
        data = validated(AccountStatusInput, request.data)
        restaurant, changes, message = accounts.set_status(
            current_user(request), restaurant_id, data["status"], data["reason"]
        )
        _audit(request, changes, data["reason"])
        return _restaurant(restaurant, message)


class RestaurantAccountAcceptingOrdersView(APIView):
    permission_classes = [permission_required(P.RESTAURANTS_STATUS)]

    @extend_schema(
        tags=TAGS,
        operation_id="admin_restaurant_accounts_accepting_orders",
        request=AccountAcceptingOrdersInput,
        responses={200: RESTAURANT, **errors(401, 403, 404, 422)},
    )
    @audited(
        "restaurant.accepting_orders",
        "restaurant",
        lambda r: (
            "Reopened the restaurant for orders"
            if r.data.get("is_accepting_orders") is True
            else "Closed the restaurant for orders"
        ),
    )
    def patch(self, request: Request, id: str) -> Response:
        restaurant = accounts.get(parse_id(id))
        data = validated(AccountAcceptingOrdersInput, request.data)
        accepting = data["is_accepting_orders"]
        changes = accounts.set_accepting_orders(restaurant, accepting)
        _audit(request, changes, data["reason"])
        return _restaurant(
            restaurant,
            "Restaurant open for orders" if accepting else "Restaurant closed for orders",
        )
