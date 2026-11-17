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

export function computePricing({
  subtotalPaise,
  coupon = null,
  distanceMeters = null,
  coinDiscountPaise = 0,
  couponBasePaise = null,
}) {
  const discountPaise = couponDiscount(coupon, subtotalPaise, couponBasePaise);
  const discounted = subtotalPaise - discountPaise;
  const fee = distanceMeters === null ? 0 : deliveryFee(distanceMeters, discounted);
  // A free-delivery coupon waives the fee; the waived amount is shown separately.
  const deliveryDiscountPaise = coupon?.discountType === DISCOUNT_TYPES.FREE_DELIVERY ? fee : 0;
  const deliveryFeePaise = fee - deliveryDiscountPaise;
  const taxPaise = Math.round(
    (discounted * PRICING.foodTaxBasisPoints) / 10_000,
  );
  const platformFeePaise = subtotalPaise > 0 ? PRICING.platformFeePaise : 0;
  const beforeCoins = discounted + deliveryFeePaise + platformFeePaise + taxPaise;
  // Coins pay part of the bill; they never change the tax, fees or the free-delivery threshold.
  const coins = Math.max(0, Math.min(coinDiscountPaise, beforeCoins));
  return {
    subtotalPaise,
    discountPaise,
    deliveryFeePaise,
    platformFeePaise,
    taxPaise,
    coinDiscountPaise: coins,
    totalPaise: beforeCoins - coins,
    deliveryDiscountPaise,
  };
}
