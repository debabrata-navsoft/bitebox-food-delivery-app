import { body, query } from "express-validator";
import { VEHICLE_TYPES, VERIFICATION_STATUS } from "../models/delivery-partner.model.js";
import { ORDER_STATUS, PAYMENT_METHODS, PAYMENT_STATUS } from "../models/order.model.js";
import {
  booleanQuery,
  dayRangeRules,
  facetsQuery,
  multiId,
  multiValue,
  latitudeRule,
  longitudeRule,
  mongoIdParam,
  paginationRules,
  searchQuery,
} from "./common.validators.js";
import { RIDER_AVAILABILITY, RIDER_VERIFICATION_FILTERS } from "../services/admin-delivery-partners.service.js";

const S = ORDER_STATUS;
const reason = (required = false) => {
  const chain = body("reason");
  return (
    required
      ? chain.exists({ values: "falsy" }).withMessage("Give a reason")
      : chain.optional()
  )
    .isString()
    .trim()
    .isLength({ max: 300 })
    .withMessage("Keep the reason under 300 characters");
};
const latitude = () => latitudeRule(body("latitude"));
const longitude = () => longitudeRule(body("longitude"));

// Customer
export const customerCancelRules = [mongoIdParam(), reason()];

// Restaurant
export const restaurantListRules = [
  query("view").optional().isIn(["active", "history"]),
  query("status").optional().isIn(Object.values(S)),
  ...paginationRules,
];
export const restaurantStatusRules = [
  mongoIdParam(),
  body("status")
    .isIn([S.CONFIRMED, S.REJECTED, S.PREPARING, S.READY_FOR_PICKUP])
    .withMessage(
      "Status must be confirmed, rejected, preparing or ready_for_pickup",
    ),
  reason(),
  // With "confirmed": how long the food takes (the restaurant's usual time when left out).
  body("prepMinutes")
    .optional({ values: "null" })
    .isInt({ min: 5, max: 120 })
    .withMessage("Preparation time must be 5 to 120 minutes")
    .toInt(),
];

// Rider
// The rider's vehicle (PUT /delivery/me/vehicle; the admin rider edit makes the type optional).
export const vehicleTypeRule = () =>
  body("vehicleType")
    .isIn(VEHICLE_TYPES)
    .withMessage(`Vehicle must be one of: ${VEHICLE_TYPES.join(", ")}`);
export const vehicleNumberRule = () =>
  body("vehicleNumber")
    .optional({ values: "falsy" })
    .isString()
    .trim()
    .matches(/^[A-Za-z0-9 -]{4,20}$/)
    .withMessage("Enter a valid vehicle number");
export const vehicleRules = [vehicleTypeRule(), vehicleNumberRule()];
export const availabilityRules = [
  body("isOnline")
    .isBoolean()
    .withMessage("isOnline must be true or false")
    .toBoolean(),
  latitudeRule(body("latitude").optional()),
  longitudeRule(body("longitude").optional()),
];
export const locationRules = [latitude(), longitude()];
export const offerRules = [mongoIdParam()];
export const riderStatusRules = [
  mongoIdParam(),
  body("status")
    .isIn([S.ARRIVED_AT_RESTAURANT, S.PICKED_UP, S.ON_THE_WAY, S.DELIVERED])
    .withMessage(
      "Status must be arrived_at_restaurant, picked_up, on_the_way or delivered",
    ),
  // The customer's delivery code, needed with "delivered".
  body("otp")
    .optional({ values: "falsy" })
    .isString()
    .matches(/^\d{4}$/)
    .withMessage("Enter the 4-digit code"),
];
export const riderHistoryRules = paginationRules;

// Admin
export const adminOrderListRules = [
  // Several values allowed (OR); `active` = every in-progress status.
  multiValue("status", [...Object.values(S), "active"]),
  multiValue("paymentMethod", Object.values(PAYMENT_METHODS)),
  multiValue("paymentStatus", Object.values(PAYMENT_STATUS)),
  ...dayRangeRules("placedFrom", "placedTo"),
  searchQuery(),
  // Orders placed by one customer (the admin user view).
  query("customer").optional().isMongoId().withMessage("Invalid id"),
  // Orders placed with one or several restaurants (also the admin restaurant account view).
  multiId("restaurant"),
  // Orders assigned to one rider (the admin delivery partner account view).
  query("rider").optional().isMongoId().withMessage("Invalid id"),
  facetsQuery(),
  ...paginationRules,
];
export const adminCancelRules = [mongoIdParam(), reason(true)];
export const adminUnassignRules = [mongoIdParam(), reason()];
export const adminAssignRules = [
  mongoIdParam(),
  body("riderId")
    .exists({ values: "falsy" })
    .withMessage("Choose a delivery partner")
    .bail()
    .isMongoId()
    .withMessage("Choose a delivery partner"),
];
export const adminRiderListRules = [
  searchQuery(),
  booleanQuery("online"),
  // One value or several, comma-separated (OR).
  multiValue("verification", RIDER_VERIFICATION_FILTERS),
  multiValue("availability", RIDER_AVAILABILITY),
  multiValue("vehicleType", VEHICLE_TYPES),
  multiValue("zone", null),
  facetsQuery(),
  ...paginationRules,
];
export const adminRiderVerificationRules = [
  mongoIdParam(),
  body("status")
    .isIn([VERIFICATION_STATUS.APPROVED, VERIFICATION_STATUS.REJECTED, VERIFICATION_STATUS.RESUBMISSION_REQUESTED])
    .withMessage("Choose approved, rejected or resubmission_requested"),
  body("reason").optional().isString().trim().isLength({ max: 500 }),
];
/** The rider's home address (the whole address each time). `when` (a condition) makes it conditional. */
export const riderAddressRules = (when) => {
  const field = (name) => (when ? body(name).if(when) : body(name));
  const text = (name, min, max, message) => field(name).isString().trim().isLength({ min, max }).withMessage(message);
  return [
    text("address.line1", 3, 120, "Street address is required"),
    field("address.line2").optional().isString().trim().isLength({ max: 120 }),
    field("address.area").optional().isString().trim().isLength({ max: 80 }),
    text("address.city", 2, 60, "City is required"),
    text("address.state", 2, 60, "State is required"),
    field("address.postalCode").isString().trim().matches(/^[A-Za-z0-9 -]{3,10}$/).withMessage("Enter a valid postal code"),
  ];
};
export const riderDetailsRules = riderAddressRules();
// Same rules as every account status change (reason needed unless reactivating).
export { accountStatusRules as adminRiderStatusRules } from "./admin-staff.validators.js";
