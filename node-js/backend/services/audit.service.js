import { logger } from "../config/logger.js";
import { ADMIN_ROLES, MEMBER_ROLES } from "../config/roles.js";
import { AuditLog } from "../models/audit-log.model.js";
import { User } from "../models/user.model.js";
import { escapeRegex, paginationMeta } from "../utils/pagination.js";

const clip = (text, max) => String(text ?? "").slice(0, max);

/**
 * Stores one audit entry. Best-effort: a logging failure never fails the admin's action.
 * A user resource without an `accountType` gets the target's kind looked up.
 */
export async function record(user, entry, ip) {
  try {
    let accountType = entry.accountType;
    if (accountType === undefined && entry.resourceType === "user" && entry.resourceId) {
      const target = await User.findById(String(entry.resourceId)).select("role").lean();
      accountType = accountTypeOf(target?.role);
    }
    await AuditLog.create({
      admin: user._id,
      adminRole: user.role,
      action: entry.action,
      description: clip(entry.description, 500),
      resourceType: entry.resourceType,
      resourceId: entry.resourceId ? String(entry.resourceId) : undefined,
      ip: clip(ip, 64) || undefined,
      accountType: accountType ?? "",
      changes: entry.changes ?? {},
      reason: clip(entry.reason, 500),
    });
  } catch (err) {
    logger.error({ err, action: entry.action }, "Could not write audit log");
  }
}

/** The audit `accountType` of a user account with this role. */
export const accountTypeOf = (role) =>
  ADMIN_ROLES.includes(role) ? "admin" : MEMBER_ROLES.includes(role) ? role : "";

/** `{ field: { from, to } }` for every field in `fields` whose value differs between the two. */
export function diff(before, after, fields) {
  const plain = (v) => (v instanceof Date ? v.toISOString() : v ?? null);
  const changes = {};
  for (const field of fields) {
    const from = plain(before[field]);
    const to = plain(after[field]);
    if (JSON.stringify(from) !== JSON.stringify(to)) changes[field] = { from, to };
  }
  return changes;
}

/**
 * The `req.audit` of an edit or status change (see audited): what changed and why, or no row at
 * all when nothing changed.
 */
export const changeAudit = (changes, accountType, reason) =>
  Object.keys(changes).length ? { changes, reason: reason ?? "", accountType } : { skip: true };

/**
 * Route middleware: once the request succeeds (status < 400), records `action` against the
 * resource in `req.params.id`. `describe(req)` builds the human-readable line. The handler may
 * set `req.audit = { changes, reason, accountType }` to record what changed, or
 * `req.audit = { skip: true }` when the request changed nothing.
 */
export const audited =
  (action, resourceType, describe) => (req, res, next) => {
    res.on("finish", () => {
      if (res.statusCode >= 400 || !req.user || req.audit?.skip) return;
      const write = record(
        req.user,
        {
          action,
          resourceType,
          resourceId: req.params.id ?? req.auditResourceId,
          description: describe(req),
          changes: req.audit?.changes,
          reason: req.audit?.reason,
          accountType: req.audit?.accountType,
        },
        req.ip,
      ).finally(() => pending.delete(write));
      pending.add(write);
    });
    next();
  };

// Audit rows are written after the response; tests await them with flushAudits().
const pending = new Set();
export const flushAudits = () => Promise.all([...pending]);

export async function list(
  { action, role, search, from, to, accountType, resourceId },
  pagination,
) {
  const filter = {};
  if (action) filter.action = action;
  if (role) filter.adminRole = role;
  if (accountType) filter.accountType = accountType;
  if (resourceId?.length)
    filter.resourceId = Array.isArray(resourceId) ? { $in: resourceId } : resourceId;
  if (search) {
    const pattern = new RegExp(escapeRegex(search), "i");
    filter.$or = [{ description: pattern }, { resourceId: search }];
  }
  if (from || to)
    filter.createdAt = { ...(from && { $gte: from }), ...(to && { $lte: to }) };
  const [items, total] = await Promise.all([
    AuditLog.find(filter)
      .sort({ createdAt: -1 })
      .skip(pagination.skip)
      .limit(pagination.limit)
      .populate("admin", "name email"),
    AuditLog.countDocuments(filter),
  ]);
  return {
    items: items.map((entry) => {
      const json = entry.toJSON();
      return {
        ...json,
        accountType: json.accountType ?? "",
        changes: json.changes ?? {},
        reason: json.reason ?? "",
        admin: entry.admin
          ? { id: String(entry.admin._id), name: entry.admin.name, email: entry.admin.email }
          : null,
      };
    }),
    pagination: paginationMeta(pagination, total),
  };
}
