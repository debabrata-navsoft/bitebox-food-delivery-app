import { couponFormModel, couponInput, previewOffer } from './coupon-form';

describe('coupon form', () => {
  const model = () => ({
    ...couponFormModel(null),
    code: ' lunch20 ',
    discount: 20,
    maxDiscount: 150,
    minOrder: 299,
    validFrom: new Date(2026, 10, 1, 15, 30),
    validUntil: new Date(2026, 10, 30),
  });

  it('builds the API payload in paise and whole days', () => {
    const input = couponInput(model());
    expect(input).toMatchObject({ code: 'LUNCH20', discountType: 'percent', discountValue: 20, maxDiscountPaise: 15000, minOrderPaise: 29900 });
    expect(new Date(input.validFrom!).getHours()).toBe(0);
    expect(new Date(input.validUntil!).getHours()).toBe(23);
  });

  it('sends no value or cap for free delivery, and leaves a blank code to the API', () => {
    const input = couponInput({ ...model(), code: '', discountType: 'free_delivery' });
    expect(input.code).toBeUndefined();
    expect(input.discountValue).toBeNull();
    expect(input.maxDiscountPaise).toBeNull();
  });

  it('round-trips a flat coupon through the model', () => {
    const v = couponFormModel({ discountType: 'flat', discountValue: 5000 } as never);
    expect(v.discount).toBe(50);
    expect(previewOffer({ ...v, code: '' }).code).toBe('AUTO-CODE');
  });
});
