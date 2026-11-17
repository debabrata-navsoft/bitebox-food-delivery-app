"""
Which discounts a cart gets and how they stack (Node: services/discount-stack.js).

Up to one of each kind, applied in STACK_ORDER, each on the food left after the ones before:
the best restaurant offer and the best platform offer (both automatic), the coupon code the
customer applied, then the best payment offer for the channel they pay with. Coins come after
(apps/cart/pricing.py#stack_pricing). "Best" is what a discount saves in this stack, so the
suggestion the customer sees is exactly what they get.
"""

from collections.abc import Iterable
from typing import Any

from apps.accounts.models import User
from apps.coupons.models import STACK_ORDER, Coupon, Kind
from apps.coupons.services import (
    Line,
    coupon_base,
    is_new_customer,
    problem,
    redemption_counts,
    usable_at,
)
from apps.orders.models import PaymentChannel

from .pricing import Part, Pricing, stack_pricing

FUNDED_BY_RESTAURANT = {Kind.RESTAURANT_OFFER}


def _ordered(coupons: Iterable[Coupon]) -> list[Coupon]:
    return sorted(coupons, key=lambda c: STACK_ORDER.index(Kind(c.kind)))


class Stack:
    """The live offers for one cart, checked once, and the bill for any set of them."""

    def __init__(
        self,
        user: User,
        restaurant_id: Any,
        subtotal: int,
        lines: list[Line],
        distance_m: float | None,
    ) -> None:
        self.user = user
        self.restaurant_id = restaurant_id
        self.subtotal = subtotal
        self.lines = lines
        self.distance_m = distance_m
        self.coupons = list(usable_at(restaurant_id)) if restaurant_id and subtotal > 0 else []
        # Looked up once for every offer, not once per offer inside problem().
        self.new = is_new_customer(user.pk) if self.coupons else False
        self.used = redemption_counts(user.pk, self.coupons) if self.coupons else {}
        # problem() and the stack pricing are asked about the same offers many times per quote.
        self._usable: dict[tuple[Any, str | None], bool] = {}
        self._savings: dict[tuple[Any, ...], int] = {}

    def usable(self, c: Coupon, payment: str | None = None) -> bool:
        # Only payment offers depend on the payment channel.
        key = (c.pk, payment if c.kind == Kind.PAYMENT_OFFER else None)
        if key not in self._usable:
            self._usable[key] = (
                problem(
                    c,
                    user_id=self.user.pk,
                    restaurant_id=self.restaurant_id,
                    subtotal_paise=self.subtotal,
                    lines=self.lines,
                    new_customer=self.new,
                    used=self.used.get(c.pk, 0),
                    payment=payment,
                )
                is None
            )
        return self._usable[key]

    def price(self, chosen: Iterable[Coupon], coins_paise: int = 0) -> tuple[Pricing, list[Part]]:
        """The bill with these discounts (put in stack order); the parts follow that order."""
        discounts = [(c, coupon_base(c, self.lines)) for c in _ordered(chosen)]
        return stack_pricing(self.subtotal, discounts, self.distance_m, coins_paise)

    def saving(self, c: Coupon, others: list[Coupon]) -> int:
        """What `c` saves when it joins `others` (food plus any delivery fee it waives)."""
        key = (c.pk, *(o.pk for o in others))
        if key not in self._savings:
            chosen = _ordered([*others, c])
            self._savings[key] = self.price(chosen)[1][chosen.index(c)].saving_paise
        return self._savings[key]

    def best(self, kind: str, others: list[Coupon], payment: str | None = None) -> Coupon | None:
        """The usable offer of this kind that saves most on top of `others`, if any saves."""
        savings = [
            (c, self.saving(c, others))
            for c in self.coupons
            if c.kind == kind and self.usable(c, payment)
        ]
        # max() keeps the first of equal savings.
        best = max((s for s in savings if s[1] > 0), key=lambda s: s[1], default=None)
        return best[0] if best else None

    def restaurant_offers(self, chosen: list[Coupon]) -> list[dict[str, Any]]:
        """The restaurant's offers this cart can use, best first; only the `applied` one counts."""
        others = [c for c in chosen if c.kind != Kind.RESTAURANT_OFFER]
        applied = {c.pk for c in chosen if c.kind == Kind.RESTAURANT_OFFER}
        rows = [
            {**summary(c), "saving_paise": self.saving(c, others), "applied": c.pk in applied}
            for c in self.coupons
            if c.kind == Kind.RESTAURANT_OFFER and self.usable(c)
        ]
        return sorted((r for r in rows if r["saving_paise"] > 0), key=lambda r: -r["saving_paise"])

    def payment_offers(self, others: list[Coupon]) -> list[dict[str, Any]]:
        """Checkout's payment options: the best payment offer for each online channel."""
        return [
            {"channel": channel, **summary(c), "saving_paise": self.saving(c, others)}
            for channel in PaymentChannel.values
            if (c := self.best(Kind.PAYMENT_OFFER, others, channel))
        ]


def summary(c: Coupon) -> dict[str, Any]:
    return {
        "kind": c.kind,
        "code": c.code,
        "name": c.name or None,
        "description": c.description or None,
        "discount_type": c.discount_type,
        "discount_value": c.discount_value,
    }


def discount_lines(chosen: list[Coupon], parts: list[Part]) -> list[dict[str, Any]]:
    """Each discount on the bill, in the order it applied, with who pays for it."""
    return [
        {
            **summary(c),
            "food_paise": part.food_paise,
            "delivery_paise": part.delivery_paise,
            "saving_paise": part.saving_paise,
            "funded_by": "restaurant" if c.kind in FUNDED_BY_RESTAURANT else "platform",
        }
        for c, part in zip(_ordered(chosen), parts, strict=True)
    ]
