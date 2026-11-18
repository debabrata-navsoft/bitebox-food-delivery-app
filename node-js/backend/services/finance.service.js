import { EARNINGS } from "../config/earnings.js";
import {
  ORDER_STATUS,
  Order,
  PAYMENT_METHODS,
  PAYMENT_STATUS,
  Payment,
} from "../models/order.model.js";
import { PAYOUT_STATUS, PAYOUT_TYPES, Payout } from "../models/payout.model.js";
import { Restaurant } from "../models/restaurant.model.js";
import { User } from "../models/user.model.js";
import { ApiError } from "../utils/api-error.js";
import { paginationMeta } from "../utils/pagination.js";
import { orderStages, paymentPage, paymentSearch, paymentView } from "./payments/payment.service.js";
import {
  allOf,
  anyMatch,
  facetsIf,
  fixedFacet,
  flagFacet,
  idFacet,
  dayRange,
  filteredPage,
  inList,
  listOf,
  mapValues,
  textSearch,
  toId,
} from "./admin-accounts.js";
import { CommissionRule } from "../models/commission-rule.model.js";
import { RESTAURANT_FOOD_EXPR, restaurantFood } from "./earnings.service.js";
import { postPayoutPaid, postRefund } from "./ledger.service.js";
import { notify } from "./notification.service.js";
import { rupees } from "./order-notifications.js";
import { day, fillDays, since } from "./reports.service.js";

const S = ORDER_STATUS;
const P = PAYMENT_STATUS;

/** Each payout type: which order field links it, who the payee is, and their settlement share. */
const SIDE = {
  [PAYOUT_TYPES.RESTAURANT]: {
    link: "payouts.restaurant",
    payee: "$restaurant",
    // The restaurant's share net of refunds taken from it after delivery.
    share: {
      $subtract: [
        "$settlement.restaurantPaise",
        { $ifNull: ["$settlement.refundAdjustmentPaise", 0] },
      ],
    },
  },
  [PAYOUT_TYPES.RIDER]: {
    link: "payouts.rider",
    payee: "$deliveryPartner",
    share: "$settlement.riderPaise",
  },
};
/** Delivered, settled orders not yet in any payout of this type. */
const dueFilter = (type) => ({
  status: S.DELIVERED,
  "settlement.at": { $ne: null },
  [SIDE[type].link]: null,
});

async function dueTotals() {
  const [restaurant, rider] = await Promise.all(
    [PAYOUT_TYPES.RESTAURANT, PAYOUT_TYPES.RIDER].map((type) =>
      Order.aggregate([
        { $match: dueFilter(type) },
        { $group: { _id: null, paise: { $sum: SIDE[type].share } } },
      ]),
    ),
  );
  return {
    restaurantPaise: restaurant[0]?.paise ?? 0,
    riderPaise: rider[0]?.paise ?? 0,
  };
}

export async function dashboard(days) {
  const window = { createdAt: { $gte: since(days) } };
  const [[pay], daily, [settled], due, pendingPayouts] = await Promise.all([
    Payment.aggregate([
      { $match: window },
      {
        $group: {
          _id: null,
          transactions: { $sum: 1 },
          successful: { $sum: { $cond: [{ $in: ["$status", [P.PAID, P.REFUNDED]] }, 1, 0] } },
          failed: { $sum: { $cond: [{ $eq: ["$status", P.FAILED] }, 1, 0] } },
          pending: { $sum: { $cond: [{ $eq: ["$status", P.PENDING] }, 1, 0] } },
          collectedPaise: {
            $sum: { $cond: [{ $in: ["$status", [P.PAID, P.REFUNDED]] }, "$amountPaise", 0] },
          },
          refunds: { $sum: { $cond: [{ $eq: ["$status", P.REFUNDED] }, 1, 0] } },
          refundedPaise: {
            $sum: { $cond: [{ $eq: ["$status", P.REFUNDED] }, "$amountPaise", 0] },
          },
        },
      },
    ]),
    Payment.aggregate([
      { $match: { ...window, status: P.PAID } },
      { $group: { _id: day("$paidAt"), revenuePaise: { $sum: "$amountPaise" } } },
    ]),
    Order.aggregate([
      { $match: { status: S.DELIVERED, "settlement.at": { $gte: since(days) } } },
      {
        $group: {
          _id: null,
          platformPaise: { $sum: "$settlement.platformPaise" },
          restaurantPaise: { $sum: "$settlement.restaurantPaise" },
          riderPaise: { $sum: "$settlement.riderPaise" },
        },
      },
    ]),
    dueTotals(),
    Payout.aggregate([
      { $match: { status: PAYOUT_STATUS.PENDING } },
      { $group: { _id: null, n: { $sum: 1 }, paise: { $sum: "$amountPaise" } } },
    ]),
  ]);
  const collected = pay?.collectedPaise ?? 0;
  const refunded = pay?.refundedPaise ?? 0;
  return {
    days,
    totals: {
      // Money customers paid (cash collected on delivery counts once it is delivered).
      revenuePaise: collected - refunded,
      transactions: pay?.transactions ?? 0,
      successfulPayments: pay?.successful ?? 0,
      failedPayments: pay?.failed ?? 0,
      pendingPayments: pay?.pending ?? 0,
      refunds: pay?.refunds ?? 0,
      refundedPaise: refunded,
      platformCommissionPaise: settled?.platformPaise ?? 0,
      restaurantEarningsPaise: settled?.restaurantPaise ?? 0,
      riderEarningsPaise: settled?.riderPaise ?? 0,
      // Owed to partners: earned but not yet in a payout, plus payouts created but not yet paid.
      pendingPayoutPaise: due.restaurantPaise + due.riderPaise + (pendingPayouts[0]?.paise ?? 0),
      pendingPayoutBatches: pendingPayouts[0]?.n ?? 0,
    },
    daily: fillDays(days, daily, { revenuePaise: 0 }),
  };
}

/** One payment with its order, customer and settlement, for the transaction details view. */
export async function transaction(paymentId) {
  const payment = await Payment.findById(paymentId)
    .populate("user", "name email phone")
    .populate(
      "order",
      "orderNumber status pricing paymentMethod paymentStatus settlement restaurantSnapshot.name createdAt cancellation payouts",
    );
  if (!payment) throw ApiError.notFound("Transaction not found");
  const o = payment.order;
  return {
    id: String(payment._id),
    ...paymentView(payment),
    providerOrderId: payment.providerOrderId ?? null,
    providerPaymentId: payment.providerPaymentId ?? null,
    providerRefundId: payment.providerRefundId ?? null,
    createdAt: payment.createdAt,
    customer: payment.user
      ? {
          id: String(payment.user._id),
          name: payment.user.name,
          email: payment.user.email,
          phone: payment.user.phone ?? null,
        }
      : null,
    order: o
      ? {
          id: String(o._id),
          orderNumber: o.orderNumber,
          status: o.status,
          restaurantName: o.restaurantSnapshot?.name,
          pricing: o.pricing,
          settlement: o.settlement?.at ? o.settlement : null,
          cancellation: o.cancellation ?? null,
          paidOut: {
            restaurant: Boolean(o.payouts?.restaurant),
            rider: Boolean(o.payouts?.rider),
          },
          createdAt: o.createdAt,
        }
      : null,
  };
}

/** What each restaurant or rider is owed: delivered orders not yet in a payout. */
export async function payoutsDue(type) {
  const side = SIDE[type];
  const rows = await Order.aggregate([
    { $match: dueFilter(type) },
    {
      $group: {
        _id: side.payee,
        orders: { $sum: 1 },
        amountPaise: { $sum: side.share },
        from: { $min: "$settlement.at" },
        to: { $max: "$settlement.at" },
        restaurantName: { $first: "$restaurantSnapshot.name" },
      },
    },
    { $sort: { amountPaise: -1 } },
  ]);
  const names =
    type === PAYOUT_TYPES.RIDER
      ? new Map(
          (await User.find({ _id: { $in: rows.map((r) => r._id) } }).select("name")).map(
            (u) => [String(u._id), u.name],
          ),
        )
      : null;
  return {
    type,
    items: rows.map((r) => ({
      payeeId: String(r._id),
      name: names ? (names.get(String(r._id)) ?? "Unknown rider") : r.restaurantName,
      orders: r.orders,
      amountPaise: r.amountPaise,
      from: r.from,
      to: r.to,
    })),
  };
}

/**
 * Creates a payout for everything a payee is owed right now. Orders are claimed with one
 * conditional update, so an order can never land in two payouts even if two admins click at once.
 */
export async function createPayout(actor, type, payeeId, note) {
  const side = SIDE[type];
  let payee;
  let restaurant = null;
  if (type === PAYOUT_TYPES.RESTAURANT) {
    restaurant = await Restaurant.findById(payeeId).select("name owner");
    if (!restaurant) throw ApiError.notFound("Restaurant not found");
    payee = { id: restaurant.owner, name: restaurant.name };
  } else {
    const rider = await User.findById(payeeId).select("name role");
    if (!rider) throw ApiError.notFound("Rider not found");
    payee = { id: rider._id, name: rider.name };
  }
  const payout = await Payout.create({
    type,
    restaurant: restaurant?._id,
    payee: payee.id,
    payeeName: payee.name,
    note,
    createdBy: actor._id,
  });
  const match = {
    ...dueFilter(type),
    [type === PAYOUT_TYPES.RESTAURANT ? "restaurant" : "deliveryPartner"]: payeeId,
  };
  await Order.updateMany(match, { $set: { [side.link]: payout._id } });
  const [sum] = await Order.aggregate([
    { $match: { [side.link]: payout._id } },
    {
      $group: {
        _id: null,
        orders: { $sum: 1 },
        amountPaise: { $sum: side.share },
        from: { $min: "$settlement.at" },
        to: { $max: "$settlement.at" },
      },
    },
  ]);
  if (!sum) {
    await payout.deleteOne();
    throw ApiError.badRequest("Nothing is due for this payee");
  }
  Object.assign(payout, {
    orders: sum.orders,
    amountPaise: sum.amountPaise,
    periodFrom: sum.from,
    periodTo: sum.to,
  });
  return (await payout.save()).toJSON();
}

export async function markPayoutPaid(actor, id, reference) {
  const payout = await Payout.findOneAndUpdate(
    { _id: id, status: PAYOUT_STATUS.PENDING },
    { status: PAYOUT_STATUS.PAID, reference, paidBy: actor._id, paidAt: new Date() },
    { new: true },
  );
  if (!payout) throw ApiError.conflict("Only a pending payout can be marked as paid");
  await postPayoutPaid(payout);
  // The "settlement processed" event.
  await notify(payout.payee, {
    type: "payout.paid",
    title: `Payout of ${rupees(payout.amountPaise)} sent`,
    body: `For ${payout.orders} orders. Bank reference ${reference}.`,
    link: payout.type === PAYOUT_TYPES.RESTAURANT ? "/restaurant/earnings" : "/delivery/earnings",
  });
  return payout.toJSON();
}

/** Cancels a pending payout and releases its orders, so they show as due again. */
export async function cancelPayout(id, note) {
  const payout = await Payout.findOneAndUpdate(
    { _id: id, status: PAYOUT_STATUS.PENDING },
    { status: PAYOUT_STATUS.CANCELLED, ...(note && { note }) },
    { new: true },
  );
  if (!payout) throw ApiError.conflict("Only a pending payout can be cancelled");
  await Order.updateMany(
    { [SIDE[payout.type].link]: payout._id },
    { $set: { [SIDE[payout.type].link]: null } },
  );
  return payout.toJSON();
}

/** A rider payout's payee (the rider's user id); null for restaurant payouts. */
const RIDER_OF = { $cond: [{ $eq: ["$type", PAYOUT_TYPES.RIDER] }, "$payee", null] };

/**
 * The payout history's filter: type, status, restaurant and rider (each one value or several, any
 * of them; `rider` matches rider payouts only), the day created and a search over the payee's name
 * and the transfer reference.
 */
function payoutFilter({ type, status, restaurant, rider, createdFrom, createdTo, search }) {
  const riders = listOf(rider);
  return allOf(
    inList("type", type),
    inList("status", status),
    inList("restaurant", restaurant, toId),
    riders.length && { type: PAYOUT_TYPES.RIDER, payee: { $in: riders.map(toId) } },
    dayRange("createdAt", createdFrom, createdTo),
    textSearch(search, ["payeeName", "reference"]),
  );
}

/** The payout history's Filters panel (each facet is also the filter of the same name). */
const PAYOUT_FACETS = {
  status: fixedFacet(Object.values(PAYOUT_STATUS), "$status"),
  restaurant: idFacet("$restaurant", Restaurant),
  rider: idFacet(RIDER_OF, User),
};

/** Payouts matching `filterFor(query)`, newest first, with the `facets` counts when asked for. */
const payoutPage = (query, pagination, filterFor, facets) =>
  filteredPage(Payout, query, pagination, {
    filterFor,
    facets,
    find: (q) => q.sort({ createdAt: -1 }),
    map: (p) => p.toJSON(),
  });

export const listPayouts = (query, pagination) => payoutPage(query, pagination, payoutFilter, PAYOUT_FACETS);

const REFUNDED = [P.REFUNDED, P.PARTIALLY_REFUNDED];
const CLOSED = [S.CANCELLED, S.REJECTED];
/**
 * The refund queue's states, as matches (after orderStages) and as expressions (facet counts):
 * online payments of closed orders still paid (the automatic refund failed), and payments
 * refunded fully or partly.
 */
const REFUND_STATES = {
  needed: {
    match: { status: P.PAID, method: PAYMENT_METHODS.ONLINE, "o.status": { $in: CLOSED } },
    expr: {
      $and: [
        { $eq: ["$status", P.PAID] },
        { $eq: ["$method", PAYMENT_METHODS.ONLINE] },
        { $in: [{ $ifNull: ["$o.status", null] }, CLOSED] },
      ],
    },
  },
  refunded: { match: { status: { $in: REFUNDED } }, expr: { $in: ["$status", REFUNDED] } },
};
const stateMatches = mapValues(REFUND_STATES, (v) => v.match);

/** The refund queue's stages: state and restaurant (one value or several), last change days, search. */
async function refundStages({ state, restaurant, updatedFrom, updatedTo, search }) {
  return [
    {
      $match: allOf(
        { $or: [{ status: P.PAID, method: PAYMENT_METHODS.ONLINE }, { status: { $in: REFUNDED } }] },
        dayRange("updatedAt", updatedFrom, updatedTo),
        await paymentSearch(search),
      ),
    },
    ...orderStages(),
    {
      $match: allOf(
        { $or: Object.values(stateMatches) },
        anyMatch(state, stateMatches),
        inList("o.restaurant", restaurant, toId),
      ),
    },
  ];
}

const REFUND_FACETS = {
  state: flagFacet(mapValues(REFUND_STATES, (v) => v.expr)),
  restaurant: idFacet("$o.restaurant", Restaurant),
};

/**
 * Online payments refunded (fully or partly), plus paid ones of closed orders that still need a
 * refund (the automatic one failed); latest change first. `facets=1` adds the panel's counts.
 */
export async function refunds(query, pagination) {
  const [{ items, total }, facets] = await Promise.all([
    refundStages(query).then((stages) => paymentPage(stages, pagination, { updatedAt: -1, _id: -1 })),
    facetsIf(query, Payment, REFUND_FACETS, refundStages),
  ]);
  return {
    items: items.map((p) => ({
      id: String(p._id),
      ...paymentView(p),
      refundNeeded: p.status === P.PAID,
      customer: p.user ? { name: p.user.name, email: p.user.email } : null,
      order: p.order
        ? {
            id: String(p.order._id),
            orderNumber: p.order.orderNumber,
            status: p.order.status,
            reason: p.order.cancellation?.reason ?? null,
          }
        : null,
      updatedAt: p.updatedAt,
    })),
    pagination: paginationMeta(pagination, total),
    ...facets,
  };
}

/** The commission rates and what they earned per restaurant over the window. */
export async function commission(days) {
  const rows = await Order.aggregate([
    { $match: { status: S.DELIVERED, "settlement.at": { $gte: since(days) } } },
    {
      $group: {
        _id: "$restaurant",
        name: { $first: "$restaurantSnapshot.name" },
        orders: { $sum: 1 },
        foodPaise: { $sum: RESTAURANT_FOOD_EXPR },
        restaurantPaise: { $sum: "$settlement.restaurantPaise" },
        platformPaise: { $sum: "$settlement.platformPaise" },
      },
    },
    { $sort: { platformPaise: -1 } },
  ]);
  const items = rows.map((r) => ({
    restaurantId: String(r._id),
    name: r.name,
    orders: r.orders,
    foodPaise: r.foodPaise,
    commissionPaise: r.foodPaise - r.restaurantPaise,
    restaurantPaise: r.restaurantPaise,
    platformPaise: r.platformPaise,
  }));
  const sum = (field) => items.reduce((n, r) => n + r[field], 0);
  return {
    days,
    rates: {
      restaurantCommissionPercent: (await globalRate()) / 100,
      riderBasePaise: EARNINGS.riderBasePaise,
      riderPerKmPaise: EARNINGS.riderPerKmPaise,
    },
    totals: {
      orders: sum("orders"),
      foodPaise: sum("foodPaise"),
      commissionPaise: sum("commissionPaise"),
      platformPaise: sum("platformPaise"),
    },
    items,
  };
}

// Commission rules ----------------------------------------------------------------------------

async function globalRate() {
  const rule = await CommissionRule.findOne({ restaurant: null, effectiveTo: null }).lean();
  return rule?.basisPoints ?? EARNINGS.restaurantCommissionBasisPoints;
}

function ruleJson(r) {
  return {
    id: String(r._id),
    restaurant: r.restaurant ? { id: String(r.restaurant._id), name: r.restaurant.name } : null,
    basisPoints: r.basisPoints,
    percent: r.basisPoints / 100,
    effectiveFrom: r.effectiveFrom,
    effectiveTo: r.effectiveTo ?? null,
    note: r.note || null,
    createdBy: r.createdBy?.name ?? null,
  };
}

/** The global rate, every restaurant override in force, and the recent history. */
export async function commissionRules() {
  const populated = (q) => q.populate("restaurant", "name").populate("createdBy", "name").lean();
  const [rate, overrides, history] = await Promise.all([
    globalRate(),
    populated(CommissionRule.find({ restaurant: { $ne: null }, effectiveTo: null })),
    populated(CommissionRule.find().sort({ effectiveFrom: -1, _id: -1 }).limit(50)),
  ]);
  return {
    global: {
      basisPoints: rate,
      percent: rate / 100,
      defaultBasisPoints: EARNINGS.restaurantCommissionBasisPoints,
    },
    overrides: overrides
      .map(ruleJson)
      .sort((a, b) => a.restaurant.name.localeCompare(b.restaurant.name)),
    history: history.map(ruleJson),
  };
}

/** A new rate for a scope (restaurantId null = global): the open rule closes, a new one opens. */
export async function setCommission(actor, restaurantId, basisPoints, note) {
  if (restaurantId && !(await Restaurant.exists({ _id: restaurantId })))
    throw ApiError.notFound("Restaurant not found");
  const now = new Date();
  const scope = { restaurant: restaurantId || null, effectiveTo: null };
  await CommissionRule.updateOne(scope, { $set: { effectiveTo: now } });
  await CommissionRule.create({
    restaurant: restaurantId || null,
    basisPoints,
    effectiveFrom: now,
    note,
    createdBy: actor._id,
  });
  return commissionRules();
}

/** Removes a restaurant's own rate: the global one applies again. */
export async function clearCommission(restaurantId) {
  const { modifiedCount } = await CommissionRule.updateOne(
    { restaurant: restaurantId, effectiveTo: null },
    { $set: { effectiveTo: new Date() } },
  );
  if (!modifiedCount) throw ApiError.notFound("This restaurant has no commission of its own");
  return commissionRules();
}

// Refund deductions -----------------------------------------------------------------------------

/**
 * A refund finished on a delivered order: it comes off the restaurant's share while that is not
 * yet in a payout (never below zero); BiteBox carries the rest. Posted to the ledger once.
 */
export async function applyRefund(order, refundId, amount) {
  if (!order.settlement?.at) return;
  const { LedgerEntry } = await import("../models/ledger-entry.model.js");
  if (await LedgerEntry.exists({ key: `refund:${refundId}` })) return;
  let deducted = 0;
  if (!order.payouts?.restaurant) {
    const room = order.settlement.restaurantPaise - (order.settlement.refundAdjustmentPaise ?? 0);
    deducted = Math.max(0, Math.min(amount, room));
    if (deducted)
      await Order.updateOne(
        { _id: order._id, "payouts.restaurant": null },
        { $inc: { "settlement.refundAdjustmentPaise": deducted } },
      );
  }
  await postRefund(order, refundId, amount, deducted);
}

// Partner history and the settlement report --------------------------------------------------

/**
 * A partner's own payouts (`match`: { restaurant } or { type: "rider", payee }), filtered by
 * status (one value or several), the day created and a search; `facets=1` adds the status
 * counts, over this partner's payouts only.
 */
export const myPayouts = (match, pagination, query = {}) =>
  payoutPage(query, pagination, (q) => allOf(match, payoutFilter(q)), { status: PAYOUT_FACETS.status });

/** A settlement's payout state: due (in no payout yet; a cancelled payout releases its orders),
 * pending (in a payout being paid) or paid. */
export const SETTLEMENT_STATES = ["due", PAYOUT_STATUS.PENDING, PAYOUT_STATUS.PAID];

/**
 * A partner's settled orders (`match`) filtered by payout state (one value or several), the day
 * settled and a search over the order number. `payoutMatch` scopes the payout lookup to this
 * partner's payouts.
 */
async function settlementFilter(type, match, payoutMatch, { status, settledFrom, settledTo, search }) {
  const { link } = SIDE[type];
  const states = listOf(status);
  const inPayout = states.filter((s) => s !== "due");
  const payoutIds = inPayout.length
    ? await Payout.find({ ...payoutMatch, status: { $in: inPayout } }).distinct("_id")
    : [];
  return allOf(
    { ...match, status: S.DELIVERED, "settlement.at": { $ne: null } },
    states.length && {
      $or: [
        ...(states.includes("due") ? [{ [link]: null }] : []),
        ...(inPayout.length ? [{ [link]: { $in: payoutIds } }] : []),
      ],
    },
    dayRange("settlement.at", settledFrom, settledTo),
    textSearch(search, ["orderNumber"]),
  );
}

/** The settlement history's Filters panel: each order's payout state. */
const settlementFacets = (type) => ({
  status: fixedFacet(SETTLEMENT_STATES, { $ifNull: [{ $first: "$p.status" }, "due"] }, [
    {
      $lookup: {
        from: Payout.collection.name,
        localField: SIDE[type].link,
        foreignField: "_id",
        pipeline: [{ $project: { status: 1 } }],
        as: "p",
      },
    },
  ]),
});

/**
 * Per delivered order: what it paid this partner and whether it has been paid out. `facets=1`
 * adds the Filters panel's counts, over this partner's settlements only.
 */
export function settlementHistory(type, match, pagination, query = {}, payoutMatch = {}) {
  const link = type === PAYOUT_TYPES.RESTAURANT ? "restaurant" : "rider";
  return filteredPage(Order, query, pagination, {
    filterFor: (q) => settlementFilter(type, match, payoutMatch, q),
    facets: settlementFacets(type),
    find: (q) =>
      q
        .sort({ "settlement.at": -1, _id: -1 })
        .select("orderNumber pricing restaurantDiscountPaise settlement payouts")
        .populate(`payouts.${link}`, "status paidAt")
        .lean(),
    map: (o) => {
      const s = o.settlement;
      const food = restaurantFood(o);
      const adjustment = s.refundAdjustmentPaise ?? 0;
      const payout = o.payouts?.[link];
      return {
        orderId: String(o._id),
        orderNumber: o.orderNumber,
        settledAt: s.at,
        foodPaise: food,
        commissionBp: s.commissionBp ?? EARNINGS.restaurantCommissionBasisPoints,
        commissionPaise: food - s.restaurantPaise,
        refundAdjustmentPaise: adjustment,
        netPaise: type === PAYOUT_TYPES.RIDER ? s.riderPaise : s.restaurantPaise - adjustment,
        payout: payout ? { id: String(payout._id), status: payout.status, paidAt: payout.paidAt ?? null } : null,
      };
    },
  });
}

/** Text a spreadsheet would run as a formula (starts with = + - @, tab or CR): quote it. */
export const spreadsheetSafe = (text) => (/^[=+\-@\t\r]/.test(text) ? `'${text}` : text);

/** The settlement report (one row per delivered order) for spreadsheets and accountants. */
export async function settlementsCsv({ from, to } = {}) {
  const at = { $ne: null, ...(from && { $gte: from }), ...(to && { $lte: to }) };
  const orders = await Order.find({ status: S.DELIVERED, "settlement.at": at })
    .sort({ "settlement.at": 1 })
    .select("orderNumber restaurantSnapshot.name pricing settlement payouts")
    .populate("payouts.restaurant payouts.rider", "status")
    .lean();
  const money = (p) => ((p ?? 0) / 100).toFixed(2);
  const cell = (v) => (/[",\r\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  const rows = [
    [
      "Order", "Delivered at", "Restaurant", "Order total (₹)", "Tax (₹)", "Commission %",
      "Restaurant share (₹)", "Refund deduction (₹)", "Rider pay (₹)", "BiteBox share (₹)",
      "Restaurant payout", "Rider payout",
    ],
    ...orders.map((o) => [
      o.orderNumber,
      new Date(o.settlement.at).toISOString(),
      spreadsheetSafe(o.restaurantSnapshot?.name ?? ""), // partner-written
      money(o.pricing.totalPaise),
      money(o.pricing.taxPaise),
      (o.settlement.commissionBp ?? EARNINGS.restaurantCommissionBasisPoints) / 100,
      money(o.settlement.restaurantPaise),
      money(o.settlement.refundAdjustmentPaise),
      money(o.settlement.riderPaise),
      money(o.settlement.platformPaise),
      o.payouts?.restaurant?.status ?? "due",
      o.payouts?.rider?.status ?? "due",
    ]),
  ];
  return rows.map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}
