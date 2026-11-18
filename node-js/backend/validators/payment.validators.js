import { body, query } from "express-validator";
import { PAYMENT_METHODS, PAYMENT_STATUS } from "../models/order.model.js";
import { PAYMENT_PROVIDERS } from "../services/payments/payment.service.js";
import { filteredListRules, mongoIdParam, multiId, multiValue } from "./common.validators.js";

export const orderIdRules = [mongoIdParam("orderId")];
export const confirmRules = [
  mongoIdParam("orderId"),
  body("providerPaymentId")
    .isString()
    .trim()
    .isLength({ min: 4, max: 100 })
    .withMessage("Missing payment id"),
  body("signature")
    .isString()
    .trim()
    .isLength({ min: 16, max: 200 })
    .withMessage("Missing signature"),
];
export const mockRules = [
  mongoIdParam("orderId"),
  body("outcome")
    .isIn(["success", "failure"])
    .withMessage("Outcome must be success or failure"),
];
export const daysRules = [
  query("days").optional().isInt({ min: 1, max: 365 }).toInt(),
];
// search: the order number, or the customer's name, email or phone.
export const adminPaymentListRules = filteredListRules([
  multiValue("status", Object.values(PAYMENT_STATUS)),
  multiValue("method", Object.values(PAYMENT_METHODS)),
  multiValue("provider", PAYMENT_PROVIDERS),
  // Where the order stands (`cancelled` includes rejected).
  multiValue("orderState", ["active", "delivered", "cancelled"]),
  multiId("restaurant"), // the orders' restaurants
  query("from").optional().isISO8601().toDate(),
  query("to").optional().isISO8601().toDate(),
  // Payments of one customer's orders (the admin customer profile).
  query("customer").optional().isMongoId().withMessage("Invalid id"),
]);
export const paymentIdRules = [mongoIdParam()];
export const refundRules = [
  mongoIdParam(),
  body("amountPaise")
    .isInt({ min: 1 })
    .withMessage("Enter an amount to refund")
    .toInt(),
  body("reason")
    .exists({ values: "falsy" })
    .withMessage("Give a reason")
    .bail()
    .isString()
    .trim()
    .isLength({ min: 1, max: 300 })
    .withMessage("Keep the reason under 300 characters"),
];
