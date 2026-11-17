import { Router } from "express";
import { PERMISSIONS } from "../config/permissions.js";
import * as c from "../controllers/coupon.controller.js";
import { authenticate, authorize, can } from "../middleware/auth.middleware.js";
import { validate } from "../middleware/validate.middleware.js";
import { ROLES } from "../models/user.model.js";
import { audited } from "../services/audit.service.js";
import { mongoIdParam, paginationRules } from "../validators/common.validators.js";
import * as rules from "../validators/coupon.validators.js";

/** Coupons and restaurant offers (Django: apps/coupons/urls.py). */
const admin = [authenticate, can(PERMISSIONS.CATALOG_MANAGE)];
/**
 * /api/v1/coupons (signed-in customers). Reading the lists isn't rate-limited like applying a
 * code in the cart: they only show what this customer can already use, so they can't be used
 * to guess codes, and the Offers page reloads them on every filter.
 */
export const couponsRouter = Router()
  .use(authenticate, authorize(ROLES.CUSTOMER))
  .get("/available", validate(rules.availableCouponRules), c.available)
  .get("/offers", validate(rules.offersRules), c.offers);

/** /api/v1/admin/coupons (fixed paths before /:id) */
export const adminCouponsRouter = Router()
  .use(...admin)
  .get("/", validate(rules.couponListRules), c.adminList)
  .post("/", validate(rules.createCouponRules), audited("coupon.create", "coupon", (req) => `Created coupon ${req.body.code || "(generated)"}`), c.adminCreate)
  .get("/analytics", c.adminAnalytics)
  .get("/:id", validate([mongoIdParam()]), c.adminGet)
  .patch("/:id", validate(rules.updateCouponRules), audited("coupon.update", "coupon", () => "Edited a coupon"), c.adminUpdate)
  .delete("/:id", validate([mongoIdParam()]), audited("coupon.delete", "coupon", () => "Deleted a coupon"), c.adminDelete)
  .patch("/:id/status", validate(rules.activeRules), audited("coupon.status", "coupon", (req) => `Set coupon active: ${req.body.isActive}`), c.adminSetActive)
  .post("/:id/duplicate", validate([mongoIdParam()]), audited("coupon.duplicate", "coupon", () => "Duplicated a coupon"), c.adminDuplicate);

/** /api/v1/admin/restaurant-offers: the approval queue */
export const adminRestaurantOffersRouter = Router()
  .use(...admin)
  .get("/pending", validate(paginationRules), c.pending)
  .post("/:id/approve", validate([mongoIdParam()]), audited("offer.approve", "coupon", () => "Approved a restaurant offer"), c.approve)
  .post("/:id/reject", validate(rules.reasonRules), audited("offer.reject", "coupon", (req) => `Rejected a restaurant offer: ${req.body.reason ?? ""}`), c.reject);

/** /api/v1/my/restaurant/offers: a restaurant partner's own offers */
export const myOffersRouter = Router()
  .use(authenticate, authorize(ROLES.RESTAURANT))
  .get("/", validate(rules.couponListRules), c.ownList)
  .post("/", validate(rules.createOfferRules), c.ownCreate)
  .get("/analytics", c.ownAnalytics)
  .get("/:id", validate([mongoIdParam()]), c.ownGet)
  .patch("/:id", validate(rules.updateOfferRules), c.ownUpdate)
  .delete("/:id", validate([mongoIdParam()]), c.ownDelete)
  .patch("/:id/status", validate(rules.activeRules), c.ownSetActive);
