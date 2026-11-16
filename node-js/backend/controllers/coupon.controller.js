import * as coupons from "../services/coupon.service.js";
import { requireOwnRestaurant } from "../services/restaurant.service.js";
import { respond } from "../utils/api-response.js";
import { parsePagination } from "../utils/pagination.js";

/** Coupons and restaurant offers (Django: apps/coupons/views.py). */
const page = (req) => parsePagination(req.validatedQuery);
const one = (coupon) => ({ coupon: coupons.couponJson(coupon) });
const own = (req) => requireOwnRestaurant(req.user._id);

// Customers
export const available = respond(async (req) => ({
  coupons: await coupons.listAvailable({ restaurantId: req.validatedQuery.restaurantId, user: req.user }),
}));
export const offers = respond(async (req) => ({ offers: await coupons.customerOffers(req.user, req.validatedQuery.type) }));

// Admins
export const adminList = respond((req) => coupons.adminList(req.validatedQuery, page(req)));
export const adminAnalytics = respond(() => coupons.adminAnalytics());
export const adminGet = respond(async (req) => one(await coupons.adminGet(req.params.id)));
export const adminCreate = respond(
  async (req) => {
    const coupon = await coupons.create(req.body, req.user._id);
    req.auditResourceId = coupon._id;
    return one(coupon);
  },
  "Coupon created",
  201,
);
export const adminUpdate = respond(async (req) => one(await coupons.update(req.params.id, req.body)), "Coupon saved");
export const adminSetActive = respond(
  async (req) => one(await coupons.setActive(req.params.id, req.body.isActive)),
  (req) => (req.body.isActive ? "Coupon activated" : "Coupon deactivated"),
);
export const adminDuplicate = respond(
  async (req) => one(await coupons.duplicate(req.params.id, req.user._id)),
  "Coupon duplicated (switched off)",
  201,
);
export const adminDelete = respond(async (req) => {
  await coupons.remove(req.params.id);
  return null;
}, "Coupon deleted");
export const pending = respond((req) => coupons.pending(page(req)));
export const approve = respond(async (req) => one(await coupons.review(req.params.id, true, "", req.user._id)), "Offer approved");
export const reject = respond(
  async (req) => one(await coupons.review(req.params.id, false, req.body.reason, req.user._id)),
  "Offer rejected",
);

// Restaurant partners: their own offers
export const ownList = respond(async (req) => coupons.ownList(await own(req), req.validatedQuery, page(req)));
export const ownAnalytics = respond(async (req) => coupons.ownAnalytics(await own(req)));
export const ownGet = respond(async (req) => one(await coupons.ownGet(await own(req), req.params.id)));
export const ownCreate = respond(
  async (req) => one(await coupons.ownCreate(await own(req), req.body, req.user._id)),
  (_req, data) =>
    ({ draft: "Offer saved as a draft", pending: "Offer sent for approval" })[data.coupon.approvalStatus] ?? "Offer is live",
  201,
);
export const ownUpdate = respond(async (req) => one(await coupons.ownUpdate(await own(req), req.params.id, req.body)), "Offer saved");
export const ownSetActive = respond(
  async (req) => one(await coupons.ownSetActive(await own(req), req.params.id, req.body.isActive)),
  (req) => (req.body.isActive ? "Offer resumed" : "Offer paused"),
);
export const ownDelete = respond(async (req) => {
  await coupons.ownRemove(await own(req), req.params.id);
  return null;
}, "Offer deleted");
