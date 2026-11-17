import mongoose from "mongoose";

/**
 * Coupons and restaurant offers (Django: apps/coupons/models.py). One collection holds both:
 * platform coupons (`source: platform`, made by admins) and restaurant offers (`source: restaurant`,
 * made by a partner for their own restaurant, `restaurant` set). Restaurant offers go through
 * approval (`approvalStatus`) when OFFER_APPROVAL_REQUIRED; platform coupons are approved when
 * created. Customers only ever see approved, active coupons inside their dates.
 */
export const DISCOUNT_TYPES = Object.freeze({
  PERCENT: "percent",
  FLAT: "flat",
  FREE_DELIVERY: "free_delivery", // waives the delivery fee; discountValue is 0
});
export const AUDIENCES = Object.freeze({
  ALL: "all",
  NEW: "new", // no orders yet (other than cancelled or rejected ones)
  EXISTING: "existing",
});
export const COUPON_SOURCES = Object.freeze({ PLATFORM: "platform", RESTAURANT: "restaurant" });
/** A coupon needs a code; offers apply by themselves (the best one of each kind). */
export const COUPON_KINDS = Object.freeze({
  COUPON: "coupon",
  RESTAURANT_OFFER: "restaurant_offer", // funded by the restaurant
  PLATFORM_OFFER: "platform_offer",
  PAYMENT_OFFER: "payment_offer", // for online payments, optionally some channels only
});
/** The order discounts stack in: each applies to the food left after the ones before. */
export const STACK_ORDER = Object.freeze([
  COUPON_KINDS.RESTAURANT_OFFER,
  COUPON_KINDS.PLATFORM_OFFER,
  COUPON_KINDS.COUPON,
  COUPON_KINDS.PAYMENT_OFFER,
]);
/** How an online order is paid; payment offers can depend on it (cash orders have none). */
export const PAYMENT_CHANNELS = Object.freeze({
  UPI: "upi",
  CARD: "card",
  NETBANKING: "netbanking",
  WALLET: "wallet",
});
/**
 * A coupon's kind. Coupons saved before kinds existed have none: a restaurant's were its offers,
 * everything else a coupon (the same rule the Django migration applied).
 */
export const kindOf = (c) =>
  c.kind ??
  (c.source === COUPON_SOURCES.RESTAURANT ? COUPON_KINDS.RESTAURANT_OFFER : COUPON_KINDS.COUPON);
export const APPROVAL_STATUS = Object.freeze({
  DRAFT: "draft",
  PENDING: "pending",
  APPROVED: "approved",
  REJECTED: "rejected",
});
const ref = (model) => ({ type: mongoose.Schema.Types.ObjectId, ref: model, default: null });

const couponSchema = new mongoose.Schema(
  {
    code: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      match: /^[A-Z0-9_-]{3,30}$/,
    },
    name: { type: String, trim: true, maxlength: 80 },
    description: { type: String, trim: true, maxlength: 200 },
    terms: { type: String, trim: true, maxlength: 2000 },
    // Left out on old documents; read through kindOf() (Mongoose fills it in when loading).
    kind: {
      type: String,
      enum: Object.values(COUPON_KINDS),
      default() {
        return kindOf({ source: this.source });
      },
    },
    // Payment offers only: the online channels it is for; empty means any online payment.
    paymentChannels: { type: [{ type: String, enum: Object.values(PAYMENT_CHANNELS) }], default: [] },
    discountType: {
      type: String,
      enum: Object.values(DISCOUNT_TYPES),
      required: true,
    },
    // Percent (1-100), paise, or 0 for free delivery (checked below).
    discountValue: {
      type: Number,
      default: 0,
      min: 0,
      validate: Number.isInteger,
    },
    maxDiscountPaise: {
      type: Number,
      min: 0,
      default: null,
      validate: (v) => v === null || Number.isInteger(v),
    },
    minOrderPaise: {
      type: Number,
      default: 0,
      min: 0,
      validate: Number.isInteger,
    },
    validFrom: { type: Date, required: true },
    validUntil: { type: Date, required: true },
    isActive: { type: Boolean, default: true },
    usageLimit: { type: Number, min: 1, default: null },
    usedCount: { type: Number, default: 0, min: 0 },
    perUserLimit: { type: Number, min: 1, default: 1 },
    // Only valid at this restaurant (and, for restaurant offers, the restaurant that owns it).
    restaurant: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Restaurant",
      default: null,
    },
    // Further scope (empty: no limit). A discount on categories or dishes applies to those lines.
    restaurants: [{ type: mongoose.Schema.Types.ObjectId, ref: "Restaurant" }],
    categories: [{ type: mongoose.Schema.Types.ObjectId, ref: "FoodCategory" }],
    foodItems: [{ type: mongoose.Schema.Types.ObjectId, ref: "FoodItem" }],
    audience: { type: String, enum: Object.values(AUDIENCES), default: AUDIENCES.ALL },
    source: { type: String, enum: Object.values(COUPON_SOURCES), default: COUPON_SOURCES.PLATFORM },
    approvalStatus: {
      type: String,
      enum: Object.values(APPROVAL_STATUS),
      default: APPROVAL_STATUS.APPROVED,
    },
    rejectionReason: { type: String, trim: true, maxlength: 300 },
    reviewedBy: ref("User"),
    reviewedAt: { type: Date, default: null },
    bannerUrl: { type: String, trim: true, maxlength: 500 },
    createdBy: ref("User"),
  },
  {
    timestamps: true,
    toJSON: {
      versionKey: false,
      transform: (_doc, ret) => {
        ret.id = String(ret._id);
        delete ret._id;
        return ret;
      },
    },
  },
);

couponSchema.pre("validate", function checkCoupon() {
  if (this.source === COUPON_SOURCES.RESTAURANT) {
    this.kind = COUPON_KINDS.RESTAURANT_OFFER; // a restaurant's discounts are its automatic offers
  } else if (this.kind === COUPON_KINDS.RESTAURANT_OFFER) {
    this.invalidate("kind", "Restaurants create their own offers");
  }
  if (this.kind !== COUPON_KINDS.PAYMENT_OFFER) this.paymentChannels = [];
  if (this.discountType === DISCOUNT_TYPES.FREE_DELIVERY) {
    this.discountValue = 0;
    this.maxDiscountPaise = null;
  } else if (!(this.discountValue >= 1)) {
    this.invalidate("discountValue", "Discount must be a positive whole number");
  }
  if (this.source === COUPON_SOURCES.RESTAURANT && !this.restaurant) {
    this.invalidate("restaurant", "A restaurant offer needs its restaurant");
  }
  if (
    this.discountType === DISCOUNT_TYPES.PERCENT &&
    this.discountValue > 100
  ) {
    this.invalidate("discountValue", "A percentage discount cannot exceed 100");
  }
  if (this.validFrom && this.validUntil && this.validUntil <= this.validFrom) {
    this.invalidate("validUntil", "End date must be after the start date");
  }
});

couponSchema.index({ code: 1 }, { unique: true });
couponSchema.index({ kind: 1, isActive: 1, validUntil: 1 });
couponSchema.index({ isActive: 1, validUntil: 1 });
couponSchema.index({ source: 1, approvalStatus: 1 });

export const Coupon = mongoose.model("Coupon", couponSchema);

const redemptionSchema = new mongoose.Schema(
  {
    coupon: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Coupon",
      required: true,
    },
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    // One per discount on the order (a coupon plus automatic offers).
    order: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
      required: true,
    },
    discountPaise: { type: Number, required: true, min: 0 },
  },
  { timestamps: true },
);

redemptionSchema.index({ coupon: 1, user: 1 });
// Replaces the old unique { order: 1 } index (an order now has a redemption per discount).
redemptionSchema.index({ order: 1, coupon: 1 }, { unique: true });

export const CouponRedemption = mongoose.model(
  "CouponRedemption",
  redemptionSchema,
);
