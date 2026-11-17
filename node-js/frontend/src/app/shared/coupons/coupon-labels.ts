import { CardOffer, CouponOffer, NamedRef } from '../models/checkout.models';
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

/** Where an offer works: one restaurant (with its slug, for a link), "3 restaurants" or "All restaurants". */
export function placeOf(c: CouponOffer): { name: string; slug?: string } {
  const own = c.restaurant && typeof c.restaurant === 'object' ? c.restaurant : null;
  const one = own ?? (c.restaurants?.length === 1 ? c.restaurants[0] : null);
  if (one) return one;
  return { name: c.restaurants?.length ? `${c.restaurants.length} restaurants` : 'All restaurants' };
}

/** Which dishes it covers: "Desserts", "3 dishes", or null for the whole order. */
export function itemsLabel(c: CouponOffer): string | null {
  return names(c.categories, 'categories') ?? names(c.foodItems, 'dishes');
}

/** Where a coupon can be used: "All restaurants", "Spice Route Kitchen", "3 restaurants · Desserts". */
export function scopeLabel(c: CouponOffer): string {
  const where = placeOf(c).name;
  const what = itemsLabel(c);
  return what ? `${where} · ${what}` : where;
}

/** The conditions under the discount: "On ₹299+ · New customers" or "No minimum". */
export function conditionsLabel(c: CouponOffer): string {
  const min = c.minOrderPaise ? `On ${formatPaise(c.minOrderPaise)}+` : 'No minimum';
  return c.audience === 'new' ? `${min} · New customers` : min;
}

type DiscountFields = Pick<CardOffer, 'discountType' | 'discountValue' | 'maxDiscountPaise'>;

/** The discount in two parts for a coupon's side panel: "20%" / "OFF", or "FREE" / "DELIVERY". */
export function discountParts(c: DiscountFields): { big: string; small: string } {
  if (c.discountType === 'free_delivery') return { big: 'FREE', small: 'DELIVERY' };
  const big = c.discountType === 'percent' ? `${c.discountValue}%` : formatPaise(c.discountValue);
  return { big, small: 'OFF' };
}

/** A restaurant card's badge: "20% OFF UPTO ₹100", "₹50 OFF" or "FREE DELIVERY". */
export function badgeLabel(c: DiscountFields): string {
  const { big, small } = discountParts(c);
  const cap = c.discountType === 'percent' && c.maxDiscountPaise ? ` UPTO ${formatPaise(c.maxDiscountPaise)}` : '';
  return `${big} ${small}${cap}`;
}
