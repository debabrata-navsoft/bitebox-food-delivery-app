import { PERMISSIONS, hasPermission } from "../config/permissions.js";
import { DOCUMENT_KINDS } from "../models/kyc-document.model.js";
import { Order } from "../models/order.model.js";
import { RESTAURANT_STATUS, Restaurant } from "../models/restaurant.model.js";
import { ROLES, USER_STATUS, User } from "../models/user.model.js";
import { ApiError } from "../utils/api-error.js";
import {
  ADDRESS_LINES,
  addressLines,
  aggregatePage,
  allOf,
  blank,
  distinctNames,
  facetsIf,
  fixedFacet,
  idSearch,
  inList,
  joinedRange,
  kycFilterStages,
  kycSummary,
  listOf,
  listSorts,
  NEWEST,
  openFacet,
  personSearch,
  ratingOf,
  sameName,
  textSearch,
} from "./admin-accounts.js";
import { orderStats } from "./admin-users.service.js";
import { diff } from "./audit.service.js";
import { commissionsFor } from "./earnings.service.js";
import { KYC_STATES, restaurantKycStages, reverify } from "./kyc.service.js";
import { adminSetStatus, applyDetails } from "./restaurant.service.js";

/**
 * The admin Restaurant accounts page (`restaurants:view`): the list, one restaurant's account
 * view, and the admin edit, status and "accepting orders" actions. Restaurant ids throughout.
 */

/**
 * The restaurant as its partner sees it (GET /my/restaurant), with the review fields always
 * present. The owner stays an id: the owner's account is sent next to it.
 */
export function restaurantJson(restaurant) {
  const json = restaurant.toJSON();
  return {
    ...json,
    owner: String(restaurant.owner?._id ?? restaurant.owner),
    status: restaurant.status,
    statusReason: restaurant.statusReason || null,
    reviewedAt: restaurant.reviewedAt ?? null,
  };
}

const ownerCard = (u) =>
  u
    ? {
        id: String(u._id),
        name: u.name ?? null,
        email: u.email ?? null,
        phone: u.phone ?? null,
        status: u.status,
        avatarUrl: u.avatarUrl ?? null,
      }
    : null;

/** Owners (restaurant partners) matching `filter`, as ids. */
const ownerIds = (filter) => User.distinct("_id", { role: ROLES.RESTAURANT, ...filter });

/** `status`, `accountStatus`, `city` (and `kyc`, see restaurantPipeline) take several values. */
async function listFilter({ search, status, accountStatus, city, joinedFrom, joinedTo }) {
  const joined = joinedRange(joinedFrom, joinedTo);
  const ownerStatus = inList("status", accountStatus);
  return allOf(
    inList("status", status),
    inList("address.city", city, sameName),
    joined && { createdAt: joined },
    ownerStatus && { owner: { $in: await ownerIds(ownerStatus) } },
    search && {
      $or: [
        ...textSearch(search, ["name", "slug"]).$or,
        { owner: { $in: await ownerIds({ $or: personSearch(search) }) } },
        idSearch(search),
      ].filter(Boolean),
    },
  );
}

/** The list's filter stages: the KYC state is computed for every matching restaurant when filtering by it. */
const restaurantPipeline = async (query) => [
  { $match: await listFilter(query) },
  ...kycFilterStages(query.kyc, restaurantKycStages),
];

/** The owner's account status, as `ownerAccount: [{ status }]`. */
const ownerStatusStages = [
  {
    $lookup: {
      from: User.collection.name,
      localField: "owner",
      foreignField: "_id",
      pipeline: [{ $project: { status: 1 } }],
      as: "ownerAccount",
    },
  },
];

const FACETS = {
  status: fixedFacet(Object.values(RESTAURANT_STATUS), "$status"),
  accountStatus: fixedFacet(Object.values(USER_STATUS), { $first: "$ownerAccount.status" }, ownerStatusStages),
  kyc: fixedFacet(KYC_STATES, "$kycStatus", restaurantKycStages),
  city: openFacet("$address.city"),
};

/** Every order placed with the restaurant (`orderCount`). */
const orderCountLookup = [
  {
    $lookup: {
      from: Order.collection.name,
      localField: "_id",
      foreignField: "restaurant",
      pipeline: [{ $group: { _id: null, n: { $sum: 1 } } }],
      as: "orderCount",
    },
  },
  { $addFields: { orderCount: { $ifNull: [{ $first: "$orderCount.n" }, 0] } } },
];

const SORTS = listSorts({
  orders: { orderCount: -1, ...NEWEST },
  rating: { "rating.average": -1, "rating.count": -1, ...NEWEST },
});

/**
 * GET /admin/restaurant-accounts. The KYC state and order count are computed in the database:
 * for every matching restaurant when filtering or sorting by them, otherwise for the page only.
 */
export async function listRestaurants(query, pagination) {
  const sort = query.sort ?? "newest";
  const pipeline = await restaurantPipeline(query);
  const kycFirst = listOf(query.kyc).length > 0;
  const ordersFirst = sort === "orders";
  if (ordersFirst) pipeline.push(...orderCountLookup);
  const rowStages = [
    ...(kycFirst ? [] : restaurantKycStages()),
    ...(ordersFirst ? [] : orderCountLookup),
    { $project: { kycStatus: 1, orderCount: 1 } },
  ];
  const [{ rows, pagination: meta }, facets] = await Promise.all([
    aggregatePage(Restaurant, pipeline, { sort, sorts: SORTS, rowStages }, pagination),
    facetsIf(query, Restaurant, FACETS, restaurantPipeline),
  ]);

  const ids = rows.map((r) => r._id);
  const [restaurants, commissions] = await Promise.all([
    Restaurant.find({ _id: { $in: ids } }).populate("owner", "name email phone status avatarUrl"),
    commissionsFor(ids),
  ]);
  const byId = new Map(restaurants.map((r) => [String(r._id), r]));
  return {
    items: rows
      .filter((row) => byId.has(String(row._id)))
      .map((row) => {
        const r = byId.get(String(row._id));
        return {
          id: String(r._id),
          name: r.name,
          slug: r.slug,
          imageUrl: r.imageUrl || null,
          city: r.address?.city ?? null,
          status: r.status,
          statusReason: r.statusReason || null,
          isAcceptingOrders: r.isAcceptingOrders,
          createdAt: r.createdAt,
          owner: ownerCard(r.owner),
          stats: { orders: row.orderCount, rating: ratingOf(r) },
          commissionPercent: commissions.get(String(r._id)).basisPoints / 100,
          kycStatus: row.kycStatus,
        };
      }),
    pagination: meta,
    ...facets,
  };
}

/** GET /admin/restaurant-accounts/cities: distinct cities, trimmed, A to Z, case-insensitively unique. */
export async function listCities() {
  return distinctNames(await Restaurant.distinct("address.city"));
}

async function findRestaurant(id) {
  const restaurant = await Restaurant.findById(id);
  if (!restaurant) throw ApiError.notFound("Restaurant not found");
  return restaurant;
}

/** GET /admin/restaurant-accounts/:id */
export async function restaurantDetail(id) {
  const restaurant = await findRestaurant(id);
  const [owner, stats, commissions, kyc] = await Promise.all([
    User.findById(restaurant.owner),
    orderStats({ restaurant: restaurant._id }),
    commissionsFor([restaurant._id]),
    kycSummary(Restaurant, restaurant._id, restaurantKycStages()),
  ]);
  const { basisPoints, source } = commissions.get(String(restaurant._id));
  return {
    restaurant: restaurantJson(restaurant),
    owner: owner?.toJSON() ?? null,
    stats: {
      orders: stats.orders,
      delivered: stats.delivered,
      cancelled: stats.cancelled,
      grossPaise: stats.spentPaise,
      lastOrderAt: stats.lastOrderAt,
      rating: ratingOf(restaurant),
    },
    commission: { percent: basisPoints / 100, source },
    kyc,
  };
}

// What an admin edit records: every partner-editable field in plain form, the address per line.
const AUDITED_FIELDS = [
  "name",
  "description",
  "cuisines",
  "phone",
  "email",
  ...ADDRESS_LINES,
  "location",
  "imageUrl",
  "isPureVeg",
  "costForTwoPaise",
  "minOrderPaise",
  "avgPrepTimeMinutes",
  "openingTime",
  "closingTime",
  "weeklyHours",
  "photos",
  "ownerName",
  "gstRegistered",
  "gstin",
  "fssaiNumber",
  "fssaiValidUntil",
];
const auditable = (r) => {
  const json = r.toJSON();
  return {
    ...Object.fromEntries(AUDITED_FIELDS.map((f) => [f, blank(json[f])])),
    ...addressLines(json.address),
    location: r.location ? { type: "Point", coordinates: [...r.location.coordinates] } : null,
    fssaiValidUntil: r.fssaiValidUntil ? r.fssaiValidUntil.toISOString().slice(0, 10) : null,
  };
};

// A changed number sends its approved document back for review.
const REVERIFY = { gstin: DOCUMENT_KINDS.GST_CERTIFICATE, fssaiNumber: DOCUMENT_KINDS.FSSAI_LICENCE };

/**
 * PATCH /admin/restaurant-accounts/:id: the partner-editable details (same rules as PATCH
 * /my/restaurant), but the approval status never changes. Returns { restaurant, changes }.
 */
export async function updateRestaurant(id, input) {
  const restaurant = await findRestaurant(id);
  const before = auditable(restaurant);
  await applyDetails(restaurant, input);
  const changes = diff(before, auditable(restaurant), AUDITED_FIELDS);
  if (!Object.keys(changes).length) return { restaurant: restaurantJson(restaurant), changes };
  await restaurant.save();
  const reverified = await reverify(
    restaurant.owner,
    Object.keys(REVERIFY)
      .filter((field) => changes[field])
      .map((field) => REVERIFY[field]),
  );
  if (reverified.length) changes.reverified = [...reverified].sort();
  return { restaurant: restaurantJson(restaurant), changes };
}

const STATUS_MESSAGES = {
  [RESTAURANT_STATUS.APPROVED]: "Restaurant approved",
  [RESTAURANT_STATUS.REJECTED]: "Restaurant rejected",
  [RESTAURANT_STATUS.SUSPENDED]: "Restaurant suspended",
  [RESTAURANT_STATUS.RESUBMISSION_REQUESTED]: "Asked for resubmission",
};

/** Suspending, and lifting a suspension, need restaurants:status; reviews restaurants:approve. */
export const statusPermission = (from, to) =>
  to === RESTAURANT_STATUS.SUSPENDED ||
  (to === RESTAURANT_STATUS.APPROVED && from === RESTAURANT_STATUS.SUSPENDED)
    ? PERMISSIONS.RESTAURANTS_STATUS
    : PERMISSIONS.RESTAURANTS_APPROVE;

/**
 * PATCH /admin/restaurant-accounts/:id/status: the admin status service (transitions, approval
 * checks, owner notice). The same status again changes nothing. Returns
 * { restaurant, changes, message }.
 */
export async function setStatus(actor, id, status, reason) {
  const restaurant = await findRestaurant(id);
  const from = restaurant.status;
  if (!hasPermission(actor, statusPermission(from, status)))
    throw ApiError.forbidden("You do not have access to this area");
  if (from === status)
    return { restaurant: restaurantJson(restaurant), changes: {}, message: STATUS_MESSAGES[status] };
  const updated = await adminSetStatus(id, status, reason, actor._id);
  return {
    restaurant: restaurantJson(updated),
    changes: { status: { from, to: status } },
    message:
      from === RESTAURANT_STATUS.SUSPENDED && status === RESTAURANT_STATUS.APPROVED
        ? "Restaurant reactivated"
        : STATUS_MESSAGES[status],
  };
}

/**
 * PATCH /admin/restaurant-accounts/:id/accepting-orders: closes (false) or reopens (true) the
 * restaurant for new orders, the partner's own switch. Returns { restaurant, changes }.
 */
export async function setAcceptingOrders(id, isAcceptingOrders) {
  const restaurant = await findRestaurant(id);
  const from = restaurant.isAcceptingOrders;
  if (from === isAcceptingOrders) return { restaurant: restaurantJson(restaurant), changes: {} };
  const updated = await Restaurant.findByIdAndUpdate(
    id,
    { isAcceptingOrders },
    { returnDocument: "after" },
  );
  if (!updated) throw ApiError.notFound("Restaurant not found");
  return {
    restaurant: restaurantJson(updated),
    changes: { isAcceptingOrders: { from, to: isAcceptingOrders } },
  };
}
