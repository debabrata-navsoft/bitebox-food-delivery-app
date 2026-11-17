import { Router } from "express";
import { PERMISSIONS } from "../config/permissions.js";
import { authenticate, can } from "../middleware/auth.middleware.js";
import { validate } from "../middleware/validate.middleware.js";
import * as accounts from "../services/admin-delivery-partners.service.js";
import { audited, changeAudit } from "../services/audit.service.js";
import { respond } from "../utils/api-response.js";
import { parsePagination } from "../utils/pagination.js";
import * as rules from "../validators/admin-delivery-partners.validators.js";
import { mongoIdParam, paginationRules } from "../validators/common.validators.js";

/**
 * /api/v1/admin/delivery-partner-accounts: the delivery partner accounts list and account view
 * (riders:view), the admin edit (riders:edit), verification (riders:approve), taking a rider
 * offline (riders:status) and the availability history. Ids are the riders' user ids. A rider's
 * tabs reuse the other admin lists with their rider filters.
 */
const P = PERMISSIONS;
const router = Router().use(authenticate, can(P.RIDERS_VIEW));

router.get(
  "/",
  validate(rules.riderAccountListRules),
  respond((req) => accounts.listRiders(req.validatedQuery, parsePagination(req.validatedQuery))),
);

router.get(
  "/zones",
  respond(async () => ({ zones: await accounts.listZones() })),
);

router.get(
  "/:id",
  validate([mongoIdParam()]),
  respond((req) => accounts.riderDetail(req.params.id)),
);

router.patch(
  "/:id",
  can(P.RIDERS_EDIT),
  validate(rules.riderAccountUpdateRules),
  audited("rider.update", "user", () => "Updated delivery partner details"),
  respond(async (req) => {
    const { detail, changes } = await accounts.updateRider(req.user, req.params.id, req.body);
    req.audit = changeAudit(changes, "delivery");
    return detail;
  }, "Delivery partner updated"),
);

router.patch(
  "/:id/verification",
  can(P.RIDERS_APPROVE),
  validate(rules.riderAccountVerificationRules),
  audited("rider.verification", "user", (req) =>
    [`Set rider verification to ${req.body.status}`, req.body.reason].filter(Boolean).join(": "),
  ),
  respond(
    async (req) => {
      const { status, reason } = req.body;
      const result = await accounts.setVerification(req.user, req.params.id, status, reason);
      req.audit = changeAudit(result.changes, "delivery", reason);
      req.resultMessage = result.message;
      return result.detail;
    },
    (req) => req.resultMessage,
  ),
);

router.get(
  "/:id/availability",
  validate([mongoIdParam(), ...paginationRules]),
  respond((req) =>
    accounts.availabilityHistory(req.params.id, parsePagination(req.validatedQuery)),
  ),
);

router.patch(
  "/:id/availability",
  can(P.RIDERS_STATUS),
  validate(rules.riderAccountAvailabilityRules),
  audited("rider.availability", "user", (req) => `Took the rider offline: ${req.body.reason}`),
  respond(async (req) => {
    const { detail, changes } = await accounts.takeRiderOffline(req.params.id, req.body.reason);
    req.audit = changeAudit(changes, "delivery", req.body.reason);
    return detail;
  }, "Delivery partner taken offline"),
);

export default router;
