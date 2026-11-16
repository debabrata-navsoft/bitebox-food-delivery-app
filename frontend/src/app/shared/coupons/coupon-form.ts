import { SchemaPathTree, maxLength, pattern, required, validate } from '@angular/forms/signals';
import { SelectOption } from 'nexprime';
import { numberRange } from '../forms/form-rules';
import {
  AdminCoupon,
  AdminCouponInput,
  CouponAudience,
  CouponOffer,
  DiscountType,
  NamedRef,
} from '../models/checkout.models';
import { rupeesToPaise } from '../pipes/money.pipes';

/** The form shared by the admin coupon dialog and the restaurant offer dialog. */
const DAY = 86_400_000;
const startOfDay = (date: Date) => new Date(date).setHours(0, 0, 0, 0);

export const DISCOUNT_TYPE_OPTIONS = [
  { value: 'percent', label: '% off' },
  { value: 'flat', label: '₹ off' },
  { value: 'free_delivery', label: 'Free delivery' },
];
export const AUDIENCE_OPTIONS: SelectOption[] = [
  { value: 'all', label: 'All customers' },
  { value: 'new', label: 'New customers (first order)' },
];

export const refIds = (list?: NamedRef[]) => (list ?? []).map((x) => x.id);
export const asOptions = (list: { id?: string; _id?: string; name: string }[]): SelectOption[] =>
  list.map((x) => ({ value: String(x.id ?? x._id), label: x.name }));
/** Options from the API plus anything already chosen that isn't on its first page. */
export const withChosen = (options: SelectOption[] = [], chosen?: NamedRef[]): SelectOption[] => [
  ...options,
  ...asOptions((chosen ?? []).filter((c) => !options.some((o) => o.value === c.id))),
];

export function couponFormModel(data: AdminCoupon | null) {
  const today = new Date();
  return {
    name: data?.name ?? '',
    code: data?.code ?? '',
    description: data?.description ?? '',
    terms: data?.terms ?? '',
    discountType: (data?.discountType ?? 'percent') as DiscountType,
    discount: data
      ? data.discountType === 'flat'
        ? data.discountValue / 100
        : data.discountValue || null
      : (null as number | null),
    maxDiscount: data?.maxDiscountPaise ? data.maxDiscountPaise / 100 : (null as number | null),
    minOrder: (data ? data.minOrderPaise / 100 : 0) as number | null,
    perUserLimit: (data?.perUserLimit ?? 1) as number | null,
    usageLimit: data?.usageLimit ?? (null as number | null),
    audience: (data?.audience ?? 'all') as CouponAudience,
    validFrom: new Date(data?.validFrom ?? today) as Date | null,
    validUntil: new Date(data?.validUntil ?? today.getTime() + 30 * DAY) as Date | null,
    isActive: data?.isActive ?? true,
  };
}
export type CouponFormModel = ReturnType<typeof couponFormModel>;

/** Validation; `editing` makes the code required (a new one is generated when left blank). */
export function couponFormSchema(path: SchemaPathTree<CouponFormModel>, editing: boolean): void {
  pattern(path.code, /^([A-Za-z0-9_-]{3,30})?$/, { message: '3-30 letters, digits, - or _' });
  if (editing) required(path.code, { message: 'Code is required' });
  maxLength(path.name, 80, { message: 'Keep the name under 80 characters' });
  maxLength(path.description, 200, { message: 'Description must be at most 200 characters' });
  maxLength(path.terms, 2000, { message: 'Keep the terms under 2000 characters' });
  validate(path.discount, ({ value, valueOf }) => {
    const type = valueOf(path.discountType);
    if (type === 'free_delivery') return undefined;
    const v = value();
    if (v === null || v === undefined || v < 1) {
      return { kind: 'required', message: 'Enter a discount of at least 1' };
    }
    return type === 'percent' && v > 100
      ? { kind: 'max', message: 'A percentage cannot exceed 100' }
      : undefined;
  });
  numberRange(path.maxDiscount, 'Max discount', 0, 10_000_000, { optional: true });
  numberRange(path.minOrder, 'Minimum order', 0, 10_000_000, { optional: true });
  numberRange(path.perUserLimit, 'Uses per customer', 1, 100);
  numberRange(path.usageLimit, 'Total uses', 1, 100_000_000, { optional: true });
  required(path.validFrom, { message: 'Start date is required' });
  required(path.validUntil, { message: 'End date is required' });
  validate(path.validUntil, ({ value, valueOf }) => {
    const from = valueOf(path.validFrom);
    return value() && from && startOfDay(value()!) < startOfDay(from)
      ? { kind: 'order', message: 'End date must be on or after the start date' }
      : undefined;
  });
}

const discountValue = (v: CouponFormModel): number | null => {
  if (v.discountType === 'free_delivery') return null;
  return v.discountType === 'percent' ? Math.round(Number(v.discount)) : rupeesToPaise(Number(v.discount));
};

/** The API payload (paise, whole days in the user's time zone). */
export function couponInput(v: CouponFormModel): AdminCouponInput {
  return {
    code: v.code.trim().toUpperCase() || undefined,
    name: v.name.trim(),
    description: v.description.trim(),
    terms: v.terms.trim(),
    discountType: v.discountType,
    discountValue: discountValue(v),
    maxDiscountPaise:
      v.discountType === 'percent' && v.maxDiscount ? rupeesToPaise(Number(v.maxDiscount)) : null,
    minOrderPaise: rupeesToPaise(Number(v.minOrder ?? 0)),
    perUserLimit: Number(v.perUserLimit),
    usageLimit: v.usageLimit ? Number(v.usageLimit) : null,
    audience: v.audience,
    validFrom: new Date(startOfDay(v.validFrom!)).toISOString(),
    validUntil: new Date(startOfDay(v.validUntil!) + DAY - 1000).toISOString(),
    isActive: v.isActive,
  };
}

/** What customers would see, for a live preview while editing. */
export function previewOffer(v: CouponFormModel, scope: Partial<CouponOffer> = {}): CouponOffer {
  return {
    code: v.code.trim().toUpperCase() || 'AUTO-CODE',
    name: v.name.trim() || null,
    description: v.description.trim() || null,
    discountType: v.discountType,
    discountValue: discountValue(v) || 0,
    maxDiscountPaise:
      v.discountType === 'percent' && v.maxDiscount ? rupeesToPaise(Number(v.maxDiscount)) : null,
    minOrderPaise: rupeesToPaise(Number(v.minOrder ?? 0)),
    validUntil: v.validUntil?.toISOString() ?? '',
    audience: v.audience,
    ...scope,
  };
}
