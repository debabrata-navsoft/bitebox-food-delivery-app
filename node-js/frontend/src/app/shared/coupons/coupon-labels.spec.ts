import { CouponOffer } from '../models/checkout.models';
import { badgeLabel, conditionsLabel, discountLabel, discountParts, scopeLabel } from './coupon-labels';

const base: CouponOffer = { code: 'X', discountType: 'percent', discountValue: 20, minOrderPaise: 0, validUntil: '' };

describe('coupon labels', () => {
  it('describes the discount', () => {
    expect(discountLabel({ ...base, maxDiscountPaise: 10000 })).toBe('20% off up to ₹100');
    expect(discountLabel({ ...base, discountType: 'flat', discountValue: 5000 })).toBe('₹50 off');
    expect(discountLabel({ ...base, discountType: 'free_delivery', discountValue: 0 })).toBe('Free delivery');
  });

  it('describes where it applies', () => {
    expect(scopeLabel(base)).toBe('All restaurants');
    expect(scopeLabel({ ...base, restaurant: { id: '1', name: 'Lotus Bowl' } })).toBe('Lotus Bowl');
    expect(
      scopeLabel({
        ...base,
        restaurants: [
          { id: '1', name: 'A' },
          { id: '2', name: 'B' },
        ],
        categories: [{ id: '3', name: 'Desserts' }],
      }),
    ).toBe('2 restaurants · Desserts');
  });

  it('labels the card badge and the side panel', () => {
    expect(badgeLabel({ ...base, maxDiscountPaise: 10000 })).toBe('20% OFF UPTO ₹100');
    expect(badgeLabel({ ...base, discountType: 'flat', discountValue: 5000 })).toBe('₹50 OFF');
    expect(discountParts({ ...base, discountType: 'free_delivery', discountValue: 0 })).toEqual({ big: 'FREE', small: 'DELIVERY' });
  });

  it('lists the conditions', () => {
    expect(conditionsLabel(base)).toBe('No minimum');
    expect(conditionsLabel({ ...base, minOrderPaise: 29900, audience: 'new' })).toBe('On ₹299+ · New customers');
  });
});
