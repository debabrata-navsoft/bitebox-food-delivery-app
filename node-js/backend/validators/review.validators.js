import { body, query } from "express-validator";
import { REPORT_REASONS, REVIEW_POLICY } from "../config/reviews.js";
import { MODERATION_MOVES } from "../services/review-moderation.service.js";
import {
  REVIEW_STATUS,
  REVIEW_TARGETS,
} from "../models/review.model.js";
import { isUploadedImageUrl } from "../services/upload.service.js";
import { RATINGS, REPLY_STATES, WITH_OR_WITHOUT } from "../services/review.service.js";
import {
  booleanQuery,
  filteredListRules,
  mongoIdParam,
  multiId,
  multiValue,
  paginationRules,
} from "./common.validators.js";

const T = REVIEW_TARGETS;
const P = REVIEW_POLICY;

const ratingOf = (field, optional = true) =>
  (optional ? body(field).optional() : body(field))
    .isInt({ min: 1, max: 5 })
    .withMessage("Choose a rating from 1 to 5 stars")
    .toInt();
const commentBody = () =>
  body("comment")
    .optional({ values: "null" })
    .isString()
    .withMessage("Comment must be text")
    .trim()
    .isLength({ max: P.commentMaxLength })
    .withMessage(`Keep the review under ${P.commentMaxLength} characters`);
const imagesBody = (field = "images") => [
  body(field)
    .optional()
    .isArray({ max: P.maxImages })
    .withMessage(`Add up to ${P.maxImages} photos`),
  body(`${field}.*`)
    .isString()
    .custom(isUploadedImageUrl)
    .withMessage("Upload photos through BiteBox"),
];
const reasonBody = (max, message = "Give a reason") =>
  body("reason")
    .exists({ values: "falsy" })
    .withMessage(message)
    .bail()
    .isString()
    .trim()
    .isLength({ min: 3, max })
    .withMessage(`The reason must be 3 to ${max} characters`);

const ratingQuery = () =>
  query("rating").optional().isInt({ min: 1, max: 5 }).toInt();
const sortQuery = () =>
  query("sort").optional().isIn(["newest", "oldest", "highest", "lowest"]);

export const publicListRules = [ratingQuery(), sortQuery(), ...paginationRules];
export const publicFoodListRules = [mongoIdParam(), ...publicListRules];

// Customer
export const createRules = [
  body("orderId").isMongoId().withMessage("Invalid order"),
  body("target")
    .isIn(Object.values(T))
    .withMessage("Review the restaurant, a dish or the rider"),
  body("foodItemId")
    .if(body("target").equals(T.FOOD))
    .isMongoId()
    .withMessage("Choose the dish you are reviewing"),
  ratingOf("rating", false),
  commentBody(),
  ...imagesBody(),
  body("images")
    .if(body("target").equals(T.RIDER))
    .not()
    .exists()
    .withMessage("Delivery ratings don't take photos"),
];
export const updateRules = [
  mongoIdParam(),
  ratingOf("rating"),
  commentBody(),
  ...imagesBody(),
  body().custom((value) => {
    if (
      value?.rating === undefined &&
      value?.comment === undefined &&
      value?.images === undefined
    )
      throw new Error("Change the rating, the comment or the photos");
    return true;
  }),
];
/** One "Rate your experience" submission: restaurant, food quality and delivery, plus words and photos. */
export const orderReviewRules = [
  mongoIdParam(),
  ratingOf("restaurant"),
  ratingOf("food"),
  ratingOf("rider"),
  commentBody(),
  ...imagesBody(),
  body().custom((value) => {
    const { restaurant, food, rider, comment, images } = value ?? {};
    if (restaurant === undefined && food === undefined && rider === undefined)
      throw new Error("Rate at least one part of the order");
    if ((comment || images?.length) && restaurant === undefined)
      throw new Error("Rate the restaurant to add a review or photos");
    return true;
  }),
];
export const mineRules = [
  query("target").optional().isIn(Object.values(T)),
  sortQuery(),
  ...paginationRules,
];
export const reportRules = [
  mongoIdParam(),
  body("reason")
    .isIn(REPORT_REASONS)
    .withMessage(`Reason must be one of: ${REPORT_REASONS.join(", ")}`),
  body("note")
    .optional({ values: "falsy" })
    .isString()
    .trim()
    .isLength({ max: P.reportNoteMaxLength })
    .withMessage(`Keep the note under ${P.reportNoteMaxLength} characters`),
];

// Restaurant
// target, rating, reply, photos and dish: one value or several, comma-separated (any of them);
// `rating=4`, foodItemId and responded still work.
export const restaurantListRules = filteredListRules(
  [
    multiValue("target", [T.RESTAURANT, T.FOOD]),
    multiValue("rating", RATINGS),
    multiValue("reply", REPLY_STATES),
    multiValue("photos", WITH_OR_WITHOUT),
    multiId("dish"),
    query("foodItemId").optional().isMongoId(),
    booleanQuery("responded"),
    sortQuery(),
  ],
  "created",
);
export const responseRules = [
  mongoIdParam(),
  body("text")
    .isString()
    .withMessage("Write a reply")
    .trim()
    .isLength({ min: 2, max: P.responseMaxLength })
    .withMessage(`The reply must be 2 to ${P.responseMaxLength} characters`),
];

// Rider
// rating and comment: one value or several, comma-separated (any of them).
export const riderListRules = filteredListRules(
  [multiValue("rating", RATINGS), multiValue("comment", WITH_OR_WITHOUT), sortQuery()],
  "created",
);

// Admin
// target, status, rating and restaurant: one value or several, comma-separated (any of them).
export const adminListRules = filteredListRules(
  [
    multiValue("target", Object.values(T)),
    multiValue("status", Object.values(REVIEW_STATUS)), // none: every status but deleted
    multiValue("rating", RATINGS),
    multiId("restaurant"),
    // One restaurant's reviews (the admin restaurant account view's links).
    query("restaurantId").optional().isMongoId(),
    // Orders of one customer that have reviews (the admin customer profile).
    query("customer").optional().isMongoId().withMessage("Invalid id"),
    // Orders with a review of one rider (the admin delivery partner account view).
    query("rider").optional().isMongoId().withMessage("Invalid id"),
    booleanQuery("reported"),
  ],
  "created",
);
export const moderateRules = [
  mongoIdParam(),
  body("action")
    .isIn(Object.keys(MODERATION_MOVES))
    .withMessage("Action must be hide, remove or restore"),
  reasonBody(P.moderationReasonMaxLength, "Record why (customers see this)"),
];
export const dismissRules = [
  mongoIdParam(),
  reasonBody(P.moderationReasonMaxLength),
];
