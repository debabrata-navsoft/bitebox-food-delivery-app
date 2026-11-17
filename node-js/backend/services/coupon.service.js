import crypto from "node:crypto";
import { env } from "../config/env.js";
import { PERMISSIONS } from "../config/permissions.js";
import {
  APPROVAL_STATUS,
  AUDIENCES,
  COUPON_KINDS,
  COUPON_SOURCES,
  Coupon,
  CouponRedemption,
  DISCOUNT_TYPES,
  kindOf,
} from "../models/coupon.model.js";
import { FoodItem } from "../models/food-item.model.js";
import { ORDER_STATUS, Order } from "../models/order.model.js";
import { ApiError } from "../utils/api-error.js";
import { escapeRegex, paginationMeta } from "../utils/pagination.js";
import { notify, notifyAdmins } from "./notification.service.js";
import { couponDiscount } from "./pricing.service.js";

/**
 * Coupons and restaurant offers (Django: apps/coupons/services.py): the eligibility engine used by
 * the cart and order placement, what customers see, admin management and analytics, restaurant
 * partners' own offers, and the approval queue.
 *
 * One engine decides everything: `problem()` says why a coupon cannot be used on a cart (or null),
 * `assertEligible()` throws it, and `couponBase()` is the part of the cart a category or dish
 * coupon applies to. Prices are always computed on the server, never by clients.
 */

// A typical basket for ranking offers on restaurant cards (what each would save on it).
const REFERENCE_ORDER_PAISE = 50_000;
const FREE_DELIVERY_VALUE_PAISE = 4_000;
const SCOPES = ["restaurants", "categories", "foodItems"];
const CHANNEL_LABELS = { upi: "UPI", card: "card", netbanking: "net banking", wallet: "wallet" };

let approvalOverride = null;
/** Tests: require approval of restaurant offers (true/false), or null for the configured value. */
export const useOfferApproval = (value) => (approvalOverride = value);
const approvalRequired = () => approvalOverride ?? env.offerApprovalRequired;

// ---------------------------------------------------------------------------
// Eligibility engine
// ---------------------------------------------------------------------------
const invalid = (message, code = "COUPON_INVALID") => new ApiError(422, message, { code });
const fieldError = (field, message) =>
  new ApiError(422, "Validation failed", { code: "VALIDATION_ERROR", details: [{ field, message }] });
const ids = (list) => (list ?? []).map((x) => String(x?._id ?? x));

/**
 * Coupons saved before offers existed have no `approvalStatus`, `source` or `restaurants`
 * (Mongoose fills the defaults only when reading), so queries treat a missing field as its
 * default: approved, a platform coupon, every restaurant.
 */
const APPROVED = { $in: [APPROVAL_STATUS.APPROVED, null] };
const platformWide = { restaurant: null, "restaurants.0": { $exists: false } };

/** Coupons of one kind. Old ones have no `kind`: a restaurant's are its offers, others coupons. */
export function kindFilter(kind) {
  if (kind === COUPON_KINDS.COUPON)
    return { $or: [{ kind }, { kind: null, source: { $ne: COUPON_SOURCES.RESTAURANT } }] };
  if (kind === COUPON_KINDS.RESTAURANT_OFFER)
    return { $or: [{ kind }, { kind: null, source: COUPON_SOURCES.RESTAURANT }] };
  return { kind };
}

/** Coupons a customer may see now: approved, switched on, inside their dates, not used up. */
export const visibleFilter = (now = new Date()) => ({
  approvalStatus: APPROVED,
  isActive: true,
  validFrom: { $lte: now },
  validUntil: { $gte: now },
  $or: [{ usageLimit: null }, { $expr: { $lt: ["$usedCount", "$usageLimit"] } }],
});

/** No orders yet, other than ones that were cancelled or rejected. */
export async function isNewCustomer(userId) {
  return !(await Order.exists({
    customer: userId,
    status: { $nin: [ORDER_STATUS.CANCELLED, ORDER_STATUS.REJECTED] },
  }));
}

const restaurantIds = (c) => {
  const set = new Set(ids(c.restaurants));
  if (c.restaurant) set.add(String(c.restaurant?._id ?? c.restaurant));
  return set;
};

/** What a category or dish coupon applies to: those lines' total (null: the whole cart). */
export function couponBase(c, lines) {
  const categories = new Set(ids(c.categories));
  const items = new Set(ids(c.foodItems));
  if ((!categories.size && !items.size) || !lines) return null;
  return lines
    .filter((l) => items.has(String(l.foodItemId)) || categories.has(String(l.categoryId)))
    .reduce((sum, l) => sum + l.totalPaise, 0);
}

/** How many times this customer has redeemed each of these coupons (by coupon id). */
export async function redemptionCounts(userId, couponIds) {
  const counts = await CouponRedemption.aggregate([
    { $match: { user: userId, coupon: { $in: couponIds } } },
    { $group: { _id: "$coupon", n: { $sum: 1 } } },
  ]);
  return new Map(counts.map((r) => [String(r._id), r.n]));
}

/**
 * Why this coupon cannot be used on this cart, or null. The one place the rules live.
 * `newCustomer` and `used` (this customer's redemptions of it) are looked up when not given.
 * `payment` is the online channel the customer picked (null for cash), which payment offers
 * depend on.
 */
export async function problem(
  c,
  {
    userId,
    restaurantId,
    subtotalPaise,
    lines = null,
    newCustomer = null,
    used = null,
    payment = null,
    now = new Date(),
  },
  session = null,
) {
  if (!c.isActive || c.approvalStatus !== APPROVAL_STATUS.APPROVED)
    return invalid("This coupon code is not valid");
  if (now < c.validFrom) return invalid("This coupon is not active yet", "COUPON_NOT_STARTED");
  if (now > c.validUntil) return invalid("This coupon has expired", "COUPON_EXPIRED");
  const restaurants = restaurantIds(c);
  if (restaurants.size && !restaurants.has(String(restaurantId)))
    return invalid("This coupon is not valid at this restaurant", "COUPON_NOT_APPLICABLE");
  if (kindOf(c) === COUPON_KINDS.PAYMENT_OFFER && !paysWith(c, payment))
    return invalid(`Pay ${channelsLabel(c)} to use this offer`, "COUPON_PAYMENT_METHOD");
  if (c.audience !== AUDIENCES.ALL) {
    const isNew = newCustomer ?? (await isNewCustomer(userId));
    if (c.audience === AUDIENCES.NEW && !isNew)
      return invalid("This coupon is only for new customers", "COUPON_NEW_CUSTOMERS");
    if (c.audience === AUDIENCES.EXISTING && isNew)
      return invalid("This coupon is for customers who have ordered before", "COUPON_EXISTING_CUSTOMERS");
  }
  if (subtotalPaise < c.minOrderPaise) {
    return invalid(
      `Add items worth ₹${((c.minOrderPaise - subtotalPaise) / 100).toFixed(0)} more to use this coupon`,
      "COUPON_MIN_ORDER",
    );
  }
  if (couponBase(c, lines) === 0)
    return invalid("This coupon does not apply to the dishes in your cart", "COUPON_NOT_APPLICABLE");
  if (c.usageLimit !== null && c.usedCount >= c.usageLimit)
    return invalid("This coupon has been fully redeemed", "COUPON_EXHAUSTED");
  used ??= await CouponRedemption.countDocuments({ coupon: c._id, user: userId }).session(session);
  if (used >= c.perUserLimit) return invalid("You have already used this coupon", "COUPON_USED");
  return null;
}

/** A payment offer needs an online payment, through one of its channels when it lists any. */
export const paysWith = (c, payment) =>
  Boolean(payment) && (!c.paymentChannels?.length || c.paymentChannels.includes(payment));

/** "online", or "by UPI or card". */
const channelsLabel = (c) => {
  const names = (c.paymentChannels ?? []).map((ch) => CHANNEL_LABELS[ch] ?? ch);
  return names.length ? `by ${names.join(" or ")}` : "online";
};

export async function assertEligible(code, context, session = null, kinds = [COUPON_KINDS.COUPON]) {
  const coupon = await Coupon.findOne({ code: String(code).trim().toUpperCase() }).session(session);
  if (!coupon) throw invalid("This coupon code is not valid");
  // Offers apply by themselves; only coupons are entered as codes.
  if (!kinds.includes(kindOf(coupon)))
    throw invalid("This offer is applied automatically at checkout", "COUPON_AUTOMATIC");
  const error = await problem(coupon, context, session);
  if (error) throw error;
  return coupon;
}

/** What the offer saves on a typical order, to rank offers against each other. */
export function offerValue(c) {
  if (c.discountType === DISCOUNT_TYPES.FREE_DELIVERY) return FREE_DELIVERY_VALUE_PAISE;
  return couponDiscount(c, Math.max(c.minOrderPaise, REFERENCE_ORDER_PAISE));
}

// ---------------------------------------------------------------------------
// What customers see
// ---------------------------------------------------------------------------
const ref = (doc, fields) =>
  doc && doc._id ? Object.fromEntries([["id", String(doc._id)], ...fields.map((f) => [f, doc[f]])]) : null;
const scopeJson = (c) => ({
  restaurants: (c.restaurants ?? []).filter((r) => r?._id).map((r) => ref(r, ["name", "slug"])),
  categories: (c.categories ?? []).filter((x) => x?._id).map((x) => ref(x, ["name"])),
  foodItems: (c.foodItems ?? []).filter((x) => x?._id).map((x) => ref(x, ["name"])),
});
const populated = (query) =>
  query
    .populate("restaurant", "name slug owner")
    .populate("restaurants", "name slug")
    .populate("categories", "name")
    .populate("foodItems", "name");

/** A coupon as customers see it (no usage counts or internal fields). */
export const offerJson = (c) => ({
  id: String(c._id),
  code: c.code,
  name: c.name || null,
  description: c.description || null,
  terms: c.terms || null,
  kind: kindOf(c),
  paymentChannels: [...(c.paymentChannels ?? [])],
  discountType: c.discountType,
  discountValue: c.discountValue,
  maxDiscountPaise: c.maxDiscountPaise,
  minOrderPaise: c.minOrderPaise,
  validUntil: c.validUntil,
  audience: c.audience,
  source: c.source,
  bannerUrl: c.bannerUrl || null,
  restaurant: ref(c.restaurant, ["name", "slug"]),
  ...scopeJson(c),
});

/** Coupons usable at this restaurant: its own, ones listing it, and platform-wide ones. */
const forRestaurant = (restaurantId) => ({
  $or: [{ restaurant: restaurantId }, { restaurants: restaurantId }, platformWide],
});

/** Drops coupons this customer cannot use (wrong audience, or their uses are spent). */
async function usableBy(user, coupons) {
  if (!user) return coupons;
  const [isNew, used] = await Promise.all([
    isNewCustomer(user._id),
    redemptionCounts(user._id, coupons.map((c) => c._id)),
  ]);
  return coupons.filter(
    (c) =>
      (c.audience === AUDIENCES.ALL || (c.audience === AUDIENCES.NEW) === isNew) &&
      (used.get(String(c._id)) ?? 0) < c.perUserLimit,
  );
}

const best = (list) => [...list].sort((a, b) => offerValue(b) - offerValue(a));

/** Live coupons for an order from this restaurant (platform-wide only when none is given). */
export const usableAt = (restaurantId) =>
  populated(
    Coupon.find({ $and: [visibleFilter(), restaurantId ? forRestaurant(restaurantId) : platformWide] })
      .sort({ validUntil: 1 })
      .limit(60),
  );

/** Checkout's coupon codes: platform-wide ones plus this restaurant's, for this customer. */
export async function listAvailable({ restaurantId, user = null } = {}) {
  const codes = (await usableAt(restaurantId)).filter((c) => kindOf(c) === COUPON_KINDS.COUPON);
  return best(await usableBy(user, codes)).map(offerJson);
}

export const OFFER_KINDS = {
  percent: { discountType: DISCOUNT_TYPES.PERCENT },
  flat: { discountType: DISCOUNT_TYPES.FLAT },
  free_delivery: { discountType: DISCOUNT_TYPES.FREE_DELIVERY },
  first_order: { audience: AUDIENCES.NEW },
  restaurant: kindFilter(COUPON_KINDS.RESTAURANT_OFFER),
  coupon: kindFilter(COUPON_KINDS.COUPON),
  payment: kindFilter(COUPON_KINDS.PAYMENT_OFFER),
  category: { $or: [{ "categories.0": { $exists: true } }, { "foodItems.0": { $exists: true } }] },
};

/** The Offers page: every offer the customer can use, best first, optionally of one kind. */
export async function customerOffers(user, kind) {
  const coupons = await populated(
    Coupon.find({ $and: [visibleFilter(), OFFER_KINDS[kind] ?? {}] }).limit(100),
  );
  return best(await usableBy(user, coupons)).map(offerJson);
}

/** A restaurant page's "Offers & deals": its own offers first, then platform-wide ones. */
export async function restaurantOffers(restaurant) {
  const coupons = await populated(
    Coupon.find({ $and: [visibleFilter(), forRestaurant(restaurant._id)] }),
  );
  return coupons
    .map((c) => ({ c, own: restaurantIds(c).size > 0 }))
    .sort((a, b) => Number(b.own) - Number(a.own) || offerValue(b.c) - offerValue(a.c))
    .map(({ c }) => offerJson(c));
}

/** Restaurant cards: each restaurant's best own offer (most saved on a typical order). */
export async function bestOffers(restaurantIdList) {
  const wanted = new Set(restaurantIdList.map(String));
  if (!wanted.size) return {};
  const list = [...wanted];
  const coupons = await Coupon.find({
    $and: [visibleFilter(), { $or: [{ restaurant: { $in: list } }, { restaurants: { $in: list } }] }],
  });
  const byRestaurant = new Map();
  for (const c of coupons)
    for (const rid of restaurantIds(c))
      if (wanted.has(rid)) byRestaurant.set(rid, [...(byRestaurant.get(rid) ?? []), c]);
  const badge = (top, count) => ({
    code: top.code,
    kind: kindOf(top),
    name: top.name || null,
    discountType: top.discountType,
    discountValue: top.discountValue,
    maxDiscountPaise: top.maxDiscountPaise,
    minOrderPaise: top.minOrderPaise,
    audience: top.audience,
    count,
  });
  return Object.fromEntries([...byRestaurant].map(([rid, offers]) => [rid, badge(best(offers)[0], offers.length)]));
}

// ---------------------------------------------------------------------------
// Management (admins and restaurant partners)
// ---------------------------------------------------------------------------
/** One word for lists: draft, pending, rejected, paused, scheduled, expired or active. */
export function statusOf(c, now = new Date()) {
  if (c.approvalStatus !== APPROVAL_STATUS.APPROVED) return c.approvalStatus;
  if (!c.isActive) return "paused";
  if (now < c.validFrom) return "scheduled";
  if (now > c.validUntil || (c.usageLimit !== null && c.usedCount >= c.usageLimit)) return "expired";
  return "active";
}

export const couponJson = (c) => {
  const json = c.toJSON();
  return {
    ...json,
    name: c.name || null,
    terms: c.terms || null,
    kind: kindOf(c),
    paymentChannels: [...(c.paymentChannels ?? [])],
    rejectionReason: c.rejectionReason || null,
    bannerUrl: c.bannerUrl || null,
    createdBy: c.createdBy ? String(c.createdBy) : null,
    restaurant: c.restaurant?._id ? ref(c.restaurant, ["name", "slug"]) : c.restaurant ? String(c.restaurant) : null,
    status: statusOf(c),
    ...scopeJson(c),
  };
};

export const STATUS_FILTERS = {
  active: (now) => ({ approvalStatus: APPROVED, isActive: true, validFrom: { $lte: now }, validUntil: { $gte: now } }),
  scheduled: (now) => ({ approvalStatus: APPROVED, validFrom: { $gt: now } }),
  expired: (now) => ({ validUntil: { $lt: now } }),
  paused: () => ({ approvalStatus: APPROVED, isActive: false }),
  draft: () => ({ approvalStatus: APPROVAL_STATUS.DRAFT }),
  pending: () => ({ approvalStatus: APPROVAL_STATUS.PENDING }),
  rejected: () => ({ approvalStatus: APPROVAL_STATUS.REJECTED }),
};
export const SORTS = {
  newest: { createdAt: -1 },
  oldest: { createdAt: 1 },
  expiring: { validUntil: 1 },
  most_used: { usedCount: -1 },
  code: { code: 1 },
};

async function list(base, query, pagination) {
  const now = new Date();
  const and = [base];
  if (query.search) {
    const pattern = new RegExp(escapeRegex(query.search), "i");
    and.push({ $or: [{ code: pattern }, { name: pattern }] });
  }
  if (query.active !== undefined) and.push({ isActive: query.active });
  if (query.status) and.push(STATUS_FILTERS[query.status](now));
  if (query.kind) and.push(kindFilter(query.kind));
  if (query.owner)
    and.push({ source: query.owner === COUPON_SOURCES.PLATFORM ? { $in: [query.owner, null] } : query.owner });
  if (query.from) and.push({ validUntil: { $gte: new Date(query.from) } });
  if (query.to) and.push({ validFrom: { $lte: new Date(query.to) } });
  if (query.restaurant) {
    and.push({ $or: [{ restaurant: query.restaurant }, { restaurants: query.restaurant }] });
  }
  const filter = { $and: and };
  const [items, total] = await Promise.all([
    populated(
      Coupon.find(filter)
        .sort(SORTS[query.sort] ?? SORTS.newest)
        .skip(pagination.skip)
        .limit(pagination.limit),
    ),
    Coupon.countDocuments(filter),
  ]);
  return { items: items.map(couponJson), pagination: paginationMeta(pagination, total) };
}

export const adminList = (query, pagination) => list({}, query, pagination);

/** Counts by status, redemptions and the discount given (aggregates only, no customers). */
async function summary(base) {
  const now = new Date();
  const couponIds = await Coupon.distinct("_id", base);
  const [counts, [{ totals: [totals], top }]] = await Promise.all([
    Promise.all(
      Object.entries(STATUS_FILTERS).map(async ([key, rule]) => [
        key,
        await Coupon.countDocuments({ $and: [base, rule(now)] }),
      ]),
    ),
    CouponRedemption.aggregate([
      { $match: { coupon: { $in: couponIds } } },
      {
        $facet: {
          totals: [{ $group: { _id: null, n: { $sum: 1 }, d: { $sum: "$discountPaise" } } }],
          top: [
            { $group: { _id: "$coupon", redemptions: { $sum: 1 }, discountPaise: { $sum: "$discountPaise" } } },
            { $sort: { redemptions: -1 } },
            { $limit: 5 },
            { $lookup: { from: "coupons", localField: "_id", foreignField: "_id", as: "c" } },
          ],
        },
      },
    ]),
  ]);
  return {
    total: couponIds.length,
    ...Object.fromEntries(counts),
    redemptions: totals?.n ?? 0,
    discountGivenPaise: totals?.d ?? 0,
    top: top.map((r) => ({
      id: String(r._id),
      code: r.c[0]?.code ?? null,
      redemptions: r.redemptions,
      discountPaise: r.discountPaise,
    })),
  };
}

export const adminAnalytics = () => summary({});

const FIELDS = [
  "code",
  "name",
  "description",
  "terms",
  "discountType",
  "discountValue",
  "maxDiscountPaise",
  "minOrderPaise",
  "validFrom",
  "validUntil",
  "isActive",
  "usageLimit",
  "perUserLimit",
  "restaurant",
  "audience",
  "bannerUrl",
  "kind",
  "paymentChannels",
  ...SCOPES,
];
const pick = (source) =>
  Object.fromEntries(FIELDS.filter((k) => source[k] !== undefined).map((k) => [k, source[k]]));

/** A fresh code nobody has, e.g. BB7K2QX9 (letters and digits that are hard to misread). */
export async function generateCode(prefix = "BB") {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  for (;;) {
    const code = prefix + Array.from({ length: 6 }, () => alphabet[crypto.randomInt(alphabet.length)]).join("");
    if (!(await Coupon.exists({ code }))) return code;
  }
}

async function save(coupon) {
  if (!coupon.code) coupon.code = await generateCode();
  await coupon.save();
  return populated(Coupon.findById(coupon._id));
}

export async function create(input, by = null) {
  const coupon = new Coupon({
    ...pick(input),
    source: COUPON_SOURCES.PLATFORM,
    approvalStatus: APPROVAL_STATUS.APPROVED,
    createdBy: by,
  });
  return save(coupon);
}

/** The coupon a query finds, or a 404. */
async function found(query, message = "Coupon not found") {
  const coupon = await query;
  if (!coupon) throw ApiError.notFound(message);
  return coupon;
}
const adminGetDoc = (id) => found(Coupon.findById(id));

export const adminGet = (id) => found(populated(Coupon.findById(id)));

export async function update(id, input) {
  const coupon = await adminGetDoc(id);
  Object.assign(coupon, pick(input));
  return save(coupon);
}

export async function setActive(id, isActive) {
  return save(Object.assign(await adminGetDoc(id), { isActive }));
}

/** A switched-off copy with a new code, to edit and start later. */
export async function duplicate(id, by = null) {
  const original = await adminGetDoc(id);
  const copy = new Coupon({
    ...pick(original.toObject()),
    source: original.source,
    approvalStatus: original.approvalStatus,
    createdBy: by,
    isActive: false,
  });
  copy.code = await generateCode(`${original.code.slice(0, 20)}-`);
  return save(copy);
}

export async function remove(id) {
  if (await CouponRedemption.exists({ coupon: id })) {
    throw ApiError.conflict("This coupon has been used. Deactivate it instead.");
  }
  const deleted = await Coupon.findByIdAndDelete(id);
  if (!deleted) throw ApiError.notFound("Coupon not found");
}

// --- the approval queue ------------------------------------------------------------------------
export const pending = (pagination) =>
  list({ source: COUPON_SOURCES.RESTAURANT, approvalStatus: APPROVAL_STATUS.PENDING }, {}, pagination);

/** Approves or rejects a restaurant offer waiting for review; the partner is told. */
export async function review(id, approve, reason, by) {
  const coupon = await found(populated(Coupon.findById(id)));
  if (coupon.source !== COUPON_SOURCES.RESTAURANT || coupon.approvalStatus !== APPROVAL_STATUS.PENDING)
    throw ApiError.conflict("This offer is not waiting for review");
  if (!approve && !String(reason ?? "").trim()) throw fieldError("reason", "Say why the offer is rejected");
  coupon.approvalStatus = approve ? APPROVAL_STATUS.APPROVED : APPROVAL_STATUS.REJECTED;
  coupon.rejectionReason = approve ? undefined : String(reason).trim();
  coupon.reviewedBy = by;
  coupon.reviewedAt = new Date();
  await coupon.save();
  const ownerId = coupon.restaurant?.owner;
  if (ownerId) {
    await notify(ownerId, {
      type: approve ? "offer.approved" : "offer.rejected",
      title: `Offer ${coupon.code} ${approve ? "approved" : "not approved"}`,
      body: approve ? "It is live for customers within its dates." : `Reason: ${coupon.rejectionReason}`,
      link: "/restaurant/offers",
    });
  }
  return coupon;
}

// --- restaurant partners' own offers -----------------------------------------------------------
const ownFilter = (restaurant) => ({ restaurant: restaurant._id, source: COUPON_SOURCES.RESTAURANT });
const own = (restaurant, id) => found(Coupon.findOne({ _id: id, ...ownFilter(restaurant) }), "Offer not found");

/** Partners pick dishes from their own menu only, and cannot target other restaurants. */
async function checkOwnItems(restaurant, input) {
  const items = input.foodItems ?? [];
  if (items.length && (await FoodItem.exists({ _id: { $in: items }, restaurant: { $ne: restaurant._id } })))
    throw fieldError("foodItems", "Choose dishes from your own menu");
  const { restaurants: _r, restaurant: _o, kind: _k, paymentChannels: _p, ...rest } = input;
  return rest;
}

async function submit(coupon, draft, restaurant) {
  if (draft) {
    coupon.approvalStatus = APPROVAL_STATUS.DRAFT;
    return;
  }
  if (!approvalRequired()) {
    coupon.approvalStatus = APPROVAL_STATUS.APPROVED;
    return;
  }
  coupon.approvalStatus = APPROVAL_STATUS.PENDING;
  coupon.rejectionReason = undefined;
  await notifyAdmins(
    { type: "offer.review", title: `Offer to review: ${coupon.code}`, body: restaurant.name, link: "/admin/coupons/review" },
    PERMISSIONS.CATALOG_MANAGE,
  );
}

export const ownList = (restaurant, query, pagination) => list(ownFilter(restaurant), query, pagination);

export const ownGet = (restaurant, id) =>
  found(populated(Coupon.findOne({ _id: id, ...ownFilter(restaurant) })), "Offer not found");

export async function ownCreate(restaurant, { draft = false, ...input }, by) {
  const coupon = new Coupon({
    ...pick(await checkOwnItems(restaurant, input)),
    source: COUPON_SOURCES.RESTAURANT,
    restaurant: restaurant._id,
    createdBy: by,
  });
  if (!coupon.code) coupon.code = await generateCode();
  await submit(coupon, draft, restaurant);
  return save(coupon);
}

/** Any change to an offer sends it for review again (when approval is on). */
export async function ownUpdate(restaurant, id, { draft = false, ...input }) {
  const coupon = await own(restaurant, id);
  Object.assign(coupon, pick(await checkOwnItems(restaurant, input)));
  await submit(coupon, draft, restaurant);
  return save(coupon);
}

/** Pause or resume. Resuming never skips review: only approved offers reach customers. */
export async function ownSetActive(restaurant, id, isActive) {
  return save(Object.assign(await own(restaurant, id), { isActive }));
}

export async function ownRemove(restaurant, id) {
  await remove((await own(restaurant, id))._id);
}

export const ownAnalytics = (restaurant) => summary(ownFilter(restaurant));
