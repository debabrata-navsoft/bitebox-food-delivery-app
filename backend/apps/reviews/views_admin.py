"""/admin/reviews: the moderation queue, decisions and rating analytics (Node: review.routes.js)."""

from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import serializers
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.authentication import current_user
from apps.audit.services import audited
from apps.rbac.roles import Permission
from common.api import ok
from common.filters import facets_page, list_params, multi_param
from common.pagination import Page
from common.permissions import permission_required
from common.schema import envelope, errors
from common.validation import parse_id, validated

from . import moderation
from .models import ReviewStatus, ReviewTarget
from .serializers import RATINGS, AdminReviewQuery, DaysQuery, DismissInput, ModerateInput

MODERATE = [permission_required(Permission.REVIEWS_MODERATE)]
TAGS = ["Admin: reviews"]
REVIEW = envelope("AdminReviewResult")
ORDERS = envelope("AdminReviewOrders")
ORDER_PAGE = facets_page(
    "AdminReviewOrderPage",
    moderation.ADMIN_FACETS,
    counts=serializers.DictField(child=serializers.IntegerField()),
)


def _moderation_note(request: Request) -> str:
    action = str(request.data.get("action", ""))
    reason = str(request.data.get("reason", "")).strip()
    return f"Review {moderation.PAST.get(action, action)}: {reason}"


class AdminReviewOrdersView(APIView):
    permission_classes = MODERATE

    @extend_schema(
        tags=TAGS,
        parameters=list_params(
            "Order number, customer, dish or words of the review",
            multi_param("target", ReviewTarget.values, "What the review is about"),
            multi_param("status", ReviewStatus.values, "None given: every status but deleted"),
            multi_param("rating", RATINGS, "Stars"),
            multi_param("restaurant", description="Restaurant ids"),
            OpenApiParameter("restaurantId", str, description="One restaurant's reviews"),
            OpenApiParameter(
                "customer", str, description="Orders of this customer (user id) with reviews"
            ),
            OpenApiParameter(
                "rider", str, description="Orders with a review of this rider (user id)"
            ),
            OpenApiParameter(
                "reported", bool, description="true: orders with open reports, those first"
            ),
            days="created",
        ),
        responses={200: ORDER_PAGE, **errors(401, 403, 422)},
    )
    def get(self, request: Request) -> Response:
        query = validated(AdminReviewQuery, request.query_params)
        return ok(moderation.admin_orders(query, Page.from_query(query)))


class AdminReviewOrderView(APIView):
    permission_classes = MODERATE

    @extend_schema(
        tags=TAGS,
        operation_id="admin_reviews_order_get",
        responses={200: ORDERS, **errors(401, 403, 404, 422)},
    )
    def get(self, request: Request, order_id: str) -> Response:
        return ok(moderation.admin_order(parse_id(order_id, "orderId")))


class AdminReviewAnalyticsView(APIView):
    permission_classes = MODERATE

    @extend_schema(
        tags=TAGS,
        parameters=[DaysQuery],
        responses={200: envelope("ReviewAnalytics"), **errors(401, 403, 422)},
    )
    def get(self, request: Request) -> Response:
        days = validated(DaysQuery, request.query_params).get("days", 30)
        return ok(moderation.analytics(days))


class AdminReviewView(APIView):
    permission_classes = MODERATE

    @extend_schema(
        tags=TAGS,
        operation_id="admin_reviews_get",
        responses={200: REVIEW, **errors(401, 403, 404, 422)},
    )
    def get(self, request: Request, id: str) -> Response:
        return ok({"review": moderation.admin_get(parse_id(id))})


class AdminReviewModerationView(APIView):
    permission_classes = MODERATE

    @extend_schema(
        tags=TAGS,
        request=ModerateInput,
        responses={200: REVIEW, **errors(401, 403, 404, 409, 422)},
    )
    @audited("review.moderate", "review", _moderation_note)
    def post(self, request: Request, id: str) -> Response:
        review_id = parse_id(id)
        data = validated(ModerateInput, request.data)
        review = moderation.moderate(
            current_user(request), review_id, data["action"], data["reason"]
        )
        return ok({"review": review}, message=f"Review {moderation.PAST[data['action']]}")


class AdminReviewDismissView(APIView):
    permission_classes = MODERATE

    @extend_schema(
        tags=TAGS,
        request=DismissInput,
        responses={200: REVIEW, **errors(401, 403, 404, 409, 422)},
    )
    def post(self, request: Request, id: str) -> Response:
        review_id = parse_id(id)
        data = validated(DismissInput, request.data)
        review = moderation.dismiss_reports(current_user(request), review_id, data["reason"])
        return ok({"review": review}, message="Reports dismissed")
