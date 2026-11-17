import { body, query } from "express-validator";
import { AUDIENCES, COUPON_SOURCES, DISCOUNT_TYPES } from "../models/coupon.model.js";
import { OFFER_KINDS, SORTS, STATUS_FILTERS } from "../services/coupon.service.js";
import { booleanQuery, mongoIdParam, paginationRules, searchQuery } from "./common.validators.js";

/** Coupons and restaurant offers (Django: apps/coupons/views.py serializers). */
const isId = (v) => /^[a-f0-9]{24}$/i.test(String(v));
const nullableInt = (field, min) =>
  body(field)
    .optional()
    .custom((v) => v === null || (Number.isInteger(Number(v)) && Number(v) >= min && v !== ""))
    .withMessage(`${field} must be a whole number of at least ${min}, or null`)
    .customSanitizer((v) => (v === null ? null : Number(v)));

const idList = (field, message) =>
  body(field)
    .optional()
    .isArray({ max: 200 })
    .withMessage(message)
    .custom((list) => list.every(isId))
    .withMessage(message);

function couponRules({ partial, partner }) {
  const field = (name) => (partial ? body(name).optional() : body(name));
  return [
    // Left out (or blank) on create: a code is generated.
    body("code")
      .optional()
      .isString()
      .trim()
      .toUpperCase()
      .custom((v) => v === "" || /^[A-Z0-9_-]{3,30}$/.test(v))
      .withMessage("Code: 3-30 letters, digits, - or _"),
    body("name").optional().isString().trim().isLength({ max: 80 }),
    body("description").optional().isString().trim().isLength({ max: 200 }),
    body("terms").optional().isString().trim().isLength({ max: 2000 }),
    field("discountType")
      .isIn(Object.values(DISCOUNT_TYPES))
      .withMessage("Choose percent, flat or free delivery"),
    // Percent (1-100) or paise; left out for free delivery.
    body("discountValue")
      .optional({ values: "null" })
      .isInt({ min: 1 })
      .withMessage("Discount must be a positive whole number")
      .toInt(),
    body("discountValue")
      .custom((v, { req }) =>
        !req.body.discountType || req.body.discountType === DISCOUNT_TYPES.FREE_DELIVERY || (v !== undefined && v !== null),
      )
      .withMessage("Discount must be a positive whole number"),
    nullableInt("maxDiscountPaise", 0),
    body("minOrderPaise").optional().isInt({ min: 0 }).toInt(),
    field("validFrom").isISO8601().withMessage("Invalid start date").toDate(),
    field("validUntil").isISO8601().withMessage("Invalid end date").toDate(),
    body("isActive").optional().isBoolean().toBoolean(),
    nullableInt("usageLimit", 1),
    body("perUserLimit").optional().isInt({ min: 1, max: 100 }).toInt(),
    body("audience").optional().isIn(Object.values(AUDIENCES)).withMessage("Invalid audience"),
    body("bannerUrl")
      .optional({ values: "null" })
      .isString()
      .trim()
      .custom((v) => v === "" || /^https?:\/\//i.test(v))
      .withMessage("Image must be an http(s) URL"),
    idList("categories", "Invalid category"),
    idList("foodItems", "Invalid dish"),
    ...(partner
      ? [body("draft").optional().isBoolean().toBoolean()]
      : [
          body("restaurant")
            .optional()
            .custom((v) => v === null || isId(v))
            .withMessage("Invalid restaurant"),
          idList("restaurants", "Invalid restaurant"),
        ]),
  ];
}

export const createCouponRules = couponRules({ partial: false, partner: false });
export const updateCouponRules = [mongoIdParam(), ...couponRules({ partial: true, partner: false })];
export const createOfferRules = couponRules({ partial: false, partner: true });
export const updateOfferRules = [mongoIdParam(), ...couponRules({ partial: true, partner: true })];

export const couponListRules = [
  ...paginationRules,
  searchQuery(),
  booleanQuery("active"),
  query("status").optional().isIn(Object.keys(STATUS_FILTERS)),
  query("owner").optional().isIn(Object.values(COUPON_SOURCES)),
  query("sort").optional().isIn(Object.keys(SORTS)),
  query("from").optional().isISO8601(),
  query("to").optional().isISO8601(),
];
export const activeRules = [mongoIdParam(), body("isActive").isBoolean().withMessage("isActive must be true or false").toBoolean()];
export const reasonRules = [mongoIdParam(), body("reason").optional().isString().trim().isLength({ max: 300 })];
export const availableCouponRules = [query("restaurantId").optional().isMongoId()];
export const offersRules = [query("type").optional().isIn(Object.keys(OFFER_KINDS))];
