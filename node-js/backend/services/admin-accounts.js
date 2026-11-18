import mongoose from "mongoose";
import { env } from "../config/env.js";
import { nextDay, zoneDayStart } from "../utils/dates.js";
import { USER_STATUS } from "../models/user.model.js";
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

/** `{ $or }` matching `search` (any letter case) in any of `fields`, or null without a search. */
export function textSearch(search, fields) {
  if (!search) return null;
  const pattern = new RegExp(escapeRegex(search), "i");
  return { $or: fields.map((field) => ({ [field]: pattern })) };
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

/** `{ [field]: joinedRange(from, to) }`, or null when neither day is given. */
export function dayRange(field, from, to) {
  const range = joinedRange(from, to);
  return range && { [field]: range };
}

/** `object` with each value passed through `fn(value, key)`. */
export const mapValues = (object, fn) =>
  Object.fromEntries(Object.entries(object).map(([key, value]) => [key, fn(value, key)]));

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

/*
 * Multi-value filters and facet counts, shared by the admin lists.
 *
 * A list adopts them in four steps:
 *   1. validators: `multiValue(name, allowedValues | null)` per filter and `facetsQuery()`;
 *   2. one filter builder `filterFor(query)` (async allowed) returning a filter, or the stages up
 *      to the filtered rows; it reads each filter with `inList` / `anyMatch` (OR within a field)
 *      and joins them with `allOf` (AND across fields);
 *   3. a facet map, e.g. `{ status: USER_STATUS_FACET, city: openFacet("$address.city") }`
 *      (ids: `idFacet("$restaurant", Restaurant)` adds each one's name as `label`);
 *   4. `...(await facetsIf(query, Model, facets, filterFor))` in the result.
 */

/** A multi-value filter's values as a list: one value or several; nothing gives []. */
export const listOf = (value) =>
  value === undefined || value === null || value === "" ? [] : Array.isArray(value) ? value : [value];

/** `{ [field]: { $in: values } }` for the selected values (each through `map`), or null when none is. */
export function inList(field, value, map) {
  const values = listOf(value);
  return values.length ? { [field]: { $in: map ? values.map(map) : values } } : null;
}

/** `{ $or }` of `matches[value]` for the selected values, or null when none is. */
export function anyMatch(value, matches) {
  const values = listOf(value);
  return values.length ? { $or: values.map((v) => matches[v]) } : null;
}

/** A filter matching every given clause (falsy ones are skipped); `{}` when none is given. */
export function allOf(...clauses) {
  const and = clauses.filter(Boolean);
  return and.length ? { $and: and } : {};
}

/**
 * The KYC filter's stages for a list whose `stages()` add each row's `kycStatus`: none without
 * a selection (rows then get it on the page only), else the state for every row, then the match.
 */
export const kycFilterStages = (kyc, stages) =>
  listOf(kyc).length ? [...stages(), { $match: inList("kycStatus", kyc) }] : [];

/** Open-value facets list at most this many values. */
export const FACET_LIMIT = 50;

/**
 * Every value of `values`, in that order (0 when no row has it). `by` is an aggregation
 * expression giving a row's value; `stages` (array or function returning one) compute it first.
 */
export const fixedFacet = (values, by, stages = []) => ({ kind: "fixed", values, by, stages });
/** An account's status (users' `status`). */
export const USER_STATUS_FACET = fixedFacet(Object.values(USER_STATUS), "$status");
/** Fixed values that may overlap: `conditions` maps each value to a boolean expression. */
export const flagFacet = (conditions, stages = []) => ({ kind: "flags", conditions, stages });
/**
 * The values that occur (trimmed, the same name in any letter case once, capitals first), most
 * rows first then A to Z, at most FACET_LIMIT. Empty values are left out.
 */
export const openFacet = (by, stages = []) => ({ kind: "open", by, stages });

/**
 * The ids that occur (`by` gives a row's id), each `{ value: id, label, count }` with `label` the
 * `labelField` of that id's document in `Model` (null when it is gone): most rows first, then by
 * label A to Z (ignoring case), at most FACET_LIMIT. Rows without an id are left out.
 */
export const idFacet = (by, Model, { labelField = "name", stages = [] } = {}) => ({
  kind: "id",
  by,
  Model,
  labelField,
  stages,
});

/** An aggregation expression: `path` trimmed, "" when missing. */
export const trimmed = (path) => ({ $trim: { input: { $ifNull: [path, ""] } } });

/** The stages counting one facet, starting from the filtered rows. */
function countStages(facet) {
  const pre = typeof facet.stages === "function" ? facet.stages() : facet.stages;
  if (facet.kind === "flags") {
    const sums = Object.values(facet.conditions).map((cond, i) => [
      `c${i}`,
      { $sum: { $cond: [cond, 1, 0] } },
    ]);
    return [...pre, { $group: { _id: null, ...Object.fromEntries(sums) } }];
  }
  if (facet.kind === "fixed") return [...pre, { $group: { _id: facet.by, count: { $sum: 1 } } }];
  if (facet.kind === "id")
    return [
      ...pre,
      { $group: { _id: facet.by, count: { $sum: 1 } } },
      { $match: { _id: { $ne: null } } },
      {
        $lookup: {
          from: facet.Model.collection.name,
          localField: "_id",
          foreignField: "_id",
          pipeline: [{ $project: { [facet.labelField]: 1 } }],
          as: "doc",
        },
      },
      { $project: { count: 1, label: { $ifNull: [{ $first: `$doc.${facet.labelField}` }, null] } } },
      { $addFields: { key: { $toLower: { $ifNull: ["$label", ""] } } } },
      { $sort: { count: -1, key: 1, _id: 1 } },
      { $limit: FACET_LIMIT },
    ];
  return [
    ...pre,
    { $project: { v: trimmed(facet.by) } },
    { $match: { v: { $ne: "" } } },
    { $group: { _id: { $toLower: "$v" }, value: { $min: "$v" }, count: { $sum: 1 } } },
    { $sort: { count: -1, _id: 1, value: 1 } },
    { $limit: FACET_LIMIT },
  ];
}

/** `[{ value, count }]` (id facets: `[{ value, label, count }]`) from countStages' result rows. */
function shapeCounts(facet, rows) {
  if (facet.kind === "flags")
    return Object.keys(facet.conditions).map((value, i) => ({ value, count: rows[0]?.[`c${i}`] ?? 0 }));
  if (facet.kind === "fixed") {
    const counts = new Map(rows.map((r) => [r._id, r.count]));
    return facet.values.map((value) => ({ value, count: counts.get(value) ?? 0 }));
  }
  if (facet.kind === "id")
    return rows.map((r) => ({ value: String(r._id), label: r.label, count: r.count }));
  return rows.map((r) => ({ value: r.value, count: r.count }));
}

/**
 * `{ name: [{ value, count }] }` for every facet in `facets`, counted in the database. Each facet
 * applies the search, date ranges and every other filter, but not its own selection: facets with
 * no selection share one aggregation (`$facet`), each selected one runs its own.
 * `filterFor(query)` builds the list's filter or filter stages (see the adoption steps above).
 */
export async function facetCounts(Model, facets, filterFor, query) {
  const stagesFor = async (q) => {
    const filter = await filterFor(q);
    return Array.isArray(filter) ? filter : [{ $match: filter }];
  };
  const names = Object.keys(facets);
  const selected = names.filter((n) => listOf(query[n]).length);
  const shared = names.filter((n) => !selected.includes(n));
  const result = {};
  const jobs = selected.map(async (name) => {
    const rows = await Model.aggregate([
      ...(await stagesFor({ ...query, [name]: undefined })),
      ...countStages(facets[name]),
    ]);
    result[name] = shapeCounts(facets[name], rows);
  });
  if (shared.length)
    jobs.push(
      (async () => {
        const [row] = await Model.aggregate([
          ...(await stagesFor(query)),
          { $facet: Object.fromEntries(shared.map((n) => [n, countStages(facets[n])])) },
        ]);
        for (const name of shared) result[name] = shapeCounts(facets[name], row[name]);
      })(),
    );
  await Promise.all(jobs);
  return Object.fromEntries(names.map((n) => [n, result[n]]));
}

/** `{ facets }` (see facetCounts) when the query asks for them (`facets=1`), else `{}` (no queries). */
export const facetsIf = async (query, Model, facets, filterFor) =>
  query.facets ? { facets: await facetCounts(Model, facets, filterFor, query) } : {};

/**
 * One page of `Model.find(filterFor(query))` (`find` adds the sort, select, populate...), each
 * row through `map`, with its pagination and, with `facets=1`, the `facets` counts.
 */
export async function filteredPage(Model, query, pagination, { filterFor, facets, find, map = (row) => row }) {
  const filter = await filterFor(query);
  const [items, total, counts] = await Promise.all([
    find(Model.find(filter)).skip(pagination.skip).limit(pagination.limit),
    Model.countDocuments(filter),
    facetsIf(query, Model, facets, filterFor),
  ]);
  return { items: items.map((row) => map(row)), pagination: paginationMeta(pagination, total), ...counts };
}
