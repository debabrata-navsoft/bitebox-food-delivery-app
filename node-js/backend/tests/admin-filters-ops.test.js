// Global filters, phase B: multi-value filters and facet counts (`facets=1`) on the admin
// operations lists: orders, restaurants, menu items and delivery partners. Id facets (restaurant,
// category) carry the name as `label`. Same as the Django tests.
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import mongoose from "mongoose";
import { DeliveryPartner } from "../models/delivery-partner.model.js";
import { FoodCategory } from "../models/food-category.model.js";
import { FoodItem } from "../models/food-item.model.js";
import { KycDocument, PayoutAccount } from "../models/kyc-document.model.js";
import { Order } from "../models/order.model.js";
import { Restaurant } from "../models/restaurant.model.js";
import { User } from "../models/user.model.js";
import { zoneDayStart } from "../utils/dates.js";
import { env } from "../config/env.js";
import { buildApp, createAndLogin, request, resetDb, setupTestDb, teardownTestDb } from "./helpers.js";

const auth = (token) => ({ Authorization: `Bearer ${token}` });
const oid = () => new mongoose.Types.ObjectId();
const DAY = 86_400_000;
const fields = (res) => res.body.error.details.map((e) => e.field);
const ids = (res) => res.body.data.items.map((r) => String(r.id)).sort();
const sorted = (list) => list.map(String).sort();
/** A facet as { value: count }, in the response's order. */
const counts = (res, name) => Object.fromEntries(res.body.data.facets[name].map((f) => [f.value, f.count]));

describe("admin operations list filters and facets", () => {
  let app;
  let admin;
  let seq = 0;

  before(async () => {
    await setupTestDb();
    app = buildApp();
  });
  after(teardownTestDb);

  beforeEach(async () => {
    await resetDb();
    admin = await createAndLogin(app, "admin");
    await User.deleteMany({ _id: { $ne: admin.user.id } });
  });

  const get = (path, query = {}) =>
    request(app).get(`/api/v1/admin/${path}`).query(query).set(auth(admin.token));

  async function user(role, extra = {}) {
    seq += 1;
    const _id = oid();
    const createdAt = extra.createdAt ?? new Date(Date.now() - DAY);
    await User.collection.insertOne({
      _id,
      name: `Person ${seq}`,
      email: `person${seq}.${_id}@example.test`,
      passwordHash: "x",
      role,
      status: "active",
      tokenVersion: 0,
      updatedAt: createdAt,
      ...extra,
      createdAt,
    });
    return _id;
  }

  async function restaurant(extra = {}) {
    seq += 1;
    const r = await Restaurant.create({
      owner: await user("restaurant"),
      name: `Kitchen ${seq}`,
      slug: `kitchen-${seq}`,
      cuisines: ["Thali"],
      phone: "9000000000",
      address: { line1: "12 Lantern Row", city: "Westford", state: "Avalon", postalCode: "560001" },
      location: { type: "Point", coordinates: [77.6, 12.9] },
      costForTwoPaise: 40_000,
      openingTime: "09:00",
      closingTime: "22:00",
      status: "approved",
      ...extra,
    });
    if (extra.createdAt) await Restaurant.collection.updateOne({ _id: r._id }, { $set: { createdAt: extra.createdAt } });
    return r;
  }

  /** The common checks: no facets without facets=1, and `limit=1&facets=1` keeps the total. */
  async function plainAndPreview(path, query, total) {
    const plain = await get(path, query);
    assert.equal(plain.status, 200);
    assert.equal("facets" in plain.body.data, false);
    assert.equal("facets" in (await get(path, { ...query, facets: "0" })).body.data, false);
    const preview = await get(path, { ...query, limit: 1, facets: 1 });
    assert.equal(preview.status, 200);
    assert.equal(preview.body.data.items.length, Math.min(1, total));
    assert.equal(preview.body.data.pagination.total, total);
    assert.ok(preview.body.data.facets);
  }

  describe("GET /admin/orders", () => {
    let o;
    let r;
    async function order(restaurantDoc, extra = {}) {
      seq += 1;
      const _id = oid();
      await Order.collection.insertOne({
        _id,
        orderNumber: `BB${String(seq).padStart(6, "0")}`,
        customer: oid(),
        restaurant: restaurantDoc._id,
        restaurantSnapshot: { name: restaurantDoc.name },
        items: [{ foodItem: oid(), name: "Plain Dosa", isVeg: true, unitPricePaise: 10_000, quantity: 1, lineTotalPaise: 10_000 }],
        pricing: { totalPaise: 10_000 },
        status: "delivered",
        paymentMethod: "cod",
        paymentStatus: "paid",
        createdAt: new Date(),
        updatedAt: new Date(),
        ...extra,
      });
      return String(_id);
    }

    beforeEach(async () => {
      r = {
        amber: await restaurant({ name: "Amber Spoon" }),
        birch: await restaurant({ name: "Birch Table" }),
        cedar: await restaurant({ name: "Cedar Pot" }),
      };
      const tz = env.reportTimezone;
      o = {
        a1: await order(r.amber, { status: "pending", paymentMethod: "online", paymentStatus: "pending" }),
        a2: await order(r.amber, { status: "preparing", createdAt: zoneDayStart("2026-03-10", tz) }),
        b1: await order(r.birch, { status: "cancelled", paymentStatus: "refunded", paymentMethod: "online" }),
        b2: await order(r.birch, { status: "delivered", createdAt: new Date(zoneDayStart("2026-03-12", tz).getTime() + 23 * 3_600_000) }),
        c1: await order(r.cedar, { status: "on_the_way", paymentStatus: "pending" }),
      };
    });

    it("takes several values per filter: OR within one, AND across", async () => {
      assert.deepEqual(ids(await get("orders", { status: "pending,cancelled" })), sorted([o.a1, o.b1]));
      // `active` stands for every in-progress status, alone or with others.
      assert.deepEqual(ids(await get("orders", { status: "active" })), sorted([o.a1, o.a2, o.c1]));
      assert.deepEqual(ids(await get("orders", { status: "active,cancelled" })), sorted([o.a1, o.a2, o.b1, o.c1]));
      assert.deepEqual(ids(await get("orders", { paymentMethod: "online" })), sorted([o.a1, o.b1]));
      assert.deepEqual(ids(await get("orders", { paymentStatus: "refunded,pending", paymentMethod: "cod" })), [o.c1]);
      assert.deepEqual(ids(await get("orders", { restaurant: `${r.amber._id},${r.cedar._id}` })), sorted([o.a1, o.a2, o.c1]));
      assert.deepEqual(ids(await get("orders", { restaurant: String(r.birch._id) })), sorted([o.b1, o.b2]));
      // Inclusive days in the report time zone.
      assert.deepEqual(ids(await get("orders", { placedFrom: "2026-03-10", placedTo: "2026-03-12" })), sorted([o.a2, o.b2]));
      assert.deepEqual(ids(await get("orders", { placedTo: "2026-03-11" })), [o.a2]);
    });

    it("rejects any invalid value on that field", async () => {
      for (const [name, value] of [
        ["status", "pending,lost"], ["paymentMethod", "cod,card"], ["paymentStatus", "paid,maybe"],
        ["restaurant", `${r.amber._id},nope`], ["placedFrom", "2026-02-30"], ["facets", "yes"],
      ]) {
        const res = await get("orders", { [name]: value });
        assert.equal(res.status, 422, name);
        assert.deepEqual(fields(res), [name]);
      }
      const backwards = await get("orders", { placedFrom: "2026-03-12", placedTo: "2026-03-10" });
      assert.deepEqual(fields(backwards), ["placedTo"]);
    });

    it("counts each facet with every filter but its own; restaurants carry their name", async () => {
      const res = await get("orders", { paymentMethod: "cod", status: "pending,preparing,delivered,on_the_way", facets: 1 });
      const { facets } = res.body.data;
      assert.deepEqual(Object.keys(facets), ["status", "paymentMethod", "paymentStatus", "restaurant"]);
      // Every order status (not `active`), in order, with zeros; the cod filter applies.
      assert.deepEqual(facets.status.map((f) => f.value), [
        "pending", "confirmed", "rejected", "preparing", "ready_for_pickup", "assigned",
        "arrived_at_restaurant", "picked_up", "on_the_way", "delivered", "cancelled",
      ]);
      assert.deepEqual(
        facets.status.filter((f) => f.count),
        [{ value: "preparing", count: 1 }, { value: "on_the_way", count: 1 }, { value: "delivered", count: 1 }],
      );
      // Its own selection is left out, the status filter applies (a1 pending online is counted).
      assert.deepEqual(facets.paymentMethod, [{ value: "cod", count: 3 }, { value: "online", count: 1 }]);
      assert.deepEqual(facets.paymentStatus, [
        { value: "pending", count: 1 },
        { value: "paid", count: 2 },
        { value: "failed", count: 0 },
        { value: "refunded", count: 0 },
        { value: "partially_refunded", count: 0 },
        { value: "cancelled", count: 0 },
      ]);
      // Open values by count, then name, with the restaurant's name as label.
      assert.deepEqual(facets.restaurant, [
        { value: String(r.amber._id), label: "Amber Spoon", count: 1 },
        { value: String(r.birch._id), label: "Birch Table", count: 1 },
        { value: String(r.cedar._id), label: "Cedar Pot", count: 1 },
      ]);

      const mine = await get("orders", { restaurant: String(r.amber._id), facets: 1 });
      assert.deepEqual(mine.body.data.facets.restaurant, [
        { value: String(r.amber._id), label: "Amber Spoon", count: 2 },
        { value: String(r.birch._id), label: "Birch Table", count: 2 },
        { value: String(r.cedar._id), label: "Cedar Pot", count: 1 },
      ]);
      assert.deepEqual(counts(mine, "paymentMethod"), { cod: 1, online: 1 });
      // The existing status counts follow the restaurant filter only.
      assert.deepEqual(mine.body.data.counts, { pending: 1, preparing: 1 });

      // Dates and search apply to every facet.
      const dated = await get("orders", { placedFrom: "2026-03-01", placedTo: "2026-03-31", facets: 1 });
      assert.deepEqual(counts(dated, "paymentMethod"), { cod: 2, online: 0 });
    });

    it("keeps the single-value filters", async () => {
      const res = await get("orders", { status: "delivered", restaurant: String(r.birch._id) });
      assert.deepEqual(ids(res), [o.b2]);
      assert.deepEqual(res.body.data.counts, { cancelled: 1, delivered: 1 });
    });

    it("leaves facets out unless asked; limit=1 keeps the total", () =>
      plainAndPreview("orders", { status: "active" }, 3));
  });

  describe("GET /admin/restaurants", () => {
    let r;
    const at = (city) => ({ address: { line1: "1 Row", city, state: "Avalon", postalCode: "560001" } });
    beforeEach(async () => {
      r = {
        west: await restaurant({ ...at("Westford"), cuisines: ["South Indian", "Chinese"], isPureVeg: true }),
        westLower: await restaurant({ ...at("westford "), cuisines: ["south indian"], status: "pending", isAcceptingOrders: false }),
        east: await restaurant({
          ...at("Eastvale"), cuisines: ["Thali", "Chinese"], status: "suspended", createdAt: new Date("2026-01-05T12:00:00Z"),
        }),
      };
    });
    const rid = (key) => String(r[key]._id);

    it("takes several values per filter", async () => {
      assert.deepEqual(ids(await get("restaurants", { status: "pending,suspended" })), sorted([rid("westLower"), rid("east")]));
      assert.deepEqual(ids(await get("restaurants", { city: "WESTFORD" })), sorted([rid("west"), rid("westLower")]));
      assert.deepEqual(ids(await get("restaurants", { cuisine: "thali, CHINESE" })), sorted([rid("west"), rid("east")]));
      assert.deepEqual(ids(await get("restaurants", { cuisine: "South Indian" })), sorted([rid("west"), rid("westLower")]));
      assert.deepEqual(ids(await get("restaurants", { veg: "mixed" })), sorted([rid("westLower"), rid("east")]));
      assert.deepEqual(ids(await get("restaurants", { veg: "pure_veg,mixed", accepting: "closed" })), [rid("westLower")]);
      assert.deepEqual(ids(await get("restaurants", { accepting: "open", city: "Westford,Eastvale" })), sorted([rid("west"), rid("east")]));
      assert.deepEqual(ids(await get("restaurants", { joinedFrom: "2026-01-05", joinedTo: "2026-01-05" })), [rid("east")]);
      // One status as before.
      assert.deepEqual(ids(await get("restaurants", { status: "approved" })), [rid("west")]);
    });

    it("rejects any invalid value on that field", async () => {
      for (const [name, value] of [
        ["status", "approved,open"], ["city", "x".repeat(61)], ["cuisine", `Thali,${"y".repeat(61)}`],
        ["veg", "veg"], ["accepting", "open,busy"], ["joinedFrom", "yesterday"],
      ]) {
        const res = await get("restaurants", { [name]: value });
        assert.equal(res.status, 422, name);
        assert.deepEqual(fields(res), [name]);
      }
    });

    it("counts each facet with every filter but its own; each cuisine once per restaurant", async () => {
      const res = await get("restaurants", { cuisine: "Thali", facets: 1 });
      const { facets } = res.body.data;
      assert.deepEqual(Object.keys(facets), ["status", "city", "cuisine", "veg", "accepting"]);
      assert.deepEqual(facets.cuisine, [
        { value: "Chinese", count: 2 },
        { value: "South Indian", count: 2 },
        { value: "Thali", count: 1 },
      ]);
      assert.deepEqual(facets.status, [
        { value: "pending", count: 0 },
        { value: "approved", count: 0 },
        { value: "rejected", count: 0 },
        { value: "suspended", count: 1 },
        { value: "resubmission_requested", count: 0 },
      ]);
      assert.deepEqual(facets.city, [{ value: "Eastvale", count: 1 }]);
      assert.deepEqual(facets.veg, [{ value: "pure_veg", count: 0 }, { value: "mixed", count: 1 }]);
      assert.deepEqual(facets.accepting, [{ value: "open", count: 1 }, { value: "closed", count: 0 }]);

      const westford = await get("restaurants", { city: "westford", veg: "mixed", facets: 1 });
      assert.deepEqual(westford.body.data.facets.city, [
        { value: "Eastvale", count: 1 },
        { value: "westford", count: 1 },
      ]);
      assert.deepEqual(counts(westford, "veg"), { pure_veg: 1, mixed: 1 });
      assert.deepEqual(westford.body.data.facets.cuisine, [{ value: "south indian", count: 1 }]);
      assert.deepEqual(counts(westford, "accepting"), { open: 0, closed: 1 });
    });

    it("leaves facets out unless asked; limit=1 keeps the total; counts unchanged", async () => {
      await plainAndPreview("restaurants", { city: "westford" }, 2);
      const res = await get("restaurants/counts");
      assert.deepEqual(res.body.data.counts, { pending: 1, approved: 1, rejected: 0, suspended: 1, resubmission_requested: 0 });
    });
  });

  describe("GET /admin/foods", () => {
    let f;
    let r;
    let c;
    async function food(restaurantDoc, category, extra = {}) {
      seq += 1;
      const item = await FoodItem.create({
        restaurant: restaurantDoc._id,
        category: category._id,
        name: `Dish ${seq}`,
        pricePaise: 15_000,
        isVeg: true,
        ...extra,
      });
      return String(item._id);
    }
    beforeEach(async () => {
      r = { amber: await restaurant({ name: "Amber Spoon" }), birch: await restaurant({ name: "Birch Table" }) };
      c = {
        mains: await FoodCategory.create({ name: "Mains", slug: "mains" }),
        sweets: await FoodCategory.create({ name: "Sweets", slug: "sweets" }),
      };
      f = {
        a1: await food(r.amber, c.mains),
        a2: await food(r.amber, c.sweets, { isVeg: false }),
        a3: await food(r.amber, c.mains, { isAvailable: false, isVeg: false }),
        b1: await food(r.birch, c.sweets),
      };
      await food(r.birch, c.mains, { deletedAt: new Date() });
    });

    it("takes several values per filter", async () => {
      assert.deepEqual(ids(await get("foods", { restaurant: `${r.amber._id},${r.birch._id}` })), sorted(Object.values(f)));
      assert.deepEqual(ids(await get("foods", { restaurant: String(r.birch._id) })), [f.b1]);
      assert.deepEqual(ids(await get("foods", { category: String(c.sweets._id) })), sorted([f.a2, f.b1]));
      assert.deepEqual(ids(await get("foods", { type: "non_veg" })), sorted([f.a2, f.a3]));
      assert.deepEqual(ids(await get("foods", { type: "veg,non_veg", availability: "unavailable" })), [f.a3]);
      assert.deepEqual(ids(await get("foods", { availability: "available", category: `${c.mains._id},${c.sweets._id}`, type: "veg" })), sorted([f.a1, f.b1]));
      // The old flags are unchanged and combine with AND.
      assert.deepEqual(ids(await get("foods", { veg: "true" })), sorted([f.a1, f.b1]));
      assert.deepEqual(ids(await get("foods", { available: "false" })), [f.a3]);
      assert.deepEqual(ids(await get("foods", { available: "true", availability: "unavailable" })), []);
    });

    it("rejects any invalid value on that field", async () => {
      for (const [name, value] of [
        ["restaurant", "nope"], ["category", `${c.mains._id},123`], ["type", "vegan"], ["availability", "available,soon"],
      ]) {
        const res = await get("foods", { [name]: value });
        assert.equal(res.status, 422, name);
        assert.deepEqual(fields(res), [name]);
      }
    });

    it("counts each facet with every filter but its own; ids carry their name", async () => {
      const res = await get("foods", { category: String(c.mains._id), facets: 1 });
      const { facets } = res.body.data;
      assert.deepEqual(Object.keys(facets), ["restaurant", "category", "type", "availability"]);
      assert.deepEqual(facets.restaurant, [{ value: String(r.amber._id), label: "Amber Spoon", count: 2 }]);
      assert.deepEqual(facets.category, [
        { value: String(c.mains._id), label: "Mains", count: 2 },
        { value: String(c.sweets._id), label: "Sweets", count: 2 },
      ]);
      assert.deepEqual(facets.type, [{ value: "veg", count: 1 }, { value: "non_veg", count: 1 }]);
      assert.deepEqual(facets.availability, [{ value: "available", count: 1 }, { value: "unavailable", count: 1 }]);

      const amber = await get("foods", { restaurant: String(r.amber._id), type: "veg", facets: 1 });
      assert.deepEqual(amber.body.data.facets.restaurant, [
        { value: String(r.amber._id), label: "Amber Spoon", count: 1 },
        { value: String(r.birch._id), label: "Birch Table", count: 1 },
      ]);
      assert.deepEqual(counts(amber, "type"), { veg: 1, non_veg: 2 });
      assert.deepEqual(amber.body.data.facets.category, [{ value: String(c.mains._id), label: "Mains", count: 1 }]);
    });

    it("leaves facets out unless asked; limit=1 keeps the total", () =>
      plainAndPreview("foods", { type: "non_veg" }, 2));
  });

  describe("GET /admin/delivery-partners", () => {
    let d;
    async function rider(extra = {}, profile = {}) {
      const id = await user("delivery", extra);
      if (profile !== false)
        await DeliveryPartner.create({ user: id, vehicleType: "scooter", verificationStatus: "approved", ...profile });
      return String(id);
    }
    beforeEach(async () => {
      d = {
        free: await rider({}, { isOnline: true, zone: "North Loop" }),
        waiting: await rider({}, { verificationStatus: "pending", vehicleType: "bicycle", zone: "north loop" }),
        busy: await rider({}, { verificationStatus: "rejected", vehicleType: "car", isOnline: true, activeOrder: oid(), zone: "South Bank" }),
        bare: await rider({}, false),
      };
      // The waiting rider sent everything: in review (pending), not "not submitted".
      await DeliveryPartner.updateOne(
        { user: d.waiting },
        { address: { line1: "4 Fern Lane", city: "Westford", state: "Avalon", postalCode: "560002" } },
      );
      for (const kind of ["driving_licence", "vehicle_rc", "id_proof"])
        await KycDocument.create({ user: d.waiting, kind, fileName: `${oid()}.pdf`, contentType: "application/pdf", size: 10 });
      await PayoutAccount.create({ user: d.waiting, holderName: "Fictional Rider", accountNumberEncrypted: "x", accountLast4: "1234", ifsc: "FAKE0001234" });
    });

    it("takes several values per filter", async () => {
      const list = (q) => get("delivery-partners", q);
      assert.deepEqual(ids(await list({ verification: "pending" })), [d.waiting]);
      assert.deepEqual(ids(await list({ verification: "not_submitted,rejected" })), sorted([d.bare, d.busy]));
      assert.deepEqual(ids(await list({ verification: "approved,pending" })), sorted([d.free, d.waiting]));
      assert.deepEqual(ids(await list({ availability: "online,busy" })), sorted([d.free, d.busy]));
      assert.deepEqual(ids(await list({ availability: "offline", vehicleType: "bicycle,car" })), [d.waiting]);
      assert.deepEqual(ids(await list({ zone: "NORTH LOOP, south bank" })), sorted([d.free, d.waiting, d.busy]));
      // The old `online` flag is unchanged.
      assert.deepEqual(ids(await list({ online: "true" })), sorted([d.free, d.busy]));
      assert.deepEqual(ids(await list({ online: "true", availability: "busy" })), [d.busy]);
    });

    it("rejects any invalid value on that field", async () => {
      for (const [name, value] of [
        ["verification", "approved,ok"], ["availability", "online,away"], ["vehicleType", "car,boat"], ["zone", "y".repeat(61)],
      ]) {
        const res = await get("delivery-partners", { [name]: value });
        assert.equal(res.status, 422, name);
        assert.deepEqual(fields(res), [name]);
      }
    });

    it("counts each facet with every filter but its own", async () => {
      const res = await get("delivery-partners", { availability: "offline", facets: 1 });
      const { facets } = res.body.data;
      assert.deepEqual(Object.keys(facets), ["verification", "availability", "vehicleType", "zone"]);
      assert.deepEqual(facets.verification, [
        { value: "pending", count: 1 },
        { value: "approved", count: 0 },
        { value: "rejected", count: 0 },
        { value: "resubmission_requested", count: 0 },
        { value: "not_submitted", count: 1 },
      ]);
      assert.deepEqual(facets.availability, [
        { value: "online", count: 1 },
        { value: "offline", count: 2 },
        { value: "busy", count: 1 },
      ]);
      assert.deepEqual(facets.vehicleType, [
        { value: "bicycle", count: 1 },
        { value: "scooter", count: 0 },
        { value: "motorbike", count: 0 },
        { value: "car", count: 0 },
      ]);
      assert.deepEqual(facets.zone, [{ value: "north loop", count: 1 }]);

      const picked = await get("delivery-partners", { verification: "not_submitted", zone: "north loop", facets: 1 });
      assert.deepEqual(counts(picked, "verification"), {
        pending: 1, approved: 1, rejected: 0, resubmission_requested: 0, not_submitted: 0,
      });
      assert.deepEqual(picked.body.data.facets.zone, [], "the not-submitted rider has no zone");
    });

    it("keeps the list's fields", async () => {
      const res = await get("delivery-partners", { verification: "pending" });
      const [item] = res.body.data.items;
      assert.equal(item.id, d.waiting);
      assert.equal(item.submitted, true);
      assert.equal(item.verificationStatus, "pending");
      assert.equal(item.vehicleType, "bicycle");
      assert.equal(item.isOnline, false);
      assert.equal("passwordHash" in item, false);
      assert.equal(item.email.endsWith("@example.test"), true);
    });

    it("leaves facets out unless asked; limit=1 keeps the total", () =>
      plainAndPreview("delivery-partners", { availability: "offline,busy" }, 3));
  });
});
