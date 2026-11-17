import { body, query } from "express-validator";
import {
  booleanQuery,
  facetsQuery,
  imageUrlBody,
  multiId,
  multiValue,
  mongoIdParam,
  paginationRules,
  paiseBody,
  searchQuery,
} from "./common.validators.js";
import { FOOD_AVAILABILITY, FOOD_TYPES } from "../services/food.service.js";

function foodRules({ partial }) {
  const field = (name) => (partial ? body(name).optional() : body(name));
  return [
    field("name")
      .isString()
      .trim()
      .isLength({ min: 2, max: 100 })
      .withMessage("Name must be 2-100 characters"),
    body("description").optional().isString().trim().isLength({ max: 500 }),
    field("category").isMongoId().withMessage("Choose a category"),
    paiseBody("pricePaise", { optional: partial, min: 100 }),
    field("isVeg")
      .isBoolean()
      .withMessage("Mark the dish as veg or non-veg")
      .toBoolean(),
    body("isAvailable").optional().isBoolean().toBoolean(),
    imageUrlBody(),
    // null clears it, so it must reach the service (validate drops "not sent" fields).
    body("prepTimeMinutes")
      .optional()
      .if((v) => v !== null)
      .isInt({ min: 1, max: 180 })
      .toInt(),
    body("tags").optional().isArray({ max: 10 }),
    body("tags.*").isString().trim().isLength({ min: 1, max: 30 }),
  ];
}

export const createFoodRules = foodRules({ partial: false });
export const updateFoodRules = [
  mongoIdParam(),
  ...foodRules({ partial: true }),
];
export const availabilityRules = [
  mongoIdParam(),
  body("isAvailable")
    .isBoolean()
    .withMessage("isAvailable must be true or false")
    .toBoolean(),
];

const listRules = [
  ...paginationRules,
  searchQuery(),
  query("category").optional().isMongoId(),
  booleanQuery("available"),
  booleanQuery("veg"),
];

export const ownerListRules = listRules;
export const adminListRules = [
  ...paginationRules,
  searchQuery(),
  booleanQuery("available"),
  booleanQuery("veg"),
  // One value or several, comma-separated (OR).
  multiId("restaurant"),
  multiId("category"),
  multiValue("type", FOOD_TYPES),
  multiValue("availability", FOOD_AVAILABILITY),
  facetsQuery(),
];
export const publicSearchRules = [
  ...paginationRules,
  searchQuery(),
  query("category").optional().isMongoId(),
  booleanQuery("veg"),
];
