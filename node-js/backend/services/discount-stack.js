import { COUPON_KINDS, PAYMENT_CHANNELS, STACK_ORDER, kindOf } from "../models/coupon.model.js";
import * as couponService from "./coupon.service.js";
import { stackPricing } from "./pricing.service.js";

/**
 * Which discounts a cart gets and how they stack (Django: apps/cart/discounts.py).
 *
 * Up to one of each kind, applied in STACK_ORDER, each on the food left after the ones before:
 * the best restaurant offer and the best platform offer (both automatic), the coupon code the
 * customer applied, then the best payment offer for the channel they pay with. Coins come after
 * (pricing.service.js#stackPricing). "Best" is what a discount saves in this stack, so the
 * suggestion the customer sees is exactly what they get.
 */
const ordered = (coupons) =>
  [...coupons].sort((a, b) => STACK_ORDER.indexOf(kindOf(a)) - STACK_ORDER.indexOf(kindOf(b)));

/** The live offers for one cart, checked once, and the bill for any set of them. */
export class Stack {
  /** Loads the live offers (use this, not `new`). */
  static async load({ userId, restaurantId, subtotalPaise, lines, distanceMeters }) {
    const coupons =
      restaurantId && subtotalPaise > 0 ? await couponService.usableAt(restaurantId) : [];
    // Looked up once for every offer, not once per offer inside problem().
    const [newCustomer, used] = coupons.length
      ? await Promise.all([
          couponService.isNewCustomer(userId),
          couponService.redemptionCounts(userId, coupons.map((c) => c._id)),
        ])
      : [false, new Map()];
    return new Stack({ userId, restaurantId, subtotalPaise, lines, distanceMeters, coupons, newCustomer, used });
  }

  constructor(fields) {
    Object.assign(this, fields);
    this.checked = new Map(); // usable() answers, by coupon (and channel, for payment offers)
  }

  /** Whether `c` applies to this cart (paying through `payment`); each answer is worked out once. */
  async usable(c, payment = null) {
    // Only payment offers depend on the channel.
    const key = kindOf(c) === COUPON_KINDS.PAYMENT_OFFER ? `${c._id}:${payment}` : String(c._id);
    if (!this.checked.has(key)) {
      const error = await couponService.problem(c, {
        userId: this.userId,
        restaurantId: this.restaurantId,
        subtotalPaise: this.subtotalPaise,
        lines: this.lines,
        newCustomer: this.newCustomer,
        used: this.used.get(String(c._id)) ?? 0,
        payment,
      });
      this.checked.set(key, error === null);
    }
    return this.checked.get(key);
  }

  /** The bill with these discounts (put in stack order); the parts follow that order. */
  price(chosen, coinDiscountPaise = 0) {
    const discounts = ordered(chosen).map((coupon) => ({
      coupon,
      basePaise: couponService.couponBase(coupon, this.lines),
    }));
    return stackPricing({
      subtotalPaise: this.subtotalPaise,
      discounts,
      distanceMeters: this.distanceMeters,
      coinDiscountPaise,
    });
  }

  /** What `c` saves when it joins `others` (food plus any delivery fee it waives). */
  saving(c, others) {
    const chosen = ordered([...others, c]);
    return this.price(chosen).parts[chosen.indexOf(c)].savingPaise;
  }

  /** The usable offers of this kind that save something on top of `others`: `{ c, savingPaise }`. */
  async savings(kind, others, payment = null) {
    const rows = [];
    for (const c of this.coupons) {
      if (kindOf(c) !== kind || !(await this.usable(c, payment))) continue;
      const savingPaise = this.saving(c, others);
      if (savingPaise > 0) rows.push({ c, savingPaise });
    }
    return rows;
  }

  /** The usable offer of this kind that saves most on top of `others` (`{ c, savingPaise }`), or null. */
  async best(kind, others, payment = null) {
    let best = null;
    for (const row of await this.savings(kind, others, payment))
      if (best === null || row.savingPaise > best.savingPaise) best = row;
    return best;
  }

  /** The restaurant's offers this cart can use, best first; only the `applied` one counts. */
  async restaurantOffers(chosen) {
    const applied = chosen.find((c) => kindOf(c) === COUPON_KINDS.RESTAURANT_OFFER);
    const others = chosen.filter((c) => c !== applied);
    const rows = await this.savings(COUPON_KINDS.RESTAURANT_OFFER, others);
    return rows
      .map(({ c, savingPaise }) => ({ ...summary(c), savingPaise, applied: c === applied }))
      .sort((a, b) => b.savingPaise - a.savingPaise);
  }

  /** Checkout's payment options: the best payment offer for each online channel. */
  async paymentOffers(others) {
    const result = [];
    for (const channel of Object.values(PAYMENT_CHANNELS)) {
      const best = await this.best(COUPON_KINDS.PAYMENT_OFFER, others, channel);
      if (best) result.push({ channel, ...summary(best.c), savingPaise: best.savingPaise });
    }
    return result;
  }
}

export const summary = (c) => ({
  kind: kindOf(c),
  code: c.code,
  name: c.name || null,
  description: c.description || null,
  discountType: c.discountType,
  discountValue: c.discountValue,
  maxDiscountPaise: c.maxDiscountPaise ?? null,
  minOrderPaise: c.minOrderPaise ?? 0,
});

/** Each discount on the bill, in the order it applied, with who pays for it. */
export const discountLines = (chosen, parts) =>
  ordered(chosen).map((c, i) => ({
    ...summary(c),
    foodPaise: parts[i].foodPaise,
    deliveryPaise: parts[i].deliveryPaise,
    savingPaise: parts[i].savingPaise,
    fundedBy: kindOf(c) === COUPON_KINDS.RESTAURANT_OFFER ? "restaurant" : "platform",
  }));
