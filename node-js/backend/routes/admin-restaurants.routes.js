import { Router } from "express";
import { PERMISSIONS } from "../config/permissions.js";
import { authenticate, can } from "../middleware/auth.middleware.js";
import { validate } from "../middleware/validate.middleware.js";
import * as accounts from "../services/admin-restaurants.service.js";
import { audited, changeAudit } from "../services/audit.service.js";
import { respond } from "../utils/api-response.js";
import { parsePagination } from "../utils/pagination.js";
import { mongoIdParam } from "../validators/common.validators.js";
import * as rules from "../validators/restaurant.validators.js";

/**
 * /api/v1/admin/restaurant-accounts: the restaurant accounts list and account view
 * (restaurants:view), the admin edit (restaurants:edit), approval and suspension
 * (restaurants:approve / restaurants:status) and closing for orders (restaurants:status).
 * A restaurant's tabs reuse the other admin lists with their restaurant filters.
 */
const P = PERMISSIONS;
const router = Router().use(authenticate, can(P.RESTAURANTS_VIEW));

router.get(
  "/",
  validate(rules.accountListRules),
  respond((req) =>
    accounts.listRestaurants(req.validatedQuery, parsePagination(req.validatedQuery)),
  ),
);

router.get(
  "/cities",
  respond(async () => ({ cities: await accounts.listCities() })),
);

router.get(
  "/:id",
  validate([mongoIdParam()]),
  respond((req) => accounts.restaurantDetail(req.params.id)),
);

router.patch(
  "/:id",
  can(P.RESTAURANTS_EDIT),
  validate(rules.accountUpdateRules),
  audited("restaurant.update", "restaurant", () => "Updated restaurant details"),
  respond(async (req) => {
    const { restaurant, changes } = await accounts.updateRestaurant(req.params.id, req.body);
    req.audit = changeAudit(changes, "restaurant");
    return { restaurant };
  }, "Restaurant updated"),
);

// Approve, reject, ask for resubmission (restaurants:approve); suspend and lift a suspension
// (restaurants:status). The service checks which one this move needs.
router.patch(
  "/:id/status",
  can(P.RESTAURANTS_APPROVE, P.RESTAURANTS_STATUS),
  validate(rules.accountStatusRules),
  audited("restaurant.status", "restaurant", (req) =>
    [`Set restaurant status to ${req.body.status}`, req.body.reason].filter(Boolean).join(": "),
  ),
  respond(
    async (req) => {
      const { status, reason } = req.body;
      const result = await accounts.setStatus(req.user, req.params.id, status, reason);
      req.audit = changeAudit(result.changes, "restaurant", reason);
      req.resultMessage = result.message;
      return { restaurant: result.restaurant };
    },
    (req) => req.resultMessage,
  ),
);

router.patch(
  "/:id/accepting-orders",
  can(P.RESTAURANTS_STATUS),
  validate(rules.accountAcceptingRules),
  audited("restaurant.accepting_orders", "restaurant", (req) =>
    req.body.isAcceptingOrders
      ? "Reopened the restaurant for orders"
      : `Closed the restaurant for orders: ${req.body.reason}`,
  ),
  respond(
    async (req) => {
      const { isAcceptingOrders, reason } = req.body;
      const { restaurant, changes } = await accounts.setAcceptingOrders(req.params.id, isAcceptingOrders);
      req.audit = changeAudit(changes, "restaurant", reason);
      return { restaurant };
    },
    (_req, data) =>
      data.restaurant.isAcceptingOrders ? "Restaurant open for orders" : "Restaurant closed for orders",
  ),
);

export default router;
