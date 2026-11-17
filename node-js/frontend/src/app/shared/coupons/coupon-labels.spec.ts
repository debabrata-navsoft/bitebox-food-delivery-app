import { CouponOffer } from '../models/checkout.models';
import {
  badgeLabel,
  billLabel,
  channelsLabel,
  conditionsLabel,
  describe as describeOffer,
  discountLabel,
  discountParts,
  isAutomatic,
  scopeLabel,
} from './coupon-labels';

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

  it('tells offers from coupons and names payment methods', () => {
    expect(isAutomatic(base)).toBe(false); // older records have no kind: coupons
    expect(isAutomatic({ ...base, kind: 'platform_offer' })).toBe(true);
    expect(channelsLabel({ paymentChannels: ['upi', 'card'] })).toBe('UPI or Card');
    expect(channelsLabel({ paymentChannels: [] })).toBe('Any online payment');
  });

  it('labels each discount on the bill', () => {
    const line = { code: 'X', name: null, foodPaise: 0, deliveryPaise: 0, savingPaise: 0 };
    expect(billLabel({ ...line, kind: 'restaurant_offer', discountType: 'percent', discountValue: 20 })).toBe(
      'Restaurant offer (20% OFF)',
    );
    expect(billLabel({ ...line, kind: 'coupon', code: 'BITE100', discountType: 'flat', discountValue: 10000 })).toBe(
      'Coupon (BITE100)',
    );
    expect(billLabel({ ...line, kind: 'payment_offer', discountType: 'flat', discountValue: 2500 })).toBe(
      'Payment offer (₹25 OFF)',
    );
  });

  it('describes an offer in a sentence', () => {
    expect(describeOffer({ ...base, code: 'WELCOMEBACK', discountValue: 60, minOrderPaise: 15900, maxDiscountPaise: 10000 })).toBe(
      'Use code WELCOMEBACK & get 60% off on orders above ₹159. Maximum discount: ₹100.',
    );
    expect(describeOffer({ ...base, kind: 'payment_offer', paymentChannels: ['upi'], discountType: 'flat', discountValue: 2500 })).toBe(
      'Pay with UPI to get ₹25 off on any order.',
    );
    expect(describeOffer({ ...base, kind: 'restaurant_offer', discountValue: 20 })).toBe(
      'Get 20% off on any order. Applies by itself, no code needed.',
    );
  });
});
