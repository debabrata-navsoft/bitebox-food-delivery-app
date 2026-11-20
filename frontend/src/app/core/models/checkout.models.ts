import { CoinQuote, OrderCoins } from './rewards.models';
import type { PaymentInfo } from './payment.models';

export interface Pricing {
  subtotalPaise: number;
  discountPaise: number;
  deliveryFeePaise: number;
  platformFeePaise: number;
  taxPaise: number;
  /** Paid with BiteBox coins (comes off the payable total). */
  coinDiscountPaise?: number;
  /** Delivery fee waived by a free-delivery coupon (already out of `deliveryFeePaise`). */
  deliveryDiscountPaise?: number;
  totalPaise: number;
}

export interface CartLine {
  foodItemId: string;
  name: string;
  isVeg: boolean;
  imageUrl?: string;
  unitPricePaise: number;
  quantity: number;
  lineTotalPaise: number;
  isAvailable: boolean;
}

export type CheckoutIssueCode =
  | 'ITEMS_UNAVAILABLE'
  | 'RESTAURANT_UNAVAILABLE'
  | 'RESTAURANT_CLOSED'
  | 'BELOW_MINIMUM'
  | 'NO_ADDRESS'
  | 'OUT_OF_RANGE';

export interface CartQuote {
  cart: {
    id: string;
    restaurant: {
      id: string;
      name: string;
      slug: string;
      imageUrl?: string;
      isOpenNow: boolean;
      minOrderPaise: number;
      avgPrepTimeMinutes: number;
    } | null;
    items: CartLine[];
    itemCount: number;
  } | null;
  coupon: { code: string; description?: string; discountPaise: number } | null;
  couponError: { code: string; message: string } | null;
  /** The coupon that saves most on this cart, priced by the server (null when none applies). */
  bestCoupon?: BestCoupon | null;
  /** Every discount on the bill, in the order it applied. */
  discounts?: DiscountLine[];
  /** The restaurant's offers this cart can use, best first; only the `applied` one counts. */
  restaurantOffers?: RestaurantOfferOption[];
  /** The best payment offer for each online channel (for the payment step). */
  paymentOffers?: PaymentOfferOption[];
  /** The channel this quote was priced for (null: cash or not chosen). */
  paymentChannel?: PaymentChannel | null;
  /** Coins the customer can use on this cart (null for an empty cart). */
  coins: CoinQuote | null;
  address: DeliveryAddress | null;
  delivery: {
    distanceMeters: number;
    distanceKind: 'straight_line';
    freeDelivery: boolean;
    freeDeliveryThresholdPaise: number;
  } | null;
  pricing: Pricing;
  issues: { code: CheckoutIssueCode; message: string }[];
  canCheckout: boolean;
}

export type AddressLabel = 'home' | 'work' | 'other';

export interface AddressInput {
  label: AddressLabel;
  recipientName: string;
  phone: string;
  line1: string;
  line2?: string;
  area?: string;
  landmark?: string;
  city: string;
  state: string;
  postalCode: string;
  location: { latitude: number; longitude: number };
  isDefault?: boolean;
}

export interface DeliveryAddress extends Omit<AddressInput, 'location'> {
  id: string;
  location: { type: 'Point'; coordinates: [number, number] };
  isDefault: boolean;
}

export type DiscountType = 'percent' | 'flat' | 'free_delivery';
/** A coupon needs a code; the three offers apply by themselves (the best one of each). */
export type CouponKind = 'coupon' | 'restaurant_offer' | 'platform_offer' | 'payment_offer';
export type PaymentChannel = 'upi' | 'card' | 'netbanking' | 'wallet';

export const COUPON_KIND_LABEL: Record<CouponKind, string> = {
  coupon: 'Coupon',
  restaurant_offer: 'Restaurant offer',
  platform_offer: 'Platform offer',
  payment_offer: 'Payment offer',
};

export const PAYMENT_CHANNEL_LABEL: Record<PaymentChannel, string> = {
  upi: 'UPI',
  card: 'Card',
  netbanking: 'Net banking',
  wallet: 'Wallet',
};

/** One discount on a bill, in the order it applied (quotes and orders). */
export interface DiscountLine {
  kind: CouponKind;
  code: string;
  name: string | null;
  discountType?: DiscountType;
  discountValue?: number;
  /** Off the food; a free-delivery discount's saving is in `deliveryPaise`. */
  foodPaise: number;
  deliveryPaise: number;
  savingPaise: number;
  fundedBy?: 'restaurant' | 'platform';
}

/** One of the restaurant's offers for this cart: the applied one, or one to switch to. */
export interface RestaurantOfferOption {
  kind: 'restaurant_offer';
  code: string;
  name: string | null;
  description: string | null;
  discountType: DiscountType;
  discountValue: number;
  savingPaise: number;
  applied: boolean;
}

/** A channel's best payment offer on this cart. */
export interface PaymentOfferOption {
  channel: PaymentChannel;
  code: string;
  name: string | null;
  description: string | null;
  discountType: DiscountType;
  discountValue: number;
  savingPaise: number;
}

export interface BestCoupon {
  code: string;
  name: string | null;
  description: string | null;
  discountType: DiscountType;
  discountValue: number;
  maxDiscountPaise?: number | null;
  minOrderPaise?: number;
  savingPaise: number;
}

/** A restaurant card's badge: its best own offer and how many it runs. */
export type CardOffer = Pick<
  CouponOffer,
  | 'code'
  | 'kind'
  | 'name'
  | 'discountType'
  | 'discountValue'
  | 'maxDiscountPaise'
  | 'minOrderPaise'
  | 'audience'
> & { count: number };

/** The customer Offers page filters (the API's `type`). */
export type OfferKind =
  | 'percent'
  | 'flat'
  | 'free_delivery'
  | 'first_order'
  | 'restaurant'
  | 'category'
  | 'coupon'
  | 'payment';
export type CouponAudience = 'all' | 'new';
export type CouponSource = 'platform' | 'restaurant';
export type ApprovalStatus = 'draft' | 'pending' | 'approved' | 'rejected';
/** One word for lists, worked out by the API from approval, the switch, dates and uses. */
export type CouponStatus =
  | 'active'
  | 'scheduled'
  | 'expired'
  | 'paused'
  | 'draft'
  | 'pending'
  | 'rejected';

export interface NamedRef {
  id: string;
  name: string;
  slug?: string;
}

export interface CouponOffer {
  id?: string;
  code: string;
  name?: string | null;
  description?: string | null;
  terms?: string | null;
  /** Missing on older records: treat as a coupon. */
  kind?: CouponKind;
  /** Payment offers: the channels it is for (empty: any online payment). */
  paymentChannels?: PaymentChannel[];
  discountType: DiscountType;
  /** Percent (1-100), paise for flat, 0 for free delivery. */
  discountValue: number;
  maxDiscountPaise?: number | null;
  minOrderPaise: number;
  validUntil: string;
  audience?: CouponAudience;
  source?: CouponSource;
  bannerUrl?: string | null;
  restaurant?: NamedRef | string | null;
  restaurants?: NamedRef[];
  categories?: NamedRef[];
  foodItems?: NamedRef[];
}

export interface AdminCoupon extends CouponOffer {
  id: string;
  validFrom: string;
  isActive: boolean;
  usageLimit: number | null;
  usedCount: number;
  perUserLimit: number;
  restaurant: NamedRef | string | null;
  status: CouponStatus;
  approvalStatus: ApprovalStatus;
  rejectionReason?: string | null;
  createdBy?: string | null;
  createdAt: string;
  updatedAt?: string;
}

/** Admin create/update payload. `null` clears the optional cap/limit. */
export interface AdminCouponInput {
  code?: string;
  name?: string;
  description?: string;
  terms?: string;
  discountType?: DiscountType;
  discountValue?: number | null;
  maxDiscountPaise?: number | null;
  minOrderPaise?: number;
  validFrom?: string;
  validUntil?: string;
  isActive?: boolean;
  usageLimit?: number | null;
  perUserLimit?: number;
  audience?: CouponAudience;
  restaurants?: string[];
  categories?: string[];
  foodItems?: string[];
  kind?: Exclude<CouponKind, 'restaurant_offer'>;
  paymentChannels?: PaymentChannel[];
}

export interface CouponQuery {
  search?: string;
  status?: CouponStatus;
  owner?: CouponSource;
  kind?: CouponKind;
  /** One restaurant's offers and the coupons scoped to it (admin). */
  restaurant?: string;
  sort?: 'newest' | 'oldest' | 'expiring' | 'most_used' | 'code';
  page?: number;
  limit?: number;
}

/** Counts by status plus redemptions (aggregates only). */
export type CouponAnalytics = Record<CouponStatus, number> & {
  total: number;
  redemptions: number;
  discountGivenPaise: number;
  top: { id: string; code: string; redemptions: number; discountPaise: number }[];
};

export const COUPON_STATUS_LABEL: Record<CouponStatus, string> = {
  active: 'Active',
  scheduled: 'Scheduled',
  expired: 'Expired',
  paused: 'Paused',
  draft: 'Draft',
  pending: 'Awaiting approval',
  rejected: 'Rejected',
};

export const COUPON_STATUS_TONE: Record<CouponStatus, string> = {
  active: 'tone-good',
  scheduled: 'tone-info',
  expired: '',
  paused: 'tone-warn',
  draft: '',
  pending: 'tone-warn',
  rejected: 'tone-bad',
};

export type OrderStatus =
  | 'pending'
  | 'confirmed'
  | 'rejected'
  | 'preparing'
  | 'ready_for_pickup'
  | 'assigned'
  | 'arrived_at_restaurant'
  | 'picked_up'
  | 'on_the_way'
  | 'delivered'
  | 'cancelled';

export type PaymentStatus =
  'pending' | 'paid' | 'failed' | 'refunded' | 'partially_refunded' | 'cancelled';

export interface OrderItem {
  foodItem: string;
  name: string;
  isVeg: boolean;
  unitPricePaise: number;
  quantity: number;
  lineTotalPaise: number;
}

export interface Order {
  id: string;
  orderNumber: string;
  restaurant: string;
  restaurantSnapshot: {
    name: string;
    slug?: string;
    phone?: string;
    address?: string;
    location?: { type: 'Point'; coordinates: [number, number] };
  };
  items: OrderItem[];
  deliveryAddress: Omit<DeliveryAddress, 'id' | 'isDefault'>;
  pricing: Pricing;
  coupon?: { code: string; discountPaise: number };
  /** Every discount on the order (older orders: empty, see `coupon`). */
  discounts?: DiscountLine[];
  /** Coins redeemed on (and earned by) this order. */
  coins?: OrderCoins;
  distanceMeters: number;
  note?: string;
  status: OrderStatus;
  statusHistory: { status: OrderStatus; at: string; note?: string }[];
  paymentMethod: 'cod' | 'online';
  paymentStatus: PaymentStatus;
  /** When the restaurant received it (online orders: once paid). */
  submittedAt?: string | null;
  /** Set when the restaurant accepts (Django API): preparation minutes and expected ready time. */
  prepMinutes?: number | null;
  readyBy?: string | null;
  /** The delivery code the customer gives the rider (Django API; picked up or on the way only). */
  deliveryOtp?: string | null;
  /** Payment record state (customer and admin views). */
  payment?: PaymentInfo | null;
  /** Why it was rejected or cancelled, and by whom. */
  cancellation?: {
    by: 'customer' | 'restaurant' | 'admin' | 'system';
    reason?: string;
    at: string;
  };
  /** The rider, once one has accepted the delivery (customer and admin views). */
  rider?: RiderCard | null;
  /** Order history only: the customer's own rating of the restaurant for this order. */
  myRating?: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface RiderCard {
  id: string;
  name: string;
  phone: string | null;
  vehicleType: VehicleType | null;
  vehicleNumber: string | null;
  /** Published delivery ratings; null until the rider has one. */
  rating?: { average: number; count: number } | null;
}

export type VehicleType = 'bicycle' | 'scooter' | 'motorbike' | 'car';

export const VEHICLE_LABEL: Record<VehicleType, string> = {
  bicycle: 'Bicycle',
  scooter: 'Scooter',
  motorbike: 'Motorbike',
  car: 'Car',
};

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  pending: 'Waiting for restaurant',
  confirmed: 'Confirmed',
  rejected: 'Rejected by restaurant',
  preparing: 'Being prepared',
  ready_for_pickup: 'Ready for pickup',
  assigned: 'Rider assigned',
  arrived_at_restaurant: 'Rider at the restaurant',
  picked_up: 'Picked up',
  on_the_way: 'On the way',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
};

/** Online orders wait for payment before the restaurant sees them. */
export const awaitingPayment = (o: Pick<Order, 'status' | 'paymentMethod' | 'paymentStatus'>) =>
  o.status === 'pending' && o.paymentMethod === 'online' && o.paymentStatus !== 'paid';

/** The customer-facing status, with "Awaiting payment" for unpaid online orders. */
export const customerStatusLabel = (
  o: Pick<Order, 'status' | 'paymentMethod' | 'paymentStatus'>,
) => (awaitingPayment(o) ? 'Awaiting payment' : ORDER_STATUS_LABEL[o.status]);
