import { Router } from "express";
import { PERMISSIONS } from "../config/permissions.js";
import { authenticate, can } from "../middleware/auth.middleware.js";
import { validate } from "../middleware/validate.middleware.js";
import * as customers from "../services/admin-customers.service.js";
import { audited } from "../services/audit.service.js";
import { respond } from "../utils/api-response.js";
import { parsePagination } from "../utils/pagination.js";
import { customerListRules } from "../validators/admin-customers.validators.js";
import { mongoIdParam } from "../validators/common.validators.js";

/**
 * /api/v1/admin/customers: the customer list (customers:view) and account help actions
 * (customers:edit). A customer's profile tabs reuse the other admin lists with their customer
 * filters (orders, payments, reviews, tickets, coins, audit log), each under its own permission.
 */
const P = PERMISSIONS;
const router = Router().use(authenticate, can(P.CUSTOMERS_VIEW));

router.get(
  "/",
  validate(customerListRules),
  respond((req) =>
    customers.listCustomers(req.validatedQuery, parsePagination(req.validatedQuery)),
  ),
);

const customerAudit = { accountType: "customer" };

// The standard forgot-password email; the admin never sees or sets the password.
router.post(
  "/:id/password-reset",
  can(P.CUSTOMERS_EDIT),
  validate([mongoIdParam()]),
  audited("customer.password_reset", "user", () => "Sent a password reset link"),
  respond(async (req) => {
    await customers.sendCustomerPasswordReset(req.params.id);
    req.audit = customerAudit;
    return null;
  }, "Password reset link sent"),
);

router.post(
  "/:id/email-verification",
  can(P.CUSTOMERS_EDIT),
  validate([mongoIdParam()]),
  audited("customer.email_verification", "user", () => "Sent an email verification link"),
  respond(async (req) => {
    await customers.sendCustomerEmailVerification(req.params.id);
    req.audit = customerAudit;
    return null;
  }, "Verification email sent"),
);

export default router;
