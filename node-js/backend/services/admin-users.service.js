import { FINAL_STATUSES, ORDER_STATUS, Order } from "../models/order.model.js";
import { Restaurant } from "../models/restaurant.model.js";
import { MEMBER_ROLES, ROLES, USER_STATUS, User } from "../models/user.model.js";
import { PERMISSIONS, hasPermission, memberPermission } from "../config/permissions.js";
import { ApiError } from "../utils/api-error.js";
import * as addresses from "./address.service.js";
import { listUsers, loginHistory } from "./admin-staff.service.js";
import { accountTypeOf, diff } from "./audit.service.js";
import { isUploadedImageUrl } from "./upload.service.js";
import { parseBirthDate } from "./special-rewards.service.js";

/**
 * The admin Users page's view and edit of one customer, restaurant partner or rider. Admin
 * accounts are not reachable here (they live in Admin management), so they answer 404 too.
 *
 * Access is per kind of account (customers | restaurants | riders): every action needs
 * `<kind>:view`, plus `<kind>:edit` to edit and, for status changes, `<kind>:status` (active,
 * inactive) or `accounts:suspend` (suspended, blocked). Checked against the caller's effective
 * permissions; an unknown account answers 404 before any 403.
 */
const forbidden = () => ApiError.forbidden("You do not have access to this account");

/** The member roles the caller may see on the Users page. */
export const viewableRoles = (actor) =>
  MEMBER_ROLES.filter((role) => hasPermission(actor, memberPermission(role, "view")));

/** Throws 403 unless the caller may do every one of `permissions` (null entries ignored)
 * to this member, always including `<kind>:view`. */
export function assertMemberAccess(actor, member, ...permissions) {
  const needed = [memberPermission(member.role, "view"), ...permissions].filter(Boolean);
  if (!needed.every((p) => hasPermission(actor, p))) throw forbidden();
}

/** The permission a status change needs for this member (see above). */
export const statusPermission = (member, status) =>
  status === USER_STATUS.SUSPENDED || status === USER_STATUS.BLOCKED
    ? PERMISSIONS.ACCOUNTS_SUSPEND
    : memberPermission(member.role, "status");

async function findMember(id, select) {
  const user = await User.findOne({ _id: id, role: { $in: MEMBER_ROLES } }).select(select ?? "");
  if (!user) throw ApiError.notFound("User not found");
  return user;
}

/** The member, once the caller may `action` ("view" or "edit") it. */
async function accessibleMember(actor, id, action, select) {
  const user = await findMember(id, select);
  assertMemberAccess(actor, user, action === "view" ? null : memberPermission(user.role, action));
  return user;
}

/** GET /admin/users: only the roles the caller may view; a `role` filter for another is 403. */
export function listFor(actor, query, pagination) {
  const roles = viewableRoles(actor);
  if (query.role && !roles.includes(query.role)) throw forbidden();
  return listUsers(roles, query, pagination);
}

/** GET /admin/users/:id/logins */
export async function loginsFor(actor, id, pagination) {
  await accessibleMember(actor, id, "view", "role");
  return loginHistory(id, MEMBER_ROLES, pagination);
}

const FAILED_STATUSES = FINAL_STATUSES.filter((s) => s !== ORDER_STATUS.DELIVERED);

/** Order figures for the orders matching `match` (a customer's or a restaurant's):
 * every order placed, delivered, cancelled or rejected, the delivered total, the newest order. */
export async function orderStats(match) {
  const [row] = await Order.aggregate([
    { $match: match },
    {
      $group: {
        _id: null,
        orders: { $sum: 1 },
        delivered: { $sum: { $cond: [{ $eq: ["$status", ORDER_STATUS.DELIVERED] }, 1, 0] } },
        cancelled: { $sum: { $cond: [{ $in: ["$status", FAILED_STATUSES] }, 1, 0] } },
        spentPaise: {
          $sum: { $cond: [{ $eq: ["$status", ORDER_STATUS.DELIVERED] }, "$pricing.totalPaise", 0] },
        },
        lastOrderAt: { $max: "$createdAt" },
      },
    },
  ]);
  const { _id, ...stats } = row ?? {};
  return { orders: 0, delivered: 0, cancelled: 0, spentPaise: 0, lastOrderAt: null, ...stats };
}

/** GET /admin/users/:id: the account, its saved addresses, order figures and owned restaurant. */
export async function memberDetail(actor, id) {
  const user = await accessibleMember(actor, id, "view");
  const [saved, stats, restaurant] = await Promise.all([
    addresses.list(user._id),
    orderStats({ customer: user._id }),
    user.role === ROLES.RESTAURANT
      ? Restaurant.findOne({ owner: user._id }).select("name slug status").lean()
      : null,
  ]);
  return {
    user: user.toJSON(),
    addresses: saved,
    stats,
    restaurant: restaurant
      ? { id: String(restaurant._id), name: restaurant.name, slug: restaurant.slug, status: restaurant.status }
      : null,
  };
}

/** The audited form of a member's editable fields (dates as YYYY-MM-DD). */
const editable = (user) => ({
  name: user.name ?? null,
  birthDate: user.birthDate ? user.birthDate.toISOString().slice(0, 10) : null,
  gender: user.gender ?? null,
  avatarUrl: user.avatarUrl ?? null,
});
const EDITABLE = ["name", "birthDate", "gender", "avatarUrl"];

/**
 * PATCH /admin/users/:id: name, date of birth, gender and photo (null clears the last three).
 * Email and phone are the person's sign-in details, so only they change them; role, status,
 * password and sessions are left alone too. Unlike the customer's own birthday endpoint, an admin
 * may change or clear a date that is already set. The photo must be an uploaded image, as on the
 * customer's own profile. Returns { user, changes } (from -> to) for the audit log.
 */
export async function updateMember(actor, id, { name, birthDate, gender, avatarUrl }) {
  const user = await accessibleMember(actor, id, "edit");
  if (avatarUrl && !isUploadedImageUrl(avatarUrl)) throw ApiError.badRequest("Upload the photo first");
  const before = editable(user);
  if (name !== undefined) user.name = name;
  if (birthDate !== undefined) user.birthDate = birthDate ? parseBirthDate(birthDate) : undefined; // null clears it
  if (gender !== undefined) user.gender = gender ?? undefined;
  if (avatarUrl !== undefined) user.avatarUrl = avatarUrl || undefined;
  await user.save(); // writes nothing when nothing changed
  return {
    user: user.toJSON(),
    changes: diff(before, editable(user), EDITABLE),
    accountType: accountTypeOf(user.role),
  };
}

/** The customer whose addresses an admin manages (other roles have none); needs `<kind>:edit`. */
async function customerId(actor, id) {
  const user = await accessibleMember(actor, id, "edit", "role");
  if (user.role !== ROLES.CUSTOMER)
    throw ApiError.badRequest("Only customers have saved addresses");
  return user._id;
}

// The customer's own address rules (limit, default handling), scoped to the user in the URL.
const forCustomer =
  (fn) =>
  async (actor, id, ...args) =>
    fn(await customerId(actor, id), ...args);
export const createAddress = forCustomer(addresses.create);
export const updateAddress = forCustomer(addresses.update);
export const setDefaultAddress = forCustomer(addresses.setDefault);
export const removeAddress = forCustomer(addresses.remove);
