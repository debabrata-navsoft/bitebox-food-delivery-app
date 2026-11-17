import mongoose from "mongoose";
import { env } from "../config/env.js";
import { nextDay, zoneDayStart } from "../utils/dates.js";
import { escapeRegex, paginationMeta } from "../utils/pagination.js";
import { phoneForms } from "./otp.service.js";

/**
 * Helpers shared by the admin account pages (customers, restaurant accounts, delivery partner
 * accounts): list search and filters, sorting and paging in one aggregation, audit field forms.
 */

export const toId = (id) => new mongoose.Types.ObjectId(String(id));

/** `search` as the tail of an id ("#A1B2C3D4" as shown in the app, or the full id), else null. */
function idSuffix(search) {
  const hex = search.replace(/^#/, "").toLowerCase();
  return /^[0-9a-f]{6,24}$/.test(hex) ? hex : null;
}

/** A clause matching documents whose `_id` is `search` or ends with it (see idSuffix), or null. */
export function idSearch(search) {
  const suffix = idSuffix(search);
  return suffix
    ? { $expr: { $regexMatch: { input: { $toString: "$_id" }, regex: `${suffix}$` } } }
    : null;
}

/** Clauses matching a person's name, email or phone (a number in any stored form). */
export function personSearch(search) {
  const pattern = new RegExp(escapeRegex(search), "i");
  const or = [{ name: pattern }, { email: pattern }, { phone: pattern }];
  // "+91 98765 43210" finds "9876543210".
  if (/\d/.test(search)) or.push({ phone: { $in: phoneForms(search) } });
  return or;
}

/** A `createdAt` condition for inclusive YYYY-MM-DD days in the report time zone, or null. */
export function joinedRange(joinedFrom, joinedTo) {
  if (!joinedFrom && !joinedTo) return null;
  const tz = env.reportTimezone;
  return {
    ...(joinedFrom && { $gte: zoneDayStart(joinedFrom, tz) }),
    ...(joinedTo && { $lt: zoneDayStart(nextDay(joinedTo), tz) }),
  };
}

/** Matches a typed name (a city, a zone) exactly, ignoring letter case and outer spaces. */
export const sameName = (name) => new RegExp(`^\\s*${escapeRegex(name.trim())}\\s*$`, "i");

/** Trimmed, non-empty values A to Z ignoring case; the same value in other cases once, capitals first. */
export function distinctNames(values) {
  const names = values
    .map((c) => String(c ?? "").trim())
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" }) || (a < b ? -1 : a > b ? 1 : 0));
  const seen = new Set();
  return names.filter((c) => {
    const key = c.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export const NEWEST = { createdAt: -1, _id: -1 };
/** The sorts every account list has (newest, oldest, name A to Z), plus the list's own. */
export const listSorts = (own) => ({
  newest: NEWEST,
  oldest: { createdAt: 1, _id: 1 },
  name: { name: 1, ...NEWEST },
  ...own,
});

/**
 * Runs `pipeline` on `Model`, sorts by `sorts[sort]` (names A to Z regardless of case) and cuts
 * one page; `rowStages` then run on the page's rows only. Returns { rows, pagination }.
 */
export async function aggregatePage(Model, pipeline, { sort, sorts, rowStages = [] }, pagination) {
  let aggregate = Model.aggregate([
    ...pipeline,
    { $sort: sorts[sort] },
    {
      $facet: {
        rows: [{ $skip: pagination.skip }, { $limit: pagination.limit }, ...rowStages],
        total: [{ $count: "n" }],
      },
    },
  ]);
  if (sort === "name") aggregate = aggregate.collation({ locale: "en", strength: 2 });
  const [{ rows, total }] = await aggregate;
  return { rows, pagination: paginationMeta(pagination, total[0]?.n ?? 0) };
}

/** `{ status, missing }` for one restaurant or rider: `stages` are its list's KYC stages. */
export async function kycSummary(Model, id, stages) {
  const [row] = await Model.aggregate([
    { $match: { _id: toId(id) } },
    ...stages,
    { $project: { kycStatus: 1, kycMissing: 1 } },
  ]);
  return { status: row.kycStatus, missing: row.kycMissing };
}

export const ratingOf = (doc) => ({
  average: doc.rating?.average ?? 0,
  count: doc.rating?.count ?? 0,
});

// What admin edits record: plain values (blank as null), an address per line.
export const blank = (value) => (value === "" || value === undefined ? null : value);
export const ADDRESS_FIELDS = ["line1", "line2", "area", "city", "state", "postalCode"];
export const ADDRESS_LINES = ADDRESS_FIELDS.map((f) => `address.${f}`);
export const addressLines = (address) =>
  Object.fromEntries(ADDRESS_FIELDS.map((f) => [`address.${f}`, blank(address?.[f])]));
