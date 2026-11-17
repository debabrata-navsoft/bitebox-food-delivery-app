import { PRICING } from "../config/pricing.js";
import { DISCOUNT_TYPES } from "../models/coupon.model.js";

/**
 * The food discount. `basePaise` is what the coupon applies to (the lines in its categories or
 * dishes; the whole subtotal by default). Never more than that base; percentages are capped by
 * maxDiscountPaise; free-delivery coupons take nothing off the food.
 */
export function couponDiscount(coupon, subtotalPaise, basePaise = null) {
  if (!coupon || coupon.discountType === DISCOUNT_TYPES.FREE_DELIVERY) return 0;
  const base = basePaise === null ? subtotalPaise : Math.min(basePaise, subtotalPaise);
  let discount =
    coupon.discountType === DISCOUNT_TYPES.PERCENT
      ? Math.floor((base * coupon.discountValue) / 100)
      : coupon.discountValue;
  if (coupon.maxDiscountPaise)
    discount = Math.min(discount, coupon.maxDiscountPaise);
  return Math.max(0, Math.min(discount, base));
}

export function deliveryFee(distanceMeters, discountedSubtotalPaise) {
  if (discountedSubtotalPaise >= PRICING.freeDeliveryThresholdPaise) return 0;
  const km = distanceMeters / 1000;
  const extraKm = Math.max(0, Math.ceil(km - PRICING.deliveryBaseKm));
  return Math.min(
    PRICING.deliveryBaseFeePaise + extraKm * PRICING.deliveryPerKmPaise,
    PRICING.deliveryMaxFeePaise,
  );
}

/**
 * The bill with several discounts, each `{ coupon, basePaise }` in the order they apply
 * (restaurant offer, platform offer, coupon, payment offer). Each takes its share of the food
 * that is left; a scoped discount never reaches past its own lines. The first free-delivery
 * discount waives the fee. Coins come last and never change tax, fees or the threshold.
 * Returns the pricing and one part per discount: `{ foodPaise, deliveryPaise, savingPaise }`.
 */
export function stackPricing({
  subtotalPaise,
  discounts = [],
  distanceMeters = null,
  coinDiscountPaise = 0,
}) {
  let left = subtotalPaise;
  const foods = discounts.map(({ coupon, basePaise = null }) => {
    const food = couponDiscount(coupon, left, basePaise);
    left -= food;
    return food;
  });
  const fee = distanceMeters === null ? 0 : deliveryFee(distanceMeters, left);
  const waiver = discounts.findIndex(({ coupon }) => coupon.discountType === DISCOUNT_TYPES.FREE_DELIVERY);
  // The waived fee is shown separately (deliveryDiscountPaise).
  const deliveryDiscountPaise = waiver === -1 ? 0 : fee;
  const parts = foods.map((foodPaise, i) => {
    const deliveryPaise = i === waiver ? deliveryDiscountPaise : 0;
    return { foodPaise, deliveryPaise, savingPaise: foodPaise + deliveryPaise };
  });
  const deliveryFeePaise = fee - deliveryDiscountPaise;
  const taxPaise = Math.round((left * PRICING.foodTaxBasisPoints) / 10_000);
  const platformFeePaise = subtotalPaise > 0 ? PRICING.platformFeePaise : 0;
  const beforeCoins = left + deliveryFeePaise + platformFeePaise + taxPaise;
  const coins = Math.max(0, Math.min(coinDiscountPaise, beforeCoins));
  const pricing = {
    subtotalPaise,
    discountPaise: subtotalPaise - left, // every food discount together
    deliveryFeePaise,
    platformFeePaise,
    taxPaise,
    coinDiscountPaise: coins,
    totalPaise: beforeCoins - coins,
    deliveryDiscountPaise,
  };
  return { pricing, parts };
}

/** The bill with at most one discount (see stackPricing). */
export function computePricing({
  subtotalPaise,
  coupon = null,
  distanceMeters = null,
  coinDiscountPaise = 0,
  couponBasePaise = null,
}) {
  const discounts = coupon ? [{ coupon, basePaise: couponBasePaise }] : [];
  return stackPricing({ subtotalPaise, discounts, distanceMeters, coinDiscountPaise }).pricing;
}
