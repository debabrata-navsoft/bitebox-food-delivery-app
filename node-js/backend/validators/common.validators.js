import { body, param, query } from "express-validator";

export const mongoIdParam = (name = "id") =>
  param(name).isMongoId().withMessage("Invalid id");

export const paginationRules = [
  query("page").optional().isInt({ min: 1, max: 10_000 }).toInt(),
  query("limit").optional().isInt({ min: 1, max: 100 }).toInt(),
];

export const searchQuery = () =>
  query("search").optional().isString().trim().isLength({ max: 100 });

export const booleanQuery = (name) =>
  query(name)
    .optional()
    .isBoolean()
    .withMessage(`${name} must be true or false`)
    .toBoolean();

export const imageUrlBody = (field = "imageUrl") =>
  body(field)
    .optional({ values: "null" })
    .isString()
    .trim()
    .custom(
      (value) =>
        value === "" || /^https?:\/\/[^\s"'()\\<>]{1,490}$/i.test(value),
    )
    .withMessage("Image must be an http(s) URL");

export const paiseBody = (
  field,
  { optional = false, min = 0, max = 10_000_000 } = {},
) => {
  const chain = body(field);
  return (optional ? chain.optional() : chain)
    .isInt({ min, max })
    .withMessage(
      `${field} must be a whole number of paise between ${min} and ${max}`,
    )
    .toInt();
};

export const latitudeRule = (chain) =>
  chain
    .isFloat({ min: -90, max: 90 })
    .withMessage("Invalid latitude")
    .toFloat();
export const longitudeRule = (chain) =>
  chain
    .isFloat({ min: -180, max: 180 })
    .withMessage("Invalid longitude")
    .toFloat();

/** A real calendar day written YYYY-MM-DD. */
const isDay = (value) =>
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

/** Optional `from` and `to` days (YYYY-MM-DD); `to` before `from` fails on `to`. */
export function dayRangeRules(from, to, { message = "Invalid value", orderMessage = message } = {}) {
  const day = (name) => query(name).optional().isString().custom(isDay).withMessage(message);
  return [
    day(from),
    day(to)
      .bail()
      .custom((value, { req }) => {
        const start = req.query[from];
        return !(typeof start === "string" && isDay(start) && start > value);
      })
      .withMessage(orderMessage),
  ];
}

/** A `reason` (3-500 characters, trimmed), required when `when` (a condition) holds. */
export const requiredReason = (when) =>
  body("reason")
    .if(when)
    .exists({ values: "falsy" })
    .withMessage("Give a reason")
    .bail()
    .isString()
    .trim()
    .isLength({ min: 3, max: 500 })
    .withMessage("The reason must be 3-500 characters");

/**
 * A query value as a list: comma-separated (`status=active,suspended`) and/or repeated, each item
 * trimmed, empty items dropped. Non-string items are kept so validation rejects them.
 */
export const splitList = (value) =>
  (Array.isArray(value) ? value : [value])
    .flatMap((v) => (typeof v === "string" ? v.split(",") : [v]))
    .map((v) => (typeof v === "string" ? v.trim() : v))
    .filter((v) => v !== "");

/** A 24-character hex id (a MongoDB ObjectId as text). */
const isObjectId = (value) => /^[0-9a-f]{24}$/i.test(value);

/**
 * A multi-value list filter: one value or several, comma-separated, sanitised to an array (empty
 * when nothing usable was given, which services treat as "no filter"). `allowed` is the list of
 * valid values, a test (`(value) => boolean`), or null for free text of 1-`maxLength`
 * characters. Any invalid item fails the field.
 */
export function multiValue(name, allowed, { message = "Invalid value", maxLength = 60, maxItems = 50 } = {}) {
  const valid =
    typeof allowed === "function"
      ? allowed
      : allowed
        ? (v) => allowed.includes(v)
        : (v) => v.length <= maxLength;
  return query(name)
    .optional()
    .customSanitizer(splitList)
    .custom((values) => values.length <= maxItems && values.every((v) => typeof v === "string" && valid(v)))
    .withMessage(message);
}

/** A multi-value filter of ids (restaurants, categories...): each item must be an id. */
export const multiId = (name) => multiValue(name, isObjectId);

/** `facets=1` (true/false/1/0): also return the list's facet counts (see admin-accounts#facetCounts). */
export const facetsQuery = () => booleanQuery("facets");
