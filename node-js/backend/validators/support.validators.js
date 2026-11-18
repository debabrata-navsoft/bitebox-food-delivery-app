import { body, query } from "express-validator";
import {
  REQUESTER_ROLES,
  TICKET_PRIORITY,
  TICKET_STATUS,
  TICKET_TYPES,
} from "../models/support-ticket.model.js";
import { MINE_STATUSES } from "../services/support.service.js";
import { filteredListRules, isObjectId, mongoIdParam, multiValue } from "./common.validators.js";

const message = (field = "message") =>
  body(field)
    .isString()
    .withMessage("Write a message")
    .bail()
    .trim()
    .isLength({ min: 2, max: 2000 })
    .withMessage("Message must be 2-2000 characters");

export const createTicketRules = [
  body("type").isIn(Object.values(TICKET_TYPES)).withMessage("Choose what this is about"),
  body("subject")
    .isString()
    .withMessage("Add a subject")
    .bail()
    .trim()
    .isLength({ min: 5, max: 120 })
    .withMessage("Subject must be 5-120 characters"),
  message(),
  body("orderNumber")
    .optional({ values: "falsy" })
    .isString()
    .trim()
    .matches(/^BB-\d{6}-[A-Z0-9]{6}$/i)
    .withMessage("Order numbers look like BB-261105-ABC123"),
];
// status: open, waiting_for_response, closed (`status=open` / `status=closed` work as before).
export const myTicketListRules = filteredListRules(
  [multiValue("status", MINE_STATUSES), multiValue("type", Object.values(TICKET_TYPES))],
  "created",
);
export const replyRules = [mongoIdParam(), message("body")];

export const staffListRules = filteredListRules(
  [
    // "active": not resolved or closed yet.
    multiValue("status", [...Object.values(TICKET_STATUS), "active"]),
    multiValue("priority", Object.values(TICKET_PRIORITY)),
    multiValue("requesterRole", REQUESTER_ROLES),
    multiValue("type", Object.values(TICKET_TYPES)),
    // "me" (the signed-in admin), "unassigned" or admins' user ids.
    multiValue("assignee", (v) => v === "me" || v === "unassigned" || isObjectId(v)),
    // Tickets one person raised (the admin customer profile).
    query("requester").optional().isMongoId().withMessage("Invalid id"),
  ],
  "created",
);
export const updateTicketRules = [
  mongoIdParam(),
  body("status").optional().isIn(Object.values(TICKET_STATUS)),
  body("priority").optional().isIn(Object.values(TICKET_PRIORITY)),
  // null or "" unassigns, so it must not be treated as "not sent" (validate drops those).
  body("assigneeId")
    .optional()
    .custom((v) => v === null || v === "" || /^[a-f\d]{24}$/i.test(v))
    .withMessage("Invalid assignee"),
  body("note").optional().isString().trim().isLength({ max: 500 }),
];
export const staffMessageRules = [
  mongoIdParam(),
  message("body"),
  body("internal").optional().isBoolean().toBoolean(),
];
export const escalateRules = [
  mongoIdParam(),
  body("note")
    .isString()
    .trim()
    .isLength({ min: 5, max: 500 })
    .withMessage("Explain what finance should check (5-500 characters)"),
];
