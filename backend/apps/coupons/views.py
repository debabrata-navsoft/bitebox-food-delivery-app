"""
Coupons and restaurant offers (Node: routes/coupon.routes.js, restaurant-offer.routes.js):
/admin/coupons (catalog:manage), the approval queue, /my/restaurant/offers (restaurant partners,
their own offers only), and what customers see (/coupons/available, /coupons/offers, and the public
/restaurants/{slugOrId}/offers).
"""

from typing import Any

from django.utils import timezone
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import serializers
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.authentication import current_user
from apps.audit.services import audited
from apps.orders.models import PaymentChannel
from apps.rbac.roles import Permission, Role
from apps.restaurants.services import get_public, require_own_restaurant
from common.api import ok
from common.fields import ImageUrlField, QueryBoolean, UUIDRef
from common.filters import (
    MULTI_NOTE,
    FacetQuery,
    MultiIdField,
    facets_page,
    list_params,
    multi_choice,
    multi_param,
)
from common.http import PublicCacheMixin
from common.pagination import Page
from common.permissions import PUBLIC, permission_required, role_required
from common.schema import envelope, errors
from common.validation import PageQuery, parse_id, validated

from . import services
from .models import Audience, DiscountType, Kind, Source

ANY = envelope("CouponResponse")
ADMIN = [permission_required(Permission.CATALOG_MANAGE)]
PARTNER = [role_required(Role.RESTAURANT)]
CUSTOMER = [role_required(Role.CUSTOMER)]
# The lists of usable coupons are not rate-limited like applying a code in the cart
# (COUPON_RATE_LIMIT): they can't be used to guess codes, and the Offers page reloads them.


class NullableInt(serializers.IntegerField):
    """A whole number of at least `min_value`, or null (which clears it)."""

    def __init__(self, field: str, min_value: int, **kwargs: Any) -> None:
        message = f"{field} must be a whole number of at least {min_value}, or null"
        super().__init__(
            min_value=min_value,
            required=False,
            allow_null=True,
            error_messages={k: message for k in ("min_value", "invalid")},
            **kwargs,
        )


def _ids(message: str) -> serializers.ListField:
    return serializers.ListField(
        child=UUIDRef(message=message), required=False, max_length=200, allow_empty=True
    )


class CouponInput(serializers.Serializer):
    # Left out (or blank) on create: a code is generated.
    code = serializers.RegexField(
        r"^[A-Za-z0-9_-]{3,30}$",
        required=False,
        allow_blank=True,
        error_messages={"invalid": "Code: 3-30 letters, digits, - or _"},
    )
    name = serializers.CharField(max_length=80, required=False, allow_blank=True)
    description = serializers.CharField(max_length=200, required=False, allow_blank=True)
    terms = serializers.CharField(max_length=2000, required=False, allow_blank=True)
    discount_type = serializers.ChoiceField(
        choices=DiscountType.values,
        error_messages={
            "invalid_choice": "Choose percent, flat or free delivery",
            "required": "Choose percent, flat or free delivery",
        },
    )
    # Percent (1-100) or paise; left out for free delivery.
    discount_value = serializers.IntegerField(
        min_value=1,
        required=False,
        allow_null=True,
        error_messages={
            k: "Discount must be a positive whole number" for k in ("min_value", "invalid")
        },
    )
    max_discount_paise = NullableInt("maxDiscountPaise", 0)
    min_order_paise = serializers.IntegerField(min_value=0, required=False)
    valid_from = serializers.DateTimeField(
        error_messages={"invalid": "Invalid start date", "required": "Invalid start date"}
    )
    valid_until = serializers.DateTimeField(
        error_messages={"invalid": "Invalid end date", "required": "Invalid end date"}
    )
    is_active = serializers.BooleanField(required=False)
    usage_limit = NullableInt("usageLimit", 1)
    per_user_limit = serializers.IntegerField(min_value=1, max_value=100, required=False)
    restaurant = UUIDRef(message="Invalid restaurant", required=False, allow_null=True)
    restaurants = _ids("Invalid restaurant")
    categories = _ids("Invalid category")
    food_items = _ids("Invalid dish")
    audience = serializers.ChoiceField(choices=Audience.values, required=False)
    banner_url = ImageUrlField(max_length=500)
    # Admins make coupons (codes), platform offers and payment offers (both automatic).
    kind = serializers.ChoiceField(
        choices=[Kind.COUPON, Kind.PLATFORM_OFFER, Kind.PAYMENT_OFFER],
        required=False,
        error_messages={"invalid_choice": "Choose a coupon, platform offer or payment offer"},
    )
    payment_channels = serializers.ListField(
        child=serializers.ChoiceField(
            choices=PaymentChannel.values,
            error_messages={"invalid_choice": "Choose UPI, card, net banking or wallet"},
        ),
        required=False,
        allow_empty=True,
        max_length=4,
    )

    def to_internal_value(self, data: Any) -> Any:
        value = super().to_internal_value(data)
        if "code" in value:
            value["code"] = value["code"].strip().upper()
        return value

    def validate(self, attrs: dict[str, Any]) -> dict[str, Any]:
        """Percent and flat coupons need a discount; free delivery has none."""
        kind = attrs.get("discount_type")
        if kind and kind != DiscountType.FREE_DELIVERY and attrs.get("discount_value") is None:
            raise serializers.ValidationError(
                {"discount_value": "Discount must be a positive whole number"}
            )
        return attrs


class OfferInput(CouponInput):
    """A restaurant partner's offer: no other restaurants; `draft` saves it without submitting."""

    restaurant = None  # type: ignore[assignment]
    restaurants = None  # type: ignore[assignment]
    kind = None  # type: ignore[assignment]
    payment_channels = None  # type: ignore[assignment]
    draft = serializers.BooleanField(required=False, default=False)


class ListQuery(FacetQuery, PageQuery):
    """The coupon lists (admins' and a partner's own offers, where `facets=1` counts status and
    discount type only)."""

    active = QueryBoolean()
    status = multi_choice(services.STATUS_FILTERS)
    # Platform coupons or restaurant offers ("source" would clash with DRF's Field.source).
    owner = multi_choice(Source.values)
    kind = multi_choice(Kind.values)
    audience = multi_choice(Audience.values)
    discount_type = multi_choice(DiscountType.values)
    sort = serializers.ChoiceField(choices=list(services.SORTS), required=False)
    from_ = serializers.DateTimeField(required=False)
    to = serializers.DateTimeField(required=False)

    def to_internal_value(self, data: Any) -> Any:
        if hasattr(data, "dict"):
            data = data.dict()
        if "from" in data:
            data = {**data, "from_": data["from"]}
        value = super().to_internal_value(data)
        if "from_" in value:
            value["from"] = value.pop("from_")
        return value


class ActiveInput(serializers.Serializer):
    is_active = serializers.BooleanField()


class ReasonInput(serializers.Serializer):
    reason = serializers.CharField(max_length=300, required=False, allow_blank=True, default="")


class AvailableQuery(serializers.Serializer):
    restaurant_id = UUIDRef(required=False)


class OffersQuery(serializers.Serializer):
    type = serializers.ChoiceField(choices=list(services.OFFER_KINDS), required=False)


LIST_PARAMS = [
    *list_params("Code or name (or part of it)"),
    OpenApiParameter("active", bool),
    multi_param("status", list(services.STATUS_FILTERS)),
    multi_param("owner", Source.values, "platform: BiteBox coupons; restaurant: restaurant offers"),
    multi_param("kind", Kind.values),
    multi_param("audience", Audience.values),
    multi_param("discountType", DiscountType.values),
    OpenApiParameter("sort", str, enum=list(services.SORTS)),
    OpenApiParameter("from", str, description="ISO date-time: valid on or after it"),
    OpenApiParameter("to", str, description="ISO date-time: valid on or before it"),
]


SUBMITTED = {"draft": "Offer saved as a draft", "pending": "Offer sent for approval"}


def _coupon(coupon: Any) -> dict[str, Any]:
    return {"coupon": services.coupon_json(coupon)}


class AdminView(APIView):
    permission_classes = ADMIN


class PartnerView(APIView):
    """Restaurant partners: every request is scoped to the signed-in partner's restaurant."""

    permission_classes = PARTNER

    def restaurant(self, request: Request) -> Any:
        return require_own_restaurant(current_user(request))


# ---------------------------------------------------------------------------
# Customers
# ---------------------------------------------------------------------------
class AvailableView(APIView):
    permission_classes = CUSTOMER

    @extend_schema(
        tags=["Coupons"],
        parameters=[OpenApiParameter("restaurantId", str)],
        responses={200: ANY, **errors(401, 403, 422)},
    )
    def get(self, request: Request) -> Response:
        query = validated(AvailableQuery, request.query_params)
        coupons = services.list_available(query.get("restaurant_id"), current_user(request))
        return ok({"coupons": coupons})


class CustomerOffersView(APIView):
    permission_classes = CUSTOMER

    @extend_schema(
        tags=["Coupons"],
        parameters=[OpenApiParameter("type", str)],
        responses={200: ANY, **errors(401, 403, 422)},
    )
    def get(self, request: Request) -> Response:
        query = validated(OffersQuery, request.query_params)
        return ok({"offers": services.customer_offers(current_user(request), query.get("type"))})


class RestaurantOffersView(PublicCacheMixin, APIView):
    permission_classes = PUBLIC

    @extend_schema(tags=["Catalogue"], responses={200: ANY, **errors(404, 422)})
    def get(self, request: Request, slug_or_id: str) -> Response:
        return ok({"offers": services.restaurant_offers(get_public(slug_or_id))})


class AdminListQuery(ListQuery):
    # Restaurants' own offers and the coupons limited to them (one: its account page).
    restaurant = MultiIdField()


ADMIN_COUPON_PAGE = facets_page("AdminCouponPage", services.list_facets(timezone.now()))


# ---------------------------------------------------------------------------
# Admins
# ---------------------------------------------------------------------------
class AdminCouponsView(AdminView):
    @extend_schema(
        tags=["Admin: coupons"],
        description=MULTI_NOTE,
        parameters=[
            *LIST_PARAMS,
            multi_param(
                "restaurant",
                description="Restaurant ids: their own offers and the coupons limited to them",
            ),
        ],
        responses={200: ADMIN_COUPON_PAGE, **errors(401, 403, 422)},
    )
    def get(self, request: Request) -> Response:
        query = validated(AdminListQuery, request.query_params)
        return ok(services.admin_list(query, Page.from_query(query)))

    @extend_schema(
        tags=["Admin: coupons"],
        request=CouponInput,
        responses={201: ANY, **errors(401, 403, 409, 422)},
    )
    @audited(
        "coupon.create", "coupon", lambda r: f"Created coupon {r.data.get('code') or '(generated)'}"
    )
    def post(self, request: Request) -> Response:
        coupon = services.create(validated(CouponInput, request.data), current_user(request))
        request.audit_resource_id = coupon.pk  # type: ignore[attr-defined]
        return ok(_coupon(coupon), message="Coupon created", status=201)


class AdminAnalyticsView(AdminView):
    @extend_schema(tags=["Admin: coupons"], responses={200: ANY, **errors(401, 403)})
    def get(self, request: Request) -> Response:
        return ok(services.admin_analytics())


class AdminCouponView(AdminView):
    @extend_schema(tags=["Admin: coupons"], responses={200: ANY, **errors(401, 403, 404, 422)})
    def get(self, request: Request, id: str) -> Response:
        return ok(_coupon(services.admin_get(parse_id(id))))

    @extend_schema(
        tags=["Admin: coupons"],
        request=CouponInput,
        responses={200: ANY, **errors(401, 403, 404, 409, 422)},
    )
    @audited("coupon.update", "coupon", lambda r: "Edited a coupon")
    def patch(self, request: Request, id: str) -> Response:
        coupon_id = parse_id(id)
        coupon = services.update(coupon_id, validated(CouponInput, request.data, partial=True))
        return ok(_coupon(coupon), message="Coupon saved")

    @extend_schema(tags=["Admin: coupons"], responses={200: ANY, **errors(401, 403, 404, 409, 422)})
    @audited("coupon.delete", "coupon", lambda r: "Deleted a coupon")
    def delete(self, request: Request, id: str) -> Response:
        services.remove(parse_id(id))
        return ok(None, message="Coupon deleted")


class AdminCouponStatusView(AdminView):
    @extend_schema(
        tags=["Admin: coupons"],
        request=ActiveInput,
        responses={200: ANY, **errors(401, 403, 404, 422)},
    )
    @audited("coupon.status", "coupon", lambda r: f"Set coupon active: {r.data.get('isActive')}")
    def patch(self, request: Request, id: str) -> Response:
        active = validated(ActiveInput, request.data)["is_active"]
        coupon = services.set_active(parse_id(id), active)
        return ok(_coupon(coupon), message="Coupon activated" if active else "Coupon deactivated")


class AdminCouponDuplicateView(AdminView):
    @extend_schema(
        tags=["Admin: coupons"], request=None, responses={201: ANY, **errors(401, 403, 404)}
    )
    @audited("coupon.duplicate", "coupon", lambda r: "Duplicated a coupon")
    def post(self, request: Request, id: str) -> Response:
        coupon = services.duplicate(parse_id(id), current_user(request))
        return ok(_coupon(coupon), message="Coupon duplicated (switched off)", status=201)


class AdminPendingOffersView(AdminView):
    @extend_schema(
        tags=["Admin: coupons"],
        parameters=[OpenApiParameter(n, str) for n in ("page", "limit")],
        responses={200: ANY, **errors(401, 403, 422)},
    )
    def get(self, request: Request) -> Response:
        query = validated(PageQuery, request.query_params)
        return ok(services.pending(Page.from_query(query)))


class AdminApproveOfferView(AdminView):
    @extend_schema(
        tags=["Admin: coupons"], request=None, responses={200: ANY, **errors(401, 403, 404, 409)}
    )
    @audited("offer.approve", "coupon", lambda r: "Approved a restaurant offer")
    def post(self, request: Request, id: str) -> Response:
        coupon = services.review(parse_id(id), True, "", current_user(request))
        return ok(_coupon(coupon), message="Offer approved")


class AdminRejectOfferView(AdminView):
    @extend_schema(
        tags=["Admin: coupons"],
        request=ReasonInput,
        responses={200: ANY, **errors(401, 403, 404, 409, 422)},
    )
    @audited(
        "offer.reject",
        "coupon",
        lambda r: f"Rejected a restaurant offer: {r.data.get('reason', '')}",
    )
    def post(self, request: Request, id: str) -> Response:
        reason = validated(ReasonInput, request.data)["reason"]
        coupon = services.review(parse_id(id), False, reason, current_user(request))
        return ok(_coupon(coupon), message="Offer rejected")


# ---------------------------------------------------------------------------
# Restaurant partners: their own offers
# ---------------------------------------------------------------------------
OWN_OFFER_PAGE = facets_page("PartnerOfferPage", services.own_facets(timezone.now()))


class OwnOffersView(PartnerView):
    @extend_schema(
        tags=["Restaurant offers"],
        description=MULTI_NOTE,
        parameters=LIST_PARAMS,
        responses={200: OWN_OFFER_PAGE, **errors(401, 403, 404, 422)},
    )
    def get(self, request: Request) -> Response:
        restaurant = self.restaurant(request)
        query = validated(ListQuery, request.query_params)
        return ok(services.own_list(restaurant, query, Page.from_query(query)))

    @extend_schema(
        tags=["Restaurant offers"],
        request=OfferInput,
        responses={201: ANY, **errors(401, 403, 404, 409, 422)},
    )
    def post(self, request: Request) -> Response:
        user = current_user(request)
        coupon = services.own_create(
            require_own_restaurant(user), validated(OfferInput, request.data), user
        )
        message = SUBMITTED.get(coupon.approval_status, "Offer is live")
        return ok(_coupon(coupon), message=message, status=201)


class OwnOfferAnalyticsView(PartnerView):
    @extend_schema(tags=["Restaurant offers"], responses={200: ANY, **errors(401, 403, 404)})
    def get(self, request: Request) -> Response:
        return ok(services.own_analytics(self.restaurant(request)))


class OwnOfferView(PartnerView):
    @extend_schema(tags=["Restaurant offers"], responses={200: ANY, **errors(401, 403, 404, 422)})
    def get(self, request: Request, id: str) -> Response:
        return ok(_coupon(services.own_get(self.restaurant(request), parse_id(id))))

    @extend_schema(
        tags=["Restaurant offers"],
        request=OfferInput,
        responses={200: ANY, **errors(401, 403, 404, 409, 422)},
    )
    def patch(self, request: Request, id: str) -> Response:
        restaurant = self.restaurant(request)
        data = validated(OfferInput, request.data, partial=True)
        coupon = services.own_update(restaurant, parse_id(id), data)
        return ok(_coupon(coupon), message="Offer saved")

    @extend_schema(
        tags=["Restaurant offers"], responses={200: ANY, **errors(401, 403, 404, 409, 422)}
    )
    def delete(self, request: Request, id: str) -> Response:
        services.own_remove(self.restaurant(request), parse_id(id))
        return ok(None, message="Offer deleted")


class OwnOfferStatusView(PartnerView):
    @extend_schema(
        tags=["Restaurant offers"],
        request=ActiveInput,
        responses={200: ANY, **errors(401, 403, 404, 422)},
    )
    def patch(self, request: Request, id: str) -> Response:
        restaurant = self.restaurant(request)
        active = validated(ActiveInput, request.data)["is_active"]
        coupon = services.own_set_active(restaurant, parse_id(id), active)
        return ok(_coupon(coupon), message="Offer resumed" if active else "Offer paused")
