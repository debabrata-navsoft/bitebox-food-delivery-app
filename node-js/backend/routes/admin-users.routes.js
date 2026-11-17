import { Router } from "express";
import { query } from "express-validator";
import { PERMISSIONS } from "../config/permissions.js";
import { authenticate, can } from "../middleware/auth.middleware.js";
import { validate } from "../middleware/validate.middleware.js";
import { MEMBER_ROLES, USER_STATUS } from "../models/user.model.js";
import {
  setAccountStatus,
  statusAudit,
  statusMessage,
} from "../services/admin-staff.service.js";
import * as members from "../services/admin-users.service.js";
import { audited } from "../services/audit.service.js";
import { respond } from "../utils/api-response.js";
import { parsePagination } from "../utils/pagination.js";
import {
  accountStatusRules,
  updateMemberRules,
} from "../validators/admin-staff.validators.js";
import { addressRules } from "../validators/checkout.validators.js";
import {
  mongoIdParam,
  paginationRules,
} from "../validators/common.validators.js";

/**
 * /api/v1/admin/users: customers, restaurant partners and riders (admins live in /admin/admins).
 * Open to anyone who may view at least one kind of account; each request is then checked against
 * the kind of the account it touches (services/admin-users.service.js).
 */
const P = PERMISSIONS;
const router = Router().use(
  authenticate,
  can(P.CUSTOMERS_VIEW, P.RESTAURANTS_VIEW, P.RIDERS_VIEW),
);

router.get(
  "/",
  validate([
    query("role").optional().isIn(MEMBER_ROLES),
    query("status").optional().isIn(Object.values(USER_STATUS)),
    query("search").optional().isString().trim().isLength({ max: 100 }),
    ...paginationRules,
  ]),
  respond((req) =>
    members.listFor(req.user, req.validatedQuery, parsePagination(req.validatedQuery)),
  ),
);

// Sign-ins of a customer, restaurant partner or rider.
router.get(
  "/:id/logins",
  validate([mongoIdParam(), ...paginationRules]),
  respond((req) =>
    members.loginsFor(req.user, req.params.id, parsePagination(req.validatedQuery)),
  ),
);

// Status: active / inactive need <kind>:status, suspended / blocked accounts:suspend.
router.patch(
  "/:id/status",
  validate(accountStatusRules),
  audited(
    "user.status",
    "user",
    (req) => `Set account status to ${req.body.status}`,
  ),
  respond(
    async (req) => {
      const { status, reason } = req.body;
      const result = await setAccountStatus(
        req.user._id,
        req.params.id,
        { status, reason },
        MEMBER_ROLES,
        (member) => members.assertMemberAccess(req.user, member, members.statusPermission(member, status)),
      );
      req.audit = statusAudit(result, reason);
      return { user: result.user };
    },
    (req) => statusMessage("User", req.body.status),
  ),
);

// One account: details, saved addresses, order figures and (partners) their restaurant.
router.get(
  "/:id",
  validate([mongoIdParam()]),
  respond((req) => members.memberDetail(req.user, req.params.id)),
);

router.patch(
  "/:id",
  validate(updateMemberRules),
  audited("user.update", "user", () => "Updated user details"),
  respond(async (req) => {
    const { user, changes, accountType } = await members.updateMember(req.user, req.params.id, req.body);
    req.audit = { changes, accountType };
    return { user };
  }, "User updated"),
);

// A customer's saved addresses, with the same rules as their own /addresses endpoints.
const addressIds = [mongoIdParam(), mongoIdParam("addressId")];

router.post(
  "/:id/addresses",
  validate([mongoIdParam(), ...addressRules({ partial: false })]),
  audited("user.address.create", "user", () => "Added a saved address"),
  respond(
    async (req) => ({ address: await members.createAddress(req.user, req.params.id, req.body) }),
    "Address saved",
    201,
  ),
);

router.patch(
  "/:id/addresses/:addressId",
  validate([...addressIds, ...addressRules({ partial: true })]),
  audited("user.address.update", "user", () => "Updated a saved address"),
  respond(
    async (req) => ({
      address: await members.updateAddress(req.user, req.params.id, req.params.addressId, req.body),
    }),
    "Address updated",
  ),
);

router.patch(
  "/:id/addresses/:addressId/default",
  validate(addressIds),
  audited("user.address.default", "user", () => "Changed the default address"),
  respond(
    async (req) => ({
      address: await members.setDefaultAddress(req.user, req.params.id, req.params.addressId),
    }),
    "Default address updated",
  ),
);

router.delete(
  "/:id/addresses/:addressId",
  validate(addressIds),
  audited("user.address.delete", "user", () => "Deleted a saved address"),
  respond(async (req) => {
    await members.removeAddress(req.user, req.params.id, req.params.addressId);
    return null;
  }, "Address deleted"),
);

export default router;
