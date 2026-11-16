import { CouponOffer, NamedRef } from '../models/checkout.models';
import { formatPaise } from '../pipes/money.pipes';

/** "20% off up to ₹100", "₹50 off" or "Free delivery". */
export function discountLabel(c: CouponOffer): string {
  if (c.discountType === 'free_delivery') return 'Free delivery';
  if (c.discountType === 'flat') return `${formatPaise(c.discountValue)} off`;
  const cap = c.maxDiscountPaise ? ` up to ${formatPaise(c.maxDiscountPaise)}` : '';
  return `${c.discountValue}% off${cap}`;
}

const names = (list: NamedRef[] | undefined, many: string): string | null => {
  if (!list?.length) return null;
  return list.length === 1 ? list[0].name : `${list.length} ${many}`;
};

/** Which dishes it covers: "Desserts", "3 dishes", or null for the whole order. */
export function itemsLabel(c: CouponOffer): string | null {
  return names(c.categories, 'categories') ?? names(c.foodItems, 'dishes');
}

/** Where a coupon can be used: "All restaurants", "Spice Route Kitchen", "3 restaurants · Desserts". */
export function scopeLabel(c: CouponOffer): string {
  const own = c.restaurant && typeof c.restaurant === 'object' ? c.restaurant.name : null;
  const where = own ?? names(c.restaurants, 'restaurants') ?? 'All restaurants';
  const what = itemsLabel(c);
  return what ? `${where} · ${what}` : where;
}

/** The conditions under the discount: "On ₹299+ · New customers" or "No minimum". */
export function conditionsLabel(c: CouponOffer): string {
  const min = c.minOrderPaise ? `On ${formatPaise(c.minOrderPaise)}+` : 'No minimum';
  return c.audience === 'new' ? `${min} · New customers` : min;
}
