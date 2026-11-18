// Shared fixtures of the list filter tests (multi-value filters and facet counts). Fictional data only.
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { env } from "../config/env.js";
import { Restaurant } from "../models/restaurant.model.js";
import { User } from "../models/user.model.js";
import { zoneDayStart } from "../utils/dates.js";

export const oid = () => new mongoose.Types.ObjectId();
export const auth = (token) => ({ Authorization: `Bearer ${token}` });

/** The data of a 200 response. */
export function ok(res) {
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body.data;
}
/** Each row's `key`, sorted. */
export const listed = (res, key) => ok(res).items.map((r) => r[key]).sort();
/** A facet as { value: count }, in the response's order. */
export const counts = (res, name) => Object.fromEntries(ok(res).facets[name].map((f) => [f.value, f.count]));
/** A 422 response's { field: message }. */
export function fieldErrors(res) {
  assert.equal(res.status, 422, JSON.stringify(res.body));
  return Object.fromEntries(res.body.error.details.map((d) => [d.field, d.message]));
}
/** A time on a calendar day in the report time zone (noon unless `hour` is given). */
export const at = (day, hour = 12) => new Date(zoneDayStart(day, env.reportTimezone).getTime() + hour * 3_600_000);

let seq = 0;

/** An active account inserted directly (no password); returns its id. */
export async function insertUser(name, role = "customer") {
  seq += 1;
  const _id = oid();
  await User.collection.insertOne({
    _id,
    name,
    email: `person${seq}.${_id}@example.test`,
    passwordHash: "x",
    role,
    status: "active",
    tokenVersion: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  return _id;
}

/** An approved restaurant; `owner` defaults to a new restaurant account. */
export async function insertRestaurant(name, owner) {
  seq += 1;
  return Restaurant.create({
    owner: owner ?? (await insertUser(`${name} Owner`, "restaurant")),
    name,
    slug: `kitchen-${seq}`,
    cuisines: ["Thali"],
    phone: "9000000000",
    address: { line1: "12 Lantern Row", city: "Westford", state: "Avalon", postalCode: "560001" },
    location: { type: "Point", coordinates: [77.6, 12.9] },
    costForTwoPaise: 40_000,
    openingTime: "09:00",
    closingTime: "22:00",
    status: "approved",
  });
}
