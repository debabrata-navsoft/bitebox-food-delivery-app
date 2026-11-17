import { ORDER_STATUS, Order } from "../models/order.model.js";
import { ROLES, USER_STATUS, User } from "../models/user.model.js";
import { ApiError } from "../utils/api-error.js";
import {
  aggregatePage,
  allOf,
  anyMatch,
  facetsIf,
  flagFacet,
  idSearch,
  inList,
  joinedRange,
  listSorts,
  NEWEST,
  personSearch,
  USER_STATUS_FACET,
} from "./admin-accounts.js";
import { sendEmailVerification, sendPasswordReset } from "./auth.service.js";

/**
 * The admin Customers page (`customers:view`) and its account help actions (`customers:edit`).
 * Only accounts with the customer role are reachable: any other id answers 404.
 */

/** Admin-sent links: at most one of each kind per customer per minute. */
export const HELP_LINK_GAP_MS = 60_000;

/** The `verification` filter values: [field, verified?]. */
const VERIFICATION = {
  email_verified: ["emailVerifiedAt", true],
  email_unverified: ["emailVerifiedAt", false],
  phone_verified: ["phoneVerifiedAt", true],
  phone_unverified: ["phoneVerifiedAt", false],
};
/** `{ value: condition(field, verified) }` for every verification value. */
const byVerification = (condition) =>
  Object.fromEntries(
    Object.entries(VERIFICATION).map(([value, [field, verified]]) => [value, condition(field, verified)]),
  );
const VERIFICATION_MATCH = byVerification((field, verified) => ({ [field]: verified ? { $ne: null } : null }));

/** `status` and `verification` take several values: OR within one, AND across filters. */
function customerFilter({ search, status, verification, joinedFrom, joinedTo }) {
  const joined = joinedRange(joinedFrom, joinedTo);
  return allOf(
    { role: ROLES.CUSTOMER },
    inList("status", status),
    anyMatch(verification, VERIFICATION_MATCH),
    joined && { createdAt: joined },
    search && { $or: [...personSearch(search), idSearch(search)].filter(Boolean) },
  );
}

const isSet = (field) => ({ $ne: [{ $ifNull: [`$${field}`, null] }, null] });
const FACETS = {
  status: USER_STATUS_FACET,
  verification: flagFacet(byVerification((field, verified) => (verified ? isSet(field) : { $not: [isSet(field)] }))),
};

/** The list's order figures: every order placed, delivered total, newest order. */
const statsLookup = {
  $lookup: {
    from: Order.collection.name,
    localField: "_id",
    foreignField: "customer",
    pipeline: [
      {
        $group: {
          _id: null,
          orders: { $sum: 1 },
          spentPaise: {
            $sum: { $cond: [{ $eq: ["$status", ORDER_STATUS.DELIVERED] }, "$pricing.totalPaise", 0] },
          },
          lastOrderAt: { $max: "$createdAt" },
        },
      },
    ],
    as: "stats",
  },
};

const SORTS = listSorts({
  orders: { sortValue: -1, ...NEWEST },
  spent: { sortValue: -1, ...NEWEST },
});

/**
 * GET /admin/customers: a page of customers with their order figures. Sorting by orders or spend
 * joins every matching customer's figures in the database; other sorts join only the page.
 */
export async function listCustomers(query, pagination) {
  const sort = query.sort ?? "newest";
  const pipeline = [{ $match: customerFilter(query) }];
  const byStats = sort === "orders" || sort === "spent";
  if (byStats) {
    const field = sort === "orders" ? "orders" : "spentPaise";
    pipeline.push(statsLookup, {
      $addFields: { sortValue: { $ifNull: [{ $first: `$stats.${field}` }, 0] } },
    });
  }
  const [{ rows, pagination: meta }, facets] = await Promise.all([
    aggregatePage(
      User,
      pipeline,
      { sort, sorts: SORTS, rowStages: [...(byStats ? [] : [statsLookup]), { $project: { stats: 1 } }] },
      pagination,
    ),
    facetsIf(query, User, FACETS, customerFilter),
  ]);

  const users = new Map(
    (await User.find({ _id: { $in: rows.map((r) => r._id) } })).map((u) => [String(u._id), u]),
  );
  return {
    items: rows
      .filter((r) => users.has(String(r._id)))
      .map((r) => {
        const { orders = 0, spentPaise = 0, lastOrderAt = null } = r.stats[0] ?? {};
        return { ...users.get(String(r._id)).toJSON(), stats: { orders, spentPaise, lastOrderAt } };
      }),
    pagination: meta,
    ...facets,
  };
}

async function findCustomer(id) {
  const user = await User.findOne({ _id: id, role: ROLES.CUSTOMER });
  if (!user) throw ApiError.notFound("Customer not found");
  return user;
}

/** POST /admin/customers/:id/password-reset: the forgot-password email, sent for the customer. */
export async function sendCustomerPasswordReset(id) {
  const user = await findCustomer(id);
  if (user.status !== USER_STATUS.ACTIVE) throw ApiError.conflict("The account is not active");
  await sendPasswordReset(user, { minGapMs: HELP_LINK_GAP_MS });
}

/** POST /admin/customers/:id/email-verification: (re)sends the email verification link. */
export async function sendCustomerEmailVerification(id) {
  const user = await findCustomer(id);
  if (user.emailVerifiedAt) throw ApiError.conflict("The email is already verified");
  await sendEmailVerification(user, { minGapMs: HELP_LINK_GAP_MS });
}
