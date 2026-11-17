"""
Delivery partner accounts in the admin panel (Account management phase 4; Node:
services/rider-accounts.service.js): the list with deliveries, rating, availability and
verification state, one rider's account page, and the admin's edits, verification decisions and
taking a rider offline. "Rider id" is the rider's user id, as on /admin/delivery-partners.
Verification goes through the existing review (services.admin_set_verification), going offline
through services.take_offline, user fields through the member edit (admin_services.update_member).
"""

import re
import uuid
from decimal import Decimal
from typing import Any

from django.db import transaction
from django.db.models import (
    Count,
    DecimalField,
    Exists,
    F,
    Max,
    OuterRef,
    Q,
    QuerySet,
    Sum,
    Value,
)
from django.db.models.functions import Coalesce, Replace, Upper
from django.utils import timezone

from apps.accounts.admin_services import (
    ACCOUNT_SORTS,
    MEMBER_FIELDS,
    distinct_names,
    id_search,
    joined_between,
    person_search,
    update_member,
)
from apps.accounts.models import User, UserStatus
from apps.accounts.serializers import user_json
from apps.audit.services import change
from apps.finance.models import OrderSettlement
from apps.kyc import services as kyc
from apps.kyc.models import DocumentKind, KycDocument
from apps.orders.models import Order, OrderStatus
from apps.rbac.roles import Role
from apps.restaurants.accounts import ADDRESS_NAMES
from common.filters import Facet, apply_facets, with_facets
from common.pagination import Page, paginate
from common.validation import field_error

from . import services
from .models import (
    AvailabilitySource,
    DeliveryPartner,
    RiderAvailabilityLog,
    RiderVehicle,
    VehicleType,
    VerificationStatus,
)

Changes = dict[str, Any]
V = VerificationStatus

AVAILABILITY_VALUES = services.AVAILABILITY_VALUES
SORTS: dict[str, tuple[Any, ...]] = {
    **ACCOUNT_SORTS,
    "deliveries": ("-stat_deliveries", "-created_at", "-id"),
    "rating": ("-stat_rating_average", "-stat_rating_count", "-created_at", "-id"),
}
RIDER_KINDS = list(kyc.KINDS_FOR[Role.DELIVERY])
# Documents about the vehicle: a new vehicle number means they have to be checked again.
VEHICLE_KINDS = [DocumentKind.VEHICLE_RC]
P = "delivery_partner__"


# --- verification state, worked out in the database ---------------------------------------------
def _with_kyc(qs: QuerySet[User]) -> QuerySet[User]:
    """`kyc_state` (kyc.with_state) over the rider checklist."""
    required = KycDocument.objects.filter(user=OuterRef("pk"), kind__in=RIDER_KINDS)
    return kyc.with_state(qs, "pk", required, Value(len(RIDER_KINDS)))


def kyc_status(user: User) -> dict[str, Any]:
    row = _with_kyc(User.objects.filter(pk=user.pk)).first()
    return kyc.state_json(getattr(row, "kyc_state", None), user)


# --- list -----------------------------------------------------------------------------------------
def _vehicle_search(search: str) -> Q:
    """The vehicle number, any letter case, spaces ignored ("ka 01 ab" finds "KA01AB1234")."""
    compact = re.sub(r"\s+", "", search).upper()
    if not compact:
        return Q(pk__in=[])
    numbers = RiderVehicle.objects.annotate(
        compact=Replace(Upper("vehicle_number"), Value(" "), Value(""))
    ).filter(partner__user=OuterRef("pk"), compact__contains=compact)
    return Q(Exists(numbers))


def _search(search: str) -> Q:
    """Name, email or phone (any stored form), vehicle number, or the rider id (or its end)."""
    return person_search(search) | _vehicle_search(search) | id_search(search)


def _verification(value: str) -> Q:
    match = Q(**{f"{P}verification_status": value})
    if value == V.PENDING:  # a rider who never opened the app has no profile yet
        match |= Q(delivery_partner__isnull=True)
    return match


VERIFICATION = {v: _verification(v) for v in V.values}
FACETS = (
    Facet("verification", values=V.values, cases=VERIFICATION),
    services.AVAILABILITY_FACET,
    kyc.KYC_FACET,
    Facet("account_status", values=UserStatus.values, field="status"),
    services.ZONE_FACET,
    services.VEHICLE_TYPE_FACET,
)


def _riders(query: dict[str, Any]) -> QuerySet[User]:
    """The riders matching the filters (FACETS, joined days, `search`)."""
    qs = apply_facets(_with_kyc(User.objects.filter(role=Role.DELIVERY)), query, FACETS)
    qs = qs.filter(joined_between(query))
    if search := (query.get("search") or "").strip():
        qs = qs.filter(_search(search))
    return qs


def _profile(user: User) -> DeliveryPartner | None:
    try:
        return user.delivery_partner
    except DeliveryPartner.DoesNotExist:
        return None


def _vehicle(profile: DeliveryPartner | None) -> RiderVehicle | None:
    return services.vehicle_of(profile) if profile else None


def _rating(profile: DeliveryPartner | None) -> dict[str, Any]:
    if profile is None:
        return {"average": 0.0, "count": 0}
    return {"average": float(profile.rating_average), "count": profile.rating_count}


def _item(u: User) -> dict[str, Any]:
    p = _profile(u)
    vehicle = _vehicle(p)
    return {
        "id": str(u.pk),
        "name": u.name,
        "email": u.email,
        "phone": u.phone or None,
        "avatar_url": u.avatar_url or None,
        "status": u.status,
        "status_reason": u.status_reason or None,
        "created_at": u.created_at,
        "verification_status": p.verification_status if p else V.PENDING,
        "is_online": p.is_online if p else False,
        "busy": bool(p and p.is_online and p.active_order_id),
        "vehicle_type": vehicle.vehicle_type if vehicle else None,
        "vehicle_number": (vehicle.vehicle_number or None) if vehicle else None,
        "zone": (p.zone or None) if p else None,
        "completed_deliveries": p.completed_deliveries if p else 0,
        "rating": _rating(p),
        "kyc_status": u.kyc_state,  # type: ignore[attr-defined]
    }


def list_accounts(query: dict[str, Any], page: Page) -> dict[str, Any]:
    qs = (
        _riders(query)
        .select_related("delivery_partner__vehicle")
        .annotate(
            stat_deliveries=Coalesce(F(f"{P}completed_deliveries"), Value(0)),
            stat_rating_average=Coalesce(
                F(f"{P}rating_average"), Value(Decimal(0)), output_field=DecimalField()
            ),
            stat_rating_count=Coalesce(F(f"{P}rating_count"), Value(0)),
        )
    )
    rows, meta = paginate(qs.order_by(*SORTS[query.get("sort") or "newest"]), page)
    result = {"items": [_item(u) for u in rows], "pagination": meta}
    return with_facets(result, query, _riders, FACETS)


def zones() -> list[str]:
    return distinct_names(DeliveryPartner.objects.values_list("zone", flat=True))


# --- one rider ------------------------------------------------------------------------------------
def get(user_id: uuid.UUID) -> User:
    return services.rider_user(user_id)  # 404 "Delivery partner not found"


def rider_out(profile: DeliveryPartner) -> dict[str, Any]:
    """The admin rider profile (GET /admin/delivery-partners/:id `profile`) + contact and zone."""
    return {
        **services.profile_json(profile),
        "emergency_contact": _contact(profile.emergency_contact),
        "zone": profile.zone or None,
    }


def _stats(user: User, profile: DeliveryPartner) -> dict[str, Any]:
    counts = Order.objects.filter(delivery_partner=user).aggregate(
        deliveries=Count("pk", filter=Q(status=OrderStatus.DELIVERED)),
        cancelled=Count("pk", filter=Q(status=OrderStatus.CANCELLED)),
    )
    # The rider's share of each delivered order's settlement, as on their earnings screen.
    earned = OrderSettlement.objects.filter(
        order__delivery_partner=user, order__status=OrderStatus.DELIVERED
    ).aggregate(earnings_paise=Sum("rider_paise"), last_delivery_at=Max("settled_at"))
    return {
        "deliveries": counts["deliveries"],
        "cancelled": counts["cancelled"],
        "earnings_paise": earned["earnings_paise"] or 0,
        "last_delivery_at": earned["last_delivery_at"],
        "rating": _rating(profile),
    }


def detail(user: User) -> dict[str, Any]:
    user.refresh_from_db()
    profile = services.get_or_create_profile(user)
    return {
        "user": user_json(user),
        "rider": rider_out(profile),
        "stats": _stats(user, profile),
        "kyc": kyc_status(user),
    }


# --- edits ----------------------------------------------------------------------------------------
def _address_changes(before: dict[str, Any] | None, after: dict[str, Any]) -> Changes:
    old = before or {}
    return {
        name: change(old.get(key) or None, after.get(key) or None)
        for key, name in ADDRESS_NAMES.items()
        if (old.get(key) or None) != (after.get(key) or None)
    }


def _contact(value: dict[str, Any] | None) -> dict[str, Any] | None:
    """The stored emergency contact: {name, phone, relation} (relation null when not given)."""
    if not value:
        return None
    return {
        "name": value["name"],
        "phone": value["phone"],
        "relation": (value.get("relation") or "").strip() or None,
    }


def update(user: User, data: dict[str, Any]) -> Changes:
    """
    What an admin may correct about a rider: name, gender, date of birth, photo (the member edit's
    rules), home address and vehicle (the rider's own rules), emergency contact and zone. A new
    vehicle number sends an approved RC back for review; the verification status stays. Returns
    what changed ({} when nothing did).
    """
    changes: Changes = {}
    with transaction.atomic():
        profile = services.get_or_create_profile(user)
        member = {k: data[k] for k in MEMBER_FIELDS if k in data}
        if member:
            _, member_changes = update_member(user, member)
            changes.update(member_changes)

        if "address" in data:
            address_changes = _address_changes(profile.address, data["address"])
            if address_changes:
                services.update_details(user, data["address"])
                changes.update(address_changes)

        fields: dict[str, Any] = {}
        if "emergency_contact" in data:
            before, after = _contact(profile.emergency_contact), _contact(data["emergency_contact"])
            if before != after:
                fields["emergency_contact"] = after
                changes["emergencyContact"] = change(before, after)
        if "zone" in data:
            zone = (data["zone"] or "").strip() or None
            if zone != (profile.zone or None):
                fields["zone"] = zone
                changes["zone"] = change(profile.zone or None, zone)
        if fields:
            DeliveryPartner.objects.filter(pk=profile.pk).update(
                **fields, updated_at=timezone.now()
            )

        if "vehicle_type" in data or "vehicle_number" in data:
            changes.update(_update_vehicle(user, profile, data))
    return changes


def _update_vehicle(user: User, profile: DeliveryPartner, data: dict[str, Any]) -> Changes:
    vehicle = services.vehicle_of(profile)
    before_type = vehicle.vehicle_type if vehicle else None
    before_number = (vehicle.vehicle_number or None) if vehicle else None
    vehicle_type = data.get("vehicle_type") or before_type
    if vehicle_type is None:  # a number alone for a rider with no vehicle yet
        raise field_error("vehicleType", f"Vehicle must be one of: {', '.join(VehicleType.values)}")
    number = data.get("vehicle_number", before_number)
    number = (number or "").strip().upper() or None
    changes: Changes = {}
    if vehicle_type != before_type:
        changes["vehicleType"] = change(before_type, vehicle_type)
    if number != before_number:
        changes["vehicleNumber"] = change(before_number, number)
    if not changes:
        return {}
    services.update_vehicle(user, vehicle_type, number)
    if "vehicleNumber" in changes and (reverified := kyc.reverify(user.pk, VEHICLE_KINDS)):
        changes["reverified"] = reverified
    return changes


# --- verification ---------------------------------------------------------------------------------
VERIFICATION_MESSAGES = {
    V.APPROVED: "Delivery partner approved",
    V.REJECTED: "Delivery partner rejected",
    V.RESUBMISSION_REQUESTED: "Asked for documents",
}


def set_verification(
    actor: User, user_id: uuid.UUID, status: str, reason: str | None
) -> tuple[User, Changes, str]:
    """The existing review (transitions, KYC check, notifications, offline when withdrawn); the
    same status again changes nothing."""
    user = get(user_id)
    previous = services.get_or_create_profile(user).verification_status
    message = VERIFICATION_MESSAGES[V(status)]
    if previous == status:
        return user, {}, message
    services.admin_set_verification(user_id, status, reason or "", actor)
    return user, {"verificationStatus": change(previous, status)}, message


# --- availability ---------------------------------------------------------------------------------
def take_offline(user: User, reason: str) -> Changes:
    """An admin takes the rider offline (never mid-delivery; an open offer is passed on)."""
    profile = DeliveryPartner.objects.filter(user=user).first()
    if profile is None or not profile.is_online:
        return {}
    went_offline = services.take_offline(
        user, profile, "The rider is on a delivery", source=AvailabilitySource.ADMIN, reason=reason
    )
    return {"isOnline": change(True, False)} if went_offline else {}


def availability_history(user: User, page: Page) -> dict[str, Any]:
    rows, meta = paginate(
        RiderAvailabilityLog.objects.filter(rider=user).order_by("-at", "-id"), page
    )
    items = [
        {"is_online": r.is_online, "at": r.at, "source": r.source, "reason": r.reason or None}
        for r in rows
    ]
    return {"items": items, "pagination": meta}
