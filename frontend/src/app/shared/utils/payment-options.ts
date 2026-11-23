import { PaymentChannel } from '../../core/models/checkout.models';
import { PaymentMethodOption } from '../../core/models/payment.models';

/** How a customer can pay: cash, or an online channel. */
export type PayWith = 'cod' | PaymentChannel;

/** A brand shown next to a method: its name in its colour. */
export interface PaymentBrand {
  name: string;
  color: string;
}

export interface PaymentOption {
  value: PayWith;
  label: string;
  detail: string;
  /** Coloured logo tile in public/. */
  image: string;
  brands: PaymentBrand[];
}

const BRANDS = {
  gpay: ['Google Pay', '#1a73e8'],
  phonepe: ['PhonePe', '#5f259f'],
  paytm: ['Paytm', '#00baf2'],
  bhim: ['BHIM', '#f37021'],
  visa: ['Visa', '#1a1f71'],
  mastercard: ['Mastercard', '#eb001b'],
  rupay: ['RuPay', '#097a44'],
  amex: ['Amex', '#006fcf'],
  sbi: ['SBI', '#22409a'],
  hdfc: ['HDFC Bank', '#004c8f'],
  icici: ['ICICI Bank', '#b02a30'],
  axis: ['Axis Bank', '#97144d'],
  amazonpay: ['Amazon Pay', '#232f3e'],
} as const;
type BrandId = keyof typeof BRANDS;
const brand = (id: BrandId): PaymentBrand => ({ name: BRANDS[id][0], color: BRANDS[id][1] });
const brands = (...ids: BrandId[]): PaymentBrand[] => ids.map(brand);

/** A saved card's network ("Visa", "MasterCard", "American Express"...) as a brand, if known. */
export function cardBrand(network: string | null): PaymentBrand | null {
  const n = (network ?? '').toLowerCase().replace(/\s+/g, '');
  const id: BrandId | null = n.includes('visa')
    ? 'visa'
    : n.includes('master')
      ? 'mastercard'
      : n.includes('rupay')
        ? 'rupay'
        : n.includes('amex') || n.includes('americanexpress')
          ? 'amex'
          : null;
  return id && brand(id);
}

/** Online channels (only when an online provider is set up), in the order they are offered. */
export const ONLINE_OPTIONS: PaymentOption[] = [
  {
    value: 'upi',
    label: 'UPI',
    detail: 'Pay using any UPI app',
    image: '/upi.svg',
    brands: brands('gpay', 'phonepe', 'paytm', 'bhim'),
  },
  {
    value: 'card',
    label: 'Credit & debit cards',
    detail: 'Visa, Mastercard, RuPay & more',
    image: '/cards.svg',
    brands: brands('visa', 'mastercard', 'rupay', 'amex'),
  },
  {
    value: 'netbanking',
    label: 'Net banking',
    detail: 'Pay using your bank account',
    image: '/netbanking.svg',
    brands: brands('sbi', 'hdfc', 'icici', 'axis'),
  },
  {
    value: 'wallet',
    label: 'Wallets',
    detail: 'Pay using popular wallets',
    image: '/wallet.svg',
    brands: brands('paytm', 'phonepe', 'amazonpay'),
  },
];

export const CASH_OPTION: PaymentOption = {
  value: 'cod',
  label: 'Cash on delivery',
  detail: 'Pay in cash or by UPI when your order arrives',
  image: '/cod.svg',
  brands: [],
};

/** The ways to pay the API offers (`GET /payments/methods`); `liveOnly` leaves out test payments. */
export function acceptedOptions(methods: PaymentMethodOption[], liveOnly = false): PaymentOption[] {
  const online = methods.some((m) => m.method === 'online' && !(liveOnly && m.simulated));
  return [
    ...(online ? ONLINE_OPTIONS : []),
    ...(methods.some((m) => m.method === 'cod') ? [CASH_OPTION] : []),
  ];
}
