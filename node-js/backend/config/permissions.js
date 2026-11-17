import { ADMIN_ROLES, ROLES } from "./roles.js";

/**
 * What admin-panel people may do. The API enforces these with `can(...)` (middleware/auth.middleware.js)
 * against each person's EFFECTIVE permissions (`effectivePermissions(user)`): the super admin
 * (ROLES.ADMIN) has every permission; anyone else has their custom list (`customPermissions`) when
 * one is set, otherwise their role's preset. The web app only uses them to hide menu items.
 */
export const PERMISSIONS = Object.freeze({
  ADMINS_MANAGE: "admins:manage", // create, edit, (de)activate staff admins (super admin only)
  // Customers, restaurant partners and riders on the Users page, per kind of account.
  CUSTOMERS_VIEW: "customers:view",
  CUSTOMERS_EDIT: "customers:edit",
  CUSTOMERS_STATUS: "customers:status", // activate / deactivate (inactive)
  RESTAURANTS_VIEW: "restaurants:view",
  RESTAURANTS_EDIT: "restaurants:edit",
  RESTAURANTS_STATUS: "restaurants:status",
  RESTAURANTS_APPROVE: "restaurants:approve",
  RESTAURANTS_KYC: "restaurants:kyc", // review partner documents (not bank details)
  RIDERS_VIEW: "riders:view",
  RIDERS_EDIT: "riders:edit",
  RIDERS_STATUS: "riders:status",
  RIDERS_APPROVE: "riders:approve",
  RIDERS_KYC: "riders:kyc",
  ACCOUNTS_SUSPEND: "accounts:suspend", // suspend or block any member account
  AUDIT_VIEW: "audit:view",
  CATALOG_MANAGE: "catalog:manage", // categories and coupons
  OPERATIONS_VIEW: "operations:view", // operations dashboard, monitoring, delivery performance
  ORDERS_VIEW: "orders:view",
  ORDERS_MANAGE: "orders:manage", // cancel, unassign
  RESTAURANTS_MANAGE: "restaurants:manage", // onboarding, approval, menu items
  RIDERS_MANAGE: "riders:manage",
  FINANCE_VIEW: "finance:view", // finance dashboard, transactions, reports, commission
  REFUNDS_MANAGE: "refunds:manage",
  PAYOUTS_MANAGE: "payouts:manage",
  SUPPORT_MANAGE: "support:manage", // tickets
  REVIEWS_MODERATE: "reviews:moderate",
  // Coins, referral and campaign settings (super admin only), and read-only rewards reports.
  REWARDS_MANAGE: "rewards:manage",
  REWARDS_VIEW: "rewards:view",
  // Push special offers to customers who opted in (super admin only).
  PROMOTIONS_SEND: "promotions:send",
});

const P = PERMISSIONS;
export const ALL_PERMISSIONS = Object.freeze(Object.values(P));

/** Only the super admin has these; they can never be granted in a custom list. */
export const SUPER_ADMIN_ONLY = Object.freeze([P.ADMINS_MANAGE]);
/** Keys that may appear in a person's custom list. */
export const ASSIGNABLE_PERMISSIONS = Object.freeze(
  ALL_PERMISSIONS.filter((p) => !SUPER_ADMIN_ONLY.includes(p)),
);

/** Role presets: what a person of the role has when they have no custom list. */
export const ROLE_PERMISSIONS = Object.freeze({
  [ROLES.ADMIN]: ALL_PERMISSIONS,
  [ROLES.OPERATIONS_ADMIN]: Object.freeze([
    P.OPERATIONS_VIEW,
    P.ORDERS_VIEW,
    P.ORDERS_MANAGE,
    P.RESTAURANTS_MANAGE,
    P.RIDERS_MANAGE,
    P.RESTAURANTS_VIEW,
    P.RESTAURANTS_EDIT,
    P.RESTAURANTS_STATUS,
    P.RESTAURANTS_APPROVE,
    P.RESTAURANTS_KYC,
    P.RIDERS_VIEW,
    P.RIDERS_EDIT,
    P.RIDERS_STATUS,
    P.RIDERS_APPROVE,
    P.RIDERS_KYC,
  ]),
  [ROLES.FINANCE_ADMIN]: Object.freeze([
    P.FINANCE_VIEW,
    P.REFUNDS_MANAGE,
    P.PAYOUTS_MANAGE,
  ]),
  // Support reads orders to investigate complaints, but cannot change them or see finance.
  [ROLES.SUPPORT_ADMIN]: Object.freeze([
    P.SUPPORT_MANAGE,
    P.ORDERS_VIEW,
    P.REVIEWS_MODERATE,
    P.CUSTOMERS_VIEW,
    P.CUSTOMERS_EDIT,
  ]),
  // Operators have nothing by default: everything comes from their custom list.
  [ROLES.OPERATOR]: Object.freeze([]),
});

/** A role's preset (no custom list). */
export const permissionsFor = (role) => ROLE_PERMISSIONS[role] ?? [];

/** Whether a role's PRESET includes `permission` (role tables, tests). People: use hasPermission. */
export const roleHasPermission = (role, permission) =>
  permissionsFor(role).includes(permission);

/**
 * The permissions a person actually has, in PERMISSIONS order: the super admin every one, a
 * custom list when set (null/undefined: the role preset), nobody outside the admin panel any.
 */
export function effectivePermissions(user) {
  if (!user || !ADMIN_ROLES.includes(user.role)) return [];
  if (user.role === ROLES.ADMIN) return [...ALL_PERMISSIONS];
  const custom = user.customPermissions;
  const granted = Array.isArray(custom) ? custom : permissionsFor(user.role);
  return ASSIGNABLE_PERMISSIONS.filter((p) => granted.includes(p));
}

/** Whether this person (a user document or { role, customPermissions }) has `permission`. */
export const hasPermission = (user, permission) =>
  effectivePermissions(user).includes(permission);

/**
 * A MongoDB filter for admin-panel accounts whose effective permissions include `permission`
 * (status is left to the caller): the super admin, people whose custom list has it, and people
 * without a custom list whose role preset has it.
 */
export function permissionFilter(permission) {
  const presetRoles = ADMIN_ROLES.filter(
    (r) => r !== ROLES.ADMIN && roleHasPermission(r, permission),
  );
  const staffRoles = ADMIN_ROLES.filter((r) => r !== ROLES.ADMIN);
  const or = [{ role: ROLES.ADMIN }];
  if (!SUPER_ADMIN_ONLY.includes(permission)) {
    or.push({ role: { $in: staffRoles }, customPermissions: permission });
    if (presetRoles.length)
      or.push({ role: { $in: presetRoles }, customPermissions: null }); // null or missing
  }
  return { $or: or };
}

// The permission editor's catalogue (GET /admin/admins/permissions).
const G = {
  CUSTOMERS: "Customers",
  RESTAURANTS: "Restaurants",
  RIDERS: "Delivery partners",
  ACCOUNTS: "Accounts",
  OPERATIONS: "Orders & operations",
  FINANCE: "Finance",
  SUPPORT: "Support",
  CATALOG: "Catalog & marketing",
  REWARDS: "Rewards",
  ADMIN: "Admin",
};

export const PERMISSION_CATALOGUE = Object.freeze([
  { key: P.CUSTOMERS_VIEW, label: "View customers", group: G.CUSTOMERS },
  { key: P.CUSTOMERS_EDIT, label: "Edit customers", group: G.CUSTOMERS },
  { key: P.CUSTOMERS_STATUS, label: "Activate or deactivate customers", group: G.CUSTOMERS },
  { key: P.RESTAURANTS_VIEW, label: "View restaurant partners", group: G.RESTAURANTS },
  { key: P.RESTAURANTS_EDIT, label: "Edit restaurant partners", group: G.RESTAURANTS },
  { key: P.RESTAURANTS_STATUS, label: "Activate or deactivate restaurant partners", group: G.RESTAURANTS },
  { key: P.RESTAURANTS_APPROVE, label: "Approve restaurants", group: G.RESTAURANTS },
  { key: P.RESTAURANTS_KYC, label: "Review restaurant documents", group: G.RESTAURANTS },
  { key: P.RESTAURANTS_MANAGE, label: "Manage restaurants and menus", group: G.RESTAURANTS },
  { key: P.RIDERS_VIEW, label: "View delivery partners", group: G.RIDERS },
  { key: P.RIDERS_EDIT, label: "Edit delivery partners", group: G.RIDERS },
  { key: P.RIDERS_STATUS, label: "Activate or deactivate delivery partners", group: G.RIDERS },
  { key: P.RIDERS_APPROVE, label: "Approve delivery partners", group: G.RIDERS },
  { key: P.RIDERS_KYC, label: "Review delivery partner documents", group: G.RIDERS },
  { key: P.RIDERS_MANAGE, label: "Manage delivery partners", group: G.RIDERS },
  { key: P.ACCOUNTS_SUSPEND, label: "Suspend or block accounts", group: G.ACCOUNTS },
  { key: P.OPERATIONS_VIEW, label: "View operations", group: G.OPERATIONS },
  { key: P.ORDERS_VIEW, label: "View orders", group: G.OPERATIONS },
  { key: P.ORDERS_MANAGE, label: "Manage orders", group: G.OPERATIONS },
  { key: P.FINANCE_VIEW, label: "View finance", group: G.FINANCE },
  { key: P.REFUNDS_MANAGE, label: "Manage refunds", group: G.FINANCE },
  { key: P.PAYOUTS_MANAGE, label: "Manage payouts", group: G.FINANCE },
  { key: P.SUPPORT_MANAGE, label: "Handle support tickets", group: G.SUPPORT },
  { key: P.REVIEWS_MODERATE, label: "Moderate reviews", group: G.SUPPORT },
  { key: P.CATALOG_MANAGE, label: "Manage categories and coupons", group: G.CATALOG },
  { key: P.PROMOTIONS_SEND, label: "Send promotions", group: G.CATALOG },
  { key: P.REWARDS_VIEW, label: "View rewards reports", group: G.REWARDS },
  { key: P.REWARDS_MANAGE, label: "Manage rewards", group: G.REWARDS },
  { key: P.AUDIT_VIEW, label: "View the audit log", group: G.ADMIN },
  { key: P.ADMINS_MANAGE, label: "Manage admins", group: G.ADMIN },
]);

/** Starting points for the permission editor (not roles). */
export const PERMISSION_PRESETS = Object.freeze([
  {
    key: "support",
    label: "Support",
    permissions: [P.CUSTOMERS_VIEW, P.CUSTOMERS_EDIT, P.ORDERS_VIEW, P.SUPPORT_MANAGE, P.REVIEWS_MODERATE],
  },
  {
    key: "restaurant",
    label: "Restaurant operations",
    permissions: [P.RESTAURANTS_VIEW, P.RESTAURANTS_EDIT, P.RESTAURANTS_APPROVE, P.RESTAURANTS_MANAGE],
  },
  {
    key: "delivery",
    label: "Delivery operations",
    permissions: [P.RIDERS_VIEW, P.RIDERS_EDIT, P.RIDERS_APPROVE, P.RIDERS_MANAGE, P.ORDERS_VIEW],
  },
  {
    key: "kyc",
    label: "KYC review",
    permissions: [P.RESTAURANTS_VIEW, P.RIDERS_VIEW, P.RESTAURANTS_KYC, P.RIDERS_KYC],
  },
  {
    key: "finance",
    label: "Finance",
    permissions: [P.FINANCE_VIEW, P.REFUNDS_MANAGE, P.PAYOUTS_MANAGE],
  },
]);

/** The kind of member account (customers | restaurants | riders) a role belongs to, or null. */
export const MEMBER_KIND = Object.freeze({
  [ROLES.CUSTOMER]: "customers",
  [ROLES.RESTAURANT]: "restaurants",
  [ROLES.DELIVERY]: "riders",
});

/** `<kind>:<action>` for a member role, e.g. memberPermission("delivery", "view") -> "riders:view". */
export const memberPermission = (role, action) =>
  MEMBER_KIND[role] ? `${MEMBER_KIND[role]}:${action}` : null;
