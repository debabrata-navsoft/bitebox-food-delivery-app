"""/my/restaurant/reviews/*: the restaurant panel's reviews page (Node: my-restaurant.routes)."""

from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import serializers
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.authentication import current_user
from apps.accounts.serializers import JoinedListQuery
from apps.rbac.roles import Role
from common.api import ok
from common.fields import QueryBoolean, UUIDRef
from common.filters import (
    FacetQuery,
    MultiIdField,
    facets_page,
    list_params,
    multi_choice,
    multi_param,
)
from common.pagination import Page
from common.permissions import role_required
from common.schema import envelope, errors
from common.validation import parse_id, validated

from . import services
from .models import RESPONSE_MAX, ReviewTarget
from .serializers import RATINGS, SORTS, WITH_OR_WITHOUT, choice_query

PARTNER = [role_required(Role.RESTAURANT)]
RESULT = envelope("RestaurantReviewsResult")
TARGETS = [ReviewTarget.RESTAURANT, ReviewTarget.FOOD]
ORDER_PAGE = facets_page("RestaurantReviewOrderPage", services.RESTAURANT_FACETS)


class RestaurantReviewQuery(FacetQuery, JoinedListQuery):
    """GET /my/restaurant/reviews/orders (the older single filters still work)."""

    target = multi_choice(TARGETS)
    rating = multi_choice(RATINGS)
    reply = multi_choice(services.REPLY_STATES)
    photos = multi_choice(WITH_OR_WITHOUT)
    dish = MultiIdField()
    food_item_id = UUIDRef(message="Invalid value", required=False)  # one dish (older links)
    responded = QueryBoolean()  # true: replied; false: needs a reply (older form of `reply`)
    sort = choice_query(SORTS)
    day_range = "created"


class ResponseInput(serializers.Serializer):
    text = serializers.CharField(
        min_length=2,
        max_length=RESPONSE_MAX,
        trim_whitespace=True,
        error_messages={
            **dict.fromkeys(("required", "null", "invalid"), "Write a reply"),
            **dict.fromkeys(
                ("blank", "min_length", "max_length"),
                f"The reply must be 2 to {RESPONSE_MAX} characters",
            ),
        },
    )


class ReviewOrdersView(APIView):
    permission_classes = PARTNER

    @extend_schema(
        tags=["My restaurant"],
        parameters=list_params(
            "Order number, dish or words of the review",
            multi_param("target", TARGETS, "What the review is about"),
            multi_param("rating", RATINGS, "Stars"),
            multi_param("reply", services.REPLY_STATES, "needed: not replied to yet"),
            multi_param("photos", WITH_OR_WITHOUT, "Reviews with or without photos"),
            multi_param("dish", description="Dish ids (this restaurant's)"),
            OpenApiParameter("foodItemId", str, description="One dish (older form of `dish`)"),
            OpenApiParameter(
                "responded", bool, description="Older form of `reply`: true replied, false needed"
            ),
            OpenApiParameter("sort", str, enum=SORTS),
            days="created",
        ),
        responses={200: ORDER_PAGE, **errors(401, 403, 404, 422)},
    )
    def get(self, request: Request) -> Response:
        query = validated(RestaurantReviewQuery, request.query_params)
        page = Page.from_query(query, default_limit=10)
        return ok(services.restaurant_orders(current_user(request), query, page))


class ReviewOrderView(APIView):
    permission_classes = PARTNER

    @extend_schema(
        tags=["My restaurant"],
        operation_id="my_restaurant_review_order_get",
        responses={200: RESULT, **errors(401, 403, 404, 422)},
    )
    def get(self, request: Request, order_id: str) -> Response:
        oid = parse_id(order_id, "orderId")
        return ok(services.restaurant_order(current_user(request), oid))


class ReviewSummaryView(APIView):
    permission_classes = PARTNER

    @extend_schema(tags=["My restaurant"], responses={200: RESULT, **errors(401, 403, 404)})
    def get(self, request: Request) -> Response:
        return ok(services.restaurant_summary(current_user(request)))


class ReviewResponseView(APIView):
    permission_classes = PARTNER

    @extend_schema(
        tags=["My restaurant"],
        request=ResponseInput,
        responses={200: RESULT, **errors(401, 403, 404, 422)},
    )
    def put(self, request: Request, id: str) -> Response:
        review_id = parse_id(id)
        data = validated(ResponseInput, request.data)
        review = services.respond(current_user(request), review_id, data["text"])
        return ok({"review": review}, message="Reply posted")

    @extend_schema(tags=["My restaurant"], responses={200: RESULT, **errors(401, 403, 404, 422)})
    def delete(self, request: Request, id: str) -> Response:
        review = services.delete_response(current_user(request), parse_id(id))
        return ok({"review": review}, message="Reply removed")
