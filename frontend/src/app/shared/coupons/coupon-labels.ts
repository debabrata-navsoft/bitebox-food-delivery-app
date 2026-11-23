import type { TableColumn } from '../components/data-table/data-table.models';
import { formatCount } from '../utils/numbers';
import {
  AdminCoupon,
  CardOffer,
  CartQuote,
  COUPON_KIND_LABEL,
  COUPON_STATUS_LABEL,
  COUPON_STATUS_TONE,
  CouponOffer,
  DiscountLine,
  NamedRef,
  PAYMENT_CHANNEL_LABEL,
} from '../../core/models/checkout.models';
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

/** A bill line's label: "Restaurant offer (20% OFF)", "Coupon (BITE100)", "Payment offer (₹25 OFF)". */
export function billLabel(d: DiscountLine): string {
  const detail =
    d.kind === 'coupon' || !d.discountType
      ? d.code
      : d.discountType === 'free_delivery'
        ? 'FREE DELIVERY'
        : `${d.discountType === 'percent' ? `${d.discountValue}%` : formatPaise(d.discountValue)} OFF`;
  return `${COUPON_KIND_LABEL[d.kind]} (${detail})`;
}

/** Offers apply by themselves; only coupons are entered as codes (older records are coupons). */
export const isAutomatic = (c: Pick<CouponOffer, 'kind'>): boolean => (c.kind ?? 'coupon') !== 'coupon';

/** A payment offer's channels: "UPI or Card", or "Any online payment". */
export function channelsLabel(c: Pick<CouponOffer, 'paymentChannels'>): string {
  const names = (c.paymentChannels ?? []).map((ch) => PAYMENT_CHANNEL_LABEL[ch]);
  return names.length ? names.join(' or ') : 'Any online payment';
}

/**
 * The offer in a sentence: "Use code WELCOMEBACK & get 60% off on orders above ₹159. Maximum
 * discount: ₹100." (coupons), "Pay with UPI to get ₹25 off on any order." (payment offers).
 */
export function describe(c: CouponOffer): string {
  const what =
    c.discountType === 'free_delivery'
      ? 'free delivery'
      : c.discountType === 'percent'
        ? `${c.discountValue}% off`
        : `${formatPaise(c.discountValue)} off`;
  const min = c.minOrderPaise ? ` on orders above ${formatPaise(c.minOrderPaise)}` : ' on any order';
  const items = itemsLabel(c);
  const on = items ? ` (on ${items})` : '';
  const cap =
    c.discountType === 'percent' && c.maxDiscountPaise
      ? ` Maximum discount: ${formatPaise(c.maxDiscountPaise)}.`
      : '';
  const sentence =
    c.kind === 'payment_offer'
      ? `Pay ${c.paymentChannels?.length ? 'with ' + channelsLabel(c) : 'online'} to get ${what}${min}${on}.`
      : isAutomatic(c)
        ? `Get ${what}${min}${on}. Applies by itself, no code needed.`
        : `Use code ${c.code} & get ${what}${min}${on}.`;
  return sentence + cap + (c.audience === 'new' ? ' For your first order.' : '');
}

/**
 * "FLAT60 applied — you save ₹60" (the saving includes any delivery fee it waived), or for a
 * restaurant offer picked instead of the best one, "Lunch deal applied — you save ₹60".
 */
export function appliedMessage(quote: CartQuote, code?: string): string {
  const offer = quote.restaurantOffers?.find((o) => o.code === code && o.applied);
  if (offer) return `${offer.name || 'Restaurant offer'} applied — you save ${formatPaise(offer.savingPaise)}`;
  return `${quote.coupon?.code} applied — you save ${formatPaise(quote.coupon?.discountPaise ?? 0)}`;
}

/** An offer by name, as restaurants and reviewers know it: its name, description or discount. */
export const offerTitle = (c: CouponOffer): string => c.name || c.description || discountLabel(c);

/**
 * The columns the coupon lists share (admin coupons, the review queue, a restaurant's offers):
 * Discount, Valid (`valid('Runs')` to rename it), Used and Status (with a rejection's reason).
 * `range` is `dateText().range`.
 */
export function couponColumns(range: (from: string, to: string) => string) {
  const column = (c: TableColumn<AdminCoupon>) => c;
  return {
    discount: column({ label: 'Discount', value: discountLabel, sub: conditionsLabel }),
    valid: (label = 'Valid') => column({ label, value: (c) => range(c.validFrom, c.validUntil) }),
    used: column({
      label: 'Used',
      value: (c) => formatCount(c.usedCount) + (c.usageLimit ? ' / ' + formatCount(c.usageLimit) : ''),
      align: 'end',
    }),
    status: column({
      label: 'Status',
      badge: (c) => ({ label: COUPON_STATUS_LABEL[c.status], tone: COUPON_STATUS_TONE[c.status] }),
      sub: (c) => (c.status === 'rejected' ? c.rejectionReason : null),
    }),
  };
}
