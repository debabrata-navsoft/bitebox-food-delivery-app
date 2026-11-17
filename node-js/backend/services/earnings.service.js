import { EARNINGS } from "../config/earnings.js";
import { CommissionRule } from "../models/commission-rule.model.js";

/**
 * The commission rate in effect now for a restaurant: its own open rule, else the global one,
 * else the default (config/earnings.js).
 */
export async function commissionBpFor(restaurantId) {
  return (await commissionsFor([restaurantId])).get(String(restaurantId)).basisPoints;
}

/**
 * The same for several restaurants at once: id -> { basisPoints, source }, where `source` is
 * "restaurant" (its own rule) or "default" (the global rule or the configured default).
 */
export async function commissionsFor(restaurantIds) {
  const rules = await CommissionRule.find({
    effectiveTo: null,
    restaurant: { $in: [...restaurantIds, null] },
  }).lean();
  const own = new Map(rules.filter((r) => r.restaurant).map((r) => [String(r.restaurant), r]));
  const global = rules.find((r) => !r.restaurant);
  const fallback = global?.basisPoints ?? EARNINGS.restaurantCommissionBasisPoints;
  return new Map(
    restaurantIds.map((id) => {
      const rule = own.get(String(id));
      return [
        String(id),
        rule
          ? { basisPoints: rule.basisPoints, source: "restaurant" }
          : { basisPoints: fallback, source: "default" },
      ];
    }),
  );
}

/**
 * The food value the restaurant is paid on: after its own offers only. BiteBox funds every other
 * discount, so the restaurant is paid as if those were not there. Orders placed before stacked
 * discounts have no `restaurantDiscountPaise`: their one discount counts, as it did then.
 */
export function restaurantFood(order) {
  return order.pricing.subtotalPaise - (order.restaurantDiscountPaise ?? order.pricing.discountPaise ?? 0);
}

/** The same, inside an aggregation over orders. */
export const RESTAURANT_FOOD_EXPR = {
  $subtract: [
    "$pricing.subtotalPaise",
    { $ifNull: ["$restaurantDiscountPaise", { $ifNull: ["$pricing.discountPaise", 0] }] },
  ],
};

/** How a delivered order's money splits (`bp`: the commission in basis points). */
export function settlementFor(order, bp = EARNINGS.restaurantCommissionBasisPoints) {
  // A restaurant's own free-delivery offer is paid for out of its share too.
  const waived = (order.discounts ?? [])
    .filter((d) => d.fundedBy === "restaurant")
    .reduce((sum, d) => sum + (d.deliveryPaise ?? 0), 0);
  const restaurantPaise = Math.round((restaurantFood(order) * (10_000 - bp)) / 10_000) - waived;
  const riderPaise =
    EARNINGS.riderBasePaise +
    Math.ceil((order.distanceMeters ?? 0) / 1000) * EARNINGS.riderPerKmPaise;
  return {
    restaurantPaise,
    riderPaise,
    platformPaise: order.pricing.totalPaise - restaurantPaise - riderPaise,
    commissionBp: bp,
  };
}
