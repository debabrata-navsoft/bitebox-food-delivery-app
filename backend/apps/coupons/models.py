"""
Coupons and restaurant offers, and their use (Node: models/coupon.model.js).

One table holds both: platform coupons (`source=platform`, made by admins) and restaurant offers
(`source=restaurant`, made by a partner for their own restaurant, `restaurant` set). Restaurant
offers go through approval (`approval_status`) when OFFER_APPROVAL_REQUIRED; platform coupons are
approved when created. Customers only ever see approved, active coupons inside their dates.
"""

from django.conf import settings
from django.core.validators import RegexValidator
from django.db import models

from apps.menus.models import FoodCategory, FoodItem
from apps.restaurants.models import Restaurant
from common.models import BaseModel, non_negative, one_of


class DiscountType(models.TextChoices):
    PERCENT = "percent"
    FLAT = "flat"
    FREE_DELIVERY = "free_delivery"  # waives the delivery fee; discount_value is 0


class Kind(models.TextChoices):
    """A coupon needs a code; offers apply by themselves (the best one of each kind)."""

    COUPON = "coupon"
    RESTAURANT_OFFER = "restaurant_offer"  # funded by the restaurant
    PLATFORM_OFFER = "platform_offer"
    PAYMENT_OFFER = "payment_offer"  # for online payments, optionally some channels only


# The order discounts stack in: each applies to the food left after the ones before.
STACK_ORDER = (Kind.RESTAURANT_OFFER, Kind.PLATFORM_OFFER, Kind.COUPON, Kind.PAYMENT_OFFER)


class Audience(models.TextChoices):
    ALL = "all"
    NEW = "new"  # no orders yet (other than cancelled or rejected ones)
    EXISTING = "existing"


class Source(models.TextChoices):
    PLATFORM = "platform"
    RESTAURANT = "restaurant"


class ApprovalStatus(models.TextChoices):
    DRAFT = "draft"
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"


class Coupon(BaseModel):
    code = models.CharField(
        max_length=30, unique=True, validators=[RegexValidator(r"^[A-Z0-9_-]{3,30}$")]
    )
    name = models.CharField(max_length=80, blank=True, default="")
    description = models.CharField(max_length=200, blank=True, default="")
    terms = models.TextField(max_length=2000, blank=True, default="")
    kind = models.CharField(max_length=20, choices=Kind.choices, default=Kind.COUPON)
    # Payment offers only: the online channels it is for (upi, card, netbanking, wallet);
    # empty means any online payment.
    payment_channels = models.JSONField(default=list, blank=True)
    discount_type = models.CharField(max_length=16, choices=DiscountType.choices)
    discount_value = models.PositiveIntegerField()  # percent (1–100), paise, or 0 (free delivery)
    max_discount_paise = models.BigIntegerField(null=True, blank=True)
    min_order_paise = models.BigIntegerField(default=0)
    valid_from = models.DateTimeField()
    valid_until = models.DateTimeField()
    is_active = models.BooleanField(default=True)
    usage_limit = models.PositiveIntegerField(null=True, blank=True)
    # Reserved atomically when an order is placed (select_for_update / conditional update).
    used_count = models.PositiveIntegerField(default=0)
    per_user_limit = models.PositiveIntegerField(default=1)
    # Only valid at this restaurant (and, for restaurant offers, the restaurant that owns it).
    restaurant = models.ForeignKey(
        Restaurant, on_delete=models.CASCADE, null=True, blank=True, related_name="coupons"
    )
    # Further scope (empty: no limit). A discount on categories or dishes applies to those lines.
    restaurants = models.ManyToManyField(Restaurant, blank=True, related_name="scoped_coupons")
    categories = models.ManyToManyField(FoodCategory, blank=True, related_name="coupons")
    food_items = models.ManyToManyField(FoodItem, blank=True, related_name="coupons")
    audience = models.CharField(max_length=10, choices=Audience.choices, default=Audience.ALL)
    source = models.CharField(max_length=10, choices=Source.choices, default=Source.PLATFORM)
    approval_status = models.CharField(
        max_length=10, choices=ApprovalStatus.choices, default=ApprovalStatus.APPROVED
    )
    rejection_reason = models.CharField(max_length=300, blank=True, default="")
    reviewed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    reviewed_at = models.DateTimeField(null=True, blank=True)
    banner_url = models.URLField(max_length=500, blank=True, default="")
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )

    class Meta:
        db_table = "coupons"
        constraints = [
            one_of("discount_type", DiscountType, "coupons_discount_type_valid"),
            one_of("audience", Audience, "coupons_audience_valid"),
            one_of("source", Source, "coupons_source_valid"),
            one_of("kind", Kind, "coupons_kind_valid"),
            models.CheckConstraint(
                # A restaurant's discounts are always its own automatic offers, and only those.
                condition=models.Q(source=Source.RESTAURANT, kind=Kind.RESTAURANT_OFFER)
                | (~models.Q(source=Source.RESTAURANT) & ~models.Q(kind=Kind.RESTAURANT_OFFER)),
                name="coupons_restaurant_offers_are_restaurants",
            ),
            one_of("approval_status", ApprovalStatus, "coupons_approval_status_valid"),
            models.CheckConstraint(
                condition=models.Q(discount_value__gte=1)
                | models.Q(discount_type=DiscountType.FREE_DELIVERY),
                name="coupons_discount_value_positive",
            ),
            models.CheckConstraint(
                condition=~models.Q(source=Source.RESTAURANT) | models.Q(restaurant__isnull=False),
                name="coupons_restaurant_offer_has_owner",
            ),
            models.CheckConstraint(
                condition=~models.Q(discount_type="percent") | models.Q(discount_value__lte=100),
                name="coupons_percent_at_most_100",
            ),
            non_negative("min_order_paise", "coupons_min_order_non_negative"),
            models.CheckConstraint(
                condition=models.Q(max_discount_paise__isnull=True)
                | models.Q(max_discount_paise__gte=0),
                name="coupons_max_discount_non_negative",
            ),
            models.CheckConstraint(
                condition=models.Q(valid_until__gt=models.F("valid_from")),
                name="coupons_valid_range",
            ),
            models.CheckConstraint(
                condition=models.Q(usage_limit__isnull=True)
                | models.Q(used_count__lte=models.F("usage_limit")),
                name="coupons_used_within_limit",
            ),
            models.CheckConstraint(
                condition=models.Q(per_user_limit__gte=1), name="coupons_per_user_limit_positive"
            ),
        ]
        indexes = [
            models.Index(fields=["kind", "is_active", "valid_until"], name="coupons_kind_live"),
            models.Index(fields=["is_active", "valid_until"], name="coupons_active_until"),
            models.Index(fields=["source", "approval_status"], name="coupons_source_approval"),
        ]

    def __str__(self) -> str:
        return self.code


class CouponRedemption(BaseModel):
    coupon = models.ForeignKey(Coupon, on_delete=models.PROTECT, related_name="redemptions")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="+")
    # One per discount on the order (a coupon plus automatic offers).
    order = models.ForeignKey(
        "orders.Order", on_delete=models.CASCADE, related_name="coupon_redemptions"
    )
    discount_paise = models.BigIntegerField()

    class Meta:
        db_table = "coupon_redemptions"
        constraints = [
            non_negative("discount_paise", "coupon_redemptions_discount_non_negative"),
            models.UniqueConstraint(
                fields=["order", "coupon"], name="coupon_redemptions_once_per_order"
            ),
        ]
        indexes = [models.Index(fields=["coupon", "user"], name="coupon_redemptions_per_user")]
