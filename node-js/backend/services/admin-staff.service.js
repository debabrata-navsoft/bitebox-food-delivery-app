import mongoose from "mongoose";
import {
  ADMIN_ROLES,
  ROLES,
  STAFF_ADMIN_ROLES,
  User,
} from "../models/user.model.js";
import { Session } from "../models/session.model.js";
import { ApiError } from "../utils/api-error.js";
import { escapeRegex, paginationMeta } from "../utils/pagination.js";
import {
  ASSIGNABLE_PERMISSIONS,
  PERMISSION_CATALOGUE,
  PERMISSION_PRESETS,
  effectivePermissions,
} from "../config/permissions.js";
import { accountTypeOf, changeAudit, diff } from "./audit.service.js";
import { applyStatus, endSessions, hashPassword } from "./auth.service.js";
import { adminSetStatus as setRiderStatus } from "./delivery-partner.service.js";

/**
 * Changes the status (active, inactive, suspended, blocked) of an account whose role is in `roles`
 * (the Users page passes member roles, Admin management admin roles). `check(user)` may refuse
 * (e.g. the caller's permissions for this kind of account). Asking for the current status changes
 * nothing. Riders go through their own flow (they may be carrying an order).
 * Returns { user, from, changed } so the route can audit it.
 */
export async function setAccountStatus(actorId, userId, { status, reason }, roles, check) {
  if (String(actorId) === String(userId))
    throw ApiError.badRequest("You cannot suspend your own account");
  const user = await User.findById(userId).select("+tokenVersion");
  if (!user) throw ApiError.notFound("User not found");
  if (!roles.includes(user.role))
    throw ApiError.badRequest(
      ADMIN_ROLES.includes(user.role)
        ? "Manage admin accounts from Admin management"
        : "This is not an admin account",
    );
  check?.(user);
  if (user.role === ROLES.DELIVERY) return setRiderStatus(user._id, status, reason);

  const from = user.status;
  if (from === status) return { user: user.toJSON(), from, changed: false };
  await applyStatus(user, status, reason);
  return { user: user.toJSON(), from, changed: true };
}

const STATUS_VERB = {
  active: "reactivated",
  inactive: "deactivated",
  suspended: "suspended",
  blocked: "blocked",
};
/** The response message of a member status change, e.g. "User blocked", "Rider reactivated". */
export const statusMessage = (who, status) => `${who} ${STATUS_VERB[status] ?? "updated"}`;

/** The audit details of a status change (see setAccountStatus): skipped when nothing changed. */
export const statusAudit = ({ user, from, changed }, reason) =>
  changeAudit(changed ? { status: { from, to: user.status } } : {}, accountTypeOf(user.role), reason);

/** A page of accounts with one of `roles` (or just `role`), newest first. */
export async function listUsers(roles, { role, status, search }, pagination) {
  const filter = { role: role ?? { $in: roles } };
  if (status) filter.status = status;
  if (search) {
    const pattern = new RegExp(escapeRegex(search), "i");
    filter.$or = [{ name: pattern }, { email: pattern }, { phone: pattern }];
  }
  const [items, total] = await Promise.all([
    User.find(filter)
      .sort({ createdAt: -1 })
      .skip(pagination.skip)
      .limit(pagination.limit),
    User.countDocuments(filter),
  ]);
  return {
    items: items.map((u) => u.toJSON()),
    pagination: paginationMeta(pagination, total),
  };
}

export const listStaff = (query, pagination) =>
  listUsers(ADMIN_ROLES, query, pagination);

export async function getStaff(id) {
  const user = await User.findOne({ _id: id, role: { $in: ADMIN_ROLES } });
  if (!user) throw ApiError.notFound("Admin not found");
  return user.toJSON();
}

/** A permission list as stored: null/undefined (role preset) or the known keys, deduplicated. */
const customList = (permissions) =>
  permissions == null ? undefined : ASSIGNABLE_PERMISSIONS.filter((p) => permissions.includes(p));

export async function createStaff({ name, email, phone, password, role, permissions }) {
  if (!STAFF_ADMIN_ROLES.includes(role))
    throw ApiError.badRequest("Choose an operations, finance, support or operator role");
  if (await User.exists({ email }))
    throw ApiError.conflict("An account with this email already exists");
  if (phone && (await User.exists({ phone })))
    throw ApiError.conflict("An account with this phone number already exists");
  const user = await User.create({
    name,
    email,
    phone,
    role,
    customPermissions: customList(permissions),
    passwordHash: await hashPassword(password),
  });
  return user.toJSON();
}

/**
 * Edits a staff admin. Super admins are not editable here, and nobody edits their own role.
 * A role change signs the admin out so their next session gets the new permissions; a permission
 * change applies on their next request (authenticate re-reads the account every time).
 * `permissions`: a list of keys (stored as the custom list) or null to go back to the role preset.
 * Returns { user, changes } (role and effective permissions, from -> to) for the audit log.
 */
export async function updateStaff(actorId, id, { name, phone, role, permissions }) {
  if (String(actorId) === String(id))
    throw ApiError.badRequest("Use your profile page to edit your own account");
  const user = await User.findOne({
    _id: id,
    role: { $in: STAFF_ADMIN_ROLES },
  }).select("+tokenVersion");
  if (!user) throw ApiError.notFound("Admin not found");
  if (phone && phone !== user.phone && (await User.exists({ phone })))
    throw ApiError.conflict("An account with this phone number already exists");

  const before = { role: user.role, permissions: effectivePermissions(user) };
  if (name !== undefined) user.name = name;
  if (phone !== undefined) user.phone = phone || undefined;
  if (permissions !== undefined) user.customPermissions = customList(permissions);
  const roleChanged = role !== undefined && role !== user.role;
  if (roleChanged) {
    user.role = role;
    await endSessions(user, "role-change");
  } else {
    await user.save();
  }
  const after = { role: user.role, permissions: effectivePermissions(user) };
  return { user: user.toJSON(), changes: diff(before, after, ["role", "permissions"]) };
}

/**
 * Sign-ins of one account, newest first. A sign-in is a session family: refreshes rotate the
 * token inside it, so its first row is the sign-in and its newest row says whether it is still
 * active. (Expired sessions are purged by a TTL index, so history covers the refresh lifetime.)
 */
export async function loginHistory(userId, roles, pagination) {
  if (!(await User.exists({ _id: userId, role: { $in: roles } })))
    throw ApiError.notFound("User not found");
  const [{ families, total }] = await Session.aggregate([
    { $match: { user: new mongoose.Types.ObjectId(String(userId)) } },
    { $sort: { createdAt: 1 } },
    {
      $group: {
        _id: "$family",
        signedInAt: { $first: "$createdAt" },
        lastActiveAt: { $last: "$createdAt" },
        ip: { $first: "$ip" },
        userAgent: { $first: "$userAgent" },
        last: { $last: { revokedAt: "$revokedAt", reason: "$revokedReason", expiresAt: "$expiresAt" } },
      },
    },
    {
      $facet: {
        families: [
          { $sort: { signedInAt: -1 } },
          { $skip: pagination.skip },
          { $limit: pagination.limit },
        ],
        total: [{ $count: "n" }],
      },
    },
  ]);
  const now = new Date();
  return {
    items: families.map((f) => {
      const active = !f.last.revokedAt && f.last.expiresAt > now;
      return {
        signedInAt: f.signedInAt,
        lastActiveAt: f.lastActiveAt,
        ip: f.ip ?? null,
        userAgent: f.userAgent ?? null,
        active,
        endedReason: active ? null : (f.last.reason ?? "expired"),
      };
    }),
    pagination: paginationMeta(pagination, total[0]?.n ?? 0),
  };
}

/** GET /admin/admins/permissions: what the permission editor offers. */
export const permissionCatalogue = () => ({
  permissions: PERMISSION_CATALOGUE.map(({ key, label, group }) => ({ key, label, group })),
  presets: PERMISSION_PRESETS.map(({ key, label, permissions }) => ({
    key,
    label,
    permissions: [...permissions],
  })),
});
