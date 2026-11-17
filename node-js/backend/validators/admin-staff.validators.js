import { body, query } from "express-validator";
import {
  ADMIN_ROLES,
  STAFF_ADMIN_ROLES,
  USER_STATUS,
} from "../models/user.model.js";
import { AUDIT_ACCOUNT_TYPES } from "../models/audit-log.model.js";
import { ASSIGNABLE_PERMISSIONS, PERMISSIONS } from "../config/permissions.js";
import { email, gender, name, newPassword, phone } from "./auth.validators.js";
import { mongoIdParam, paginationRules } from "./common.validators.js";

const listQuery = [
  ...paginationRules,
  query("search").optional().isString().trim().isLength({ max: 100 }),
];
const staffRole = (optional = false) => {
  const rule = body("role");
  return (optional ? rule.optional() : rule)
    .isIn(STAFF_ADMIN_ROLES)
    .withMessage("Choose an operations, finance, support or operator role");
};

// A staff admin's own permission list: known keys (never admins:manage), or null for the role preset.
const permissionList = () =>
  body("permissions")
    .optional()
    .custom((v) => {
      if (v === null) return true;
      if (!Array.isArray(v) || v.some((p) => typeof p !== "string"))
        throw new Error("Permissions must be a list of permission keys, or null");
      if (v.includes(PERMISSIONS.ADMINS_MANAGE))
        throw new Error("Only the super admin can manage admins");
      const unknown = v.filter((p) => !ASSIGNABLE_PERMISSIONS.includes(p));
      if (unknown.length) throw new Error(`Unknown permission: ${unknown.join(", ")}`);
      return true;
    });

export const listStaffRules = [
  ...listQuery,
  query("role").optional().isIn(ADMIN_ROLES),
  query("status").optional().isIn(Object.values(USER_STATUS)),
];
export const createStaffRules = [
  name(),
  email(),
  phone(),
  newPassword(),
  staffRole(),
  permissionList(),
];
export const updateStaffRules = [
  mongoIdParam(),
  name().optional(),
  phone(),
  staffRole(true),
  permissionList(),
];
const STATUSES = Object.values(USER_STATUS);

/**
 * PATCH .../:id/status on any account (members, riders, admins): `status`, plus a `reason`
 * (3-500 characters, trimmed) for every status but `active`, where it is optional.
 */
export const accountStatusRules = [
  mongoIdParam(),
  body("status")
    .isIn(STATUSES)
    .withMessage(`Status must be one of: ${STATUSES.join(", ")}`),
  body("reason")
    .customSanitizer((v) => (typeof v === "string" ? v.trim() : v))
    .custom((v, { req }) => {
      const needed = req.body.status !== USER_STATUS.ACTIVE;
      if (v === undefined || v === null || v === "") {
        if (needed) throw new Error("Give a reason (3-500 characters)");
        return true;
      }
      if (typeof v !== "string" || v.length < 3 || v.length > 500)
        throw new Error("Give a reason (3-500 characters)");
      return true;
    }),
];
export const staffStatusRules = accountStatusRules;

export const auditListRules = [
  ...listQuery,
  query("action").optional().isString().trim().isLength({ max: 60 }),
  query("role").optional().isIn(ADMIN_ROLES),
  query("from").optional().isISO8601().toDate(),
  query("to").optional().isISO8601().toDate(),
  query("accountType")
    .optional()
    .isIn(AUDIT_ACCOUNT_TYPES.filter(Boolean))
    .withMessage("Account type must be customer, restaurant, delivery or admin"),
  // One id, or up to 5 separated by commas (a restaurant and its owner's account).
  query("resourceId")
    .optional()
    .isString()
    .custom((value) => {
      const ids = value.split(",").map((id) => id.trim());
      return ids.length <= 5 && ids.every((id) => id.length >= 1 && id.length <= 64);
    })
    .withMessage("Give up to 5 ids separated by commas")
    .customSanitizer((value) => value.split(",").map((id) => id.trim())),
];

// Admin edit of a customer, partner or rider: name, date of birth, gender and photo. Email and
// phone are the person's sign-in details, so only they change them (any sent are dropped).
// `birthDate`, `gender` and `avatarUrl` take null to clear them, so they use `.optional()`
// (undefined only): null must reach the service.
export const updateMemberRules = [
  mongoIdParam(),
  name().optional(),
  body("birthDate")
    .optional()
    .custom((v) => v === null || (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)))
    .withMessage("Enter the date as YYYY-MM-DD"),
  gender(),
  body("avatarUrl")
    .optional()
    .custom((v) => v === null || (typeof v === "string" && v.length <= 500 && /^https?:\/\//.test(v)))
    .withMessage("Enter a valid photo URL"),
];
