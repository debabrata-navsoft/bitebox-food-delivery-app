import { body, query } from "express-validator";
import { VEHICLE_TYPES, VERIFICATION_STATUS } from "../models/delivery-partner.model.js";
import { USER_STATUS } from "../models/user.model.js";
import { KYC_STATES } from "../services/kyc.service.js";
import { updateMemberRules } from "./admin-staff.validators.js";
import {
  dayRangeRules,
  mongoIdParam,
  paginationRules,
  requiredReason,
  searchQuery,
} from "./common.validators.js";
import {
  adminRiderVerificationRules,
  riderAddressRules,
  vehicleNumberRule,
  vehicleTypeRule,
} from "./order-management.validators.js";

export const RIDER_ACCOUNT_SORTS = ["newest", "oldest", "name", "deliveries", "rating"];
export const RIDER_AVAILABILITY = ["online", "offline", "busy"];

/** GET /admin/delivery-partner-accounts */
export const riderAccountListRules = [
  searchQuery(),
  query("accountStatus").optional().isIn(Object.values(USER_STATUS)),
  query("verification").optional().isIn(Object.values(VERIFICATION_STATUS)),
  query("availability").optional().isIn(RIDER_AVAILABILITY),
  query("kyc").optional().isIn(KYC_STATES),
  query("zone").optional().isString().trim().isLength({ min: 1, max: 60 }),
  query("vehicleType").optional().isIn(VEHICLE_TYPES),
  ...dayRangeRules("joinedFrom", "joinedTo", { message: "Invalid value" }),
  query("sort").optional().isIn(RIDER_ACCOUNT_SORTS),
  ...paginationRules,
];

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
// Conditions are functions: a chain used as a condition records its own errors.
const contactGiven = (_value, { req }) => isObject(req.body.emergencyContact);

/**
 * PATCH /admin/delivery-partner-accounts/:id: the admin member edit (name, gender, birthDate,
 * avatarUrl), the rider's own address and vehicle rules, the emergency contact (null clears it)
 * and the zone (null or "" clears it). Anything else (email, phone, password, status, role) is dropped.
 */
export const riderAccountUpdateRules = [
  ...updateMemberRules,
  ...riderAddressRules((_value, { req }) => req.body.address !== undefined),
  body("emergencyContact.name")
    .if(contactGiven)
    .isString()
    .withMessage("Name must be 2-80 characters")
    .bail()
    .trim()
    .isLength({ min: 2, max: 80 })
    .withMessage("Name must be 2-80 characters"),
  body("emergencyContact.phone")
    .if(contactGiven)
    .isString()
    .withMessage("Enter a valid phone number (10-15 digits)")
    .bail()
    .trim()
    .matches(/^\+?[0-9]{10,15}$/)
    .withMessage("Enter a valid phone number (10-15 digits)"),
  body("emergencyContact.relation")
    .if(contactGiven)
    .optional({ values: "null" })
    .isString()
    .bail()
    .trim()
    .isLength({ max: 40 })
    .withMessage("Relation must be at most 40 characters"),
  // After its fields, so a null (clear) is what reaches the service.
  body("emergencyContact")
    .optional()
    .custom((v) => v === null || isObject(v))
    .withMessage("Give the emergency contact's name and phone, or null"),
  vehicleTypeRule().optional(),
  vehicleNumberRule(),
  body("zone")
    .optional()
    .custom((v) => v === null || (typeof v === "string" && v.trim().length <= 60))
    .withMessage("Zone must be at most 60 characters")
    .customSanitizer((v) => (typeof v === "string" ? v.trim() || null : v)),
];

/** PATCH .../:id/verification: the rider verification rules, plus a reason unless approving. */
export const riderAccountVerificationRules = [
  ...adminRiderVerificationRules,
  requiredReason((_value, { req }) =>
    [VERIFICATION_STATUS.REJECTED, VERIFICATION_STATUS.RESUBMISSION_REQUESTED].includes(req.body.status),
  ),
];

/** PATCH .../:id/availability: admins only take riders offline, with a reason. */
export const riderAccountAvailabilityRules = [
  mongoIdParam(),
  body("isOnline")
    .isBoolean()
    .withMessage("isOnline must be true or false")
    .bail()
    .toBoolean()
    .custom((v) => v === false)
    .withMessage("Only the rider can go online"),
  requiredReason((_value, { req }) => req.body.isOnline === false || req.body.isOnline === "false"),
];
