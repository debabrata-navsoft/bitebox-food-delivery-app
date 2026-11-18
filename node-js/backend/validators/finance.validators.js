import { body, param, query } from "express-validator";
import { PAYOUT_STATUS, PAYOUT_TYPES } from "../models/payout.model.js";
import { LEDGER_ACCOUNTS } from "../models/ledger-entry.model.js";
import { LEDGER_EVENTS } from "../services/ledger.service.js";
import { SETTLEMENT_STATES } from "../services/finance.service.js";
import { filteredListRules, mongoIdParam, multiId, multiValue } from "./common.validators.js";

const payoutType = (location) =>
  location("type")
    .isIn(Object.values(PAYOUT_TYPES))
    .withMessage("Type must be restaurant or rider");

export const dueRules = [payoutType(query)];
export const listPayoutRules = filteredListRules(
  [
    multiValue("type", Object.values(PAYOUT_TYPES)),
    multiValue("status", Object.values(PAYOUT_STATUS)),
    // Restaurants' payouts (one: the admin restaurant account view).
    multiId("restaurant"),
    // Riders' payouts (user ids; one: the admin delivery partner account view).
    multiId("rider"),
  ],
  "created",
);
// A partner's own payouts and settlements (/my/restaurant/..., /delivery/...).
export const myPayoutRules = filteredListRules([multiValue("status", Object.values(PAYOUT_STATUS))], "created");
export const mySettlementRules = filteredListRules([multiValue("status", SETTLEMENT_STATES)], "settled");
export const createPayoutRules = [
  payoutType(body),
  body("payeeId").isMongoId().withMessage("Choose who to pay"),
  body("note").optional().isString().trim().isLength({ max: 500 }),
];
export const payPayoutRules = [
  mongoIdParam(),
  body("reference")
    .isString()
    .trim()
    .isLength({ min: 3, max: 120 })
    .withMessage("Enter the bank or UPI transfer reference"),
];
export const cancelPayoutRules = [
  mongoIdParam(),
  body("note").optional().isString().trim().isLength({ max: 500 }),
];
export const refundListRules = filteredListRules(
  [multiValue("state", ["needed", "refunded"]), multiId("restaurant")], // the orders' restaurants
  "updated",
);
export const transactionRules = [param("id").isMongoId()];
export const idParam = () => mongoIdParam();
export const ledgerRules = filteredListRules(
  [multiValue("account", LEDGER_ACCOUNTS), multiValue("event", Object.keys(LEDGER_EVENTS))],
  "created",
);
export const commissionRuleRules = [
  body("restaurantId").optional({ values: "null" }).isMongoId().withMessage("Invalid restaurant"),
  body("basisPoints")
    .isInt({ min: 0, max: 5000 })
    .withMessage("Commission must be between 0 and 50 percent")
    .toInt(),
  body("note").optional().isString().trim().isLength({ max: 300 }),
];
export const csvRules = [
  query("from").optional().isISO8601().toDate(),
  query("to").optional().isISO8601().toDate(),
];
