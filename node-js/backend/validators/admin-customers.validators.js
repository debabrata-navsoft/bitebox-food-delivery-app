import { query } from "express-validator";
import { USER_STATUS } from "../models/user.model.js";
import {
  dayRangeRules,
  facetsQuery,
  multiValue,
  paginationRules,
  searchQuery,
} from "./common.validators.js";

export const CUSTOMER_SORTS = ["newest", "oldest", "name", "orders", "spent"];
export const CUSTOMER_VERIFICATION = [
  "email_verified",
  "email_unverified",
  "phone_verified",
  "phone_unverified",
];

/** GET /admin/customers */
export const customerListRules = [
  searchQuery(),
  multiValue("status", Object.values(USER_STATUS)),
  multiValue("verification", CUSTOMER_VERIFICATION),
  ...dayRangeRules("joinedFrom", "joinedTo", {
    message: "Use a date like 2026-01-31",
    orderMessage: "The end date must be on or after the start date",
  }),
  query("sort").optional().isIn(CUSTOMER_SORTS),
  facetsQuery(),
  ...paginationRules,
];
