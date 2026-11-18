// Global filters on the partner and rider lists: the restaurant's order history, the rider's
// delivery history, the restaurant's menu and its own offers. Multi-value filters, facet counts
// (`facets=1`), and that nothing (rows or counts) ever comes from another restaurant or rider.
// Same as the Django tests (apps/orders/tests/test_partner_list_filters.py and
// apps/coupons/tests/test_coupon_list_filters.py). Fictional data only.
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { Coupon } from "../models/coupon.model.js";
import { FoodCategory } from "../models/food-category.model.js";
import { FoodItem } from "../models/food-item.model.js";
import { Order } from "../models/order.model.js";
import { signAccessToken } from "../utils/tokens.js";
import { buildApp, request, resetDb, setupTestDb, teardownTestDb } from "./helpers.js";
import { at as on, auth, counts, fieldErrors, insertRestaurant, insertUser, listed, oid } from "./list-filter-fixtures.js";

const DAY = 86_400_000;
const numbers = (res) => listed(res, "orderNumber");

describe("partner and rider order, menu and offer list filters", () => {
  let app;

  before(async () => {
    await setupTestDb();
    app = buildApp();
  });
  after(teardownTestDb);
  beforeEach(resetDb);

  /** A signed-in account: `get(path, query)` calls the API as it. */
  async function account(role) {
    const _id = await insertUser("Fictional Person", role);
    const token = signAccessToken({ _id, role, tokenVersion: 0 });
    const get = (path, query = {}) => request(app).get(`/api/v1${path}`).query(query).set(auth(token));
    return { id: _id, get };
  }

  /** A restaurant (of `owner`, or of an owner without an account). */
  const restaurant = (name, owner = oid()) => insertRestaurant(name, owner);

  async function order(orderNumber, day, kitchen, extra = {}) {
    await Order.collection.insertOne({
      _id: oid(),
      orderNumber,
      customer: oid(),
      restaurant: kitchen._id,
      restaurantSnapshot: { name: kitchen.name },
      deliveryAddress: { recipientName: "Asha", phone: "9000000002", line1: "4B", city: "Westford" },
      items: [{ foodItem: oid(), name: "Plain Dosa", isVeg: true, unitPricePaise: 10_000, quantity: 1, lineTotalPaise: 10_000 }],
      pricing: { totalPaise: 10_000 },
      status: "delivered",
      statusHistory: [],
      paymentMethod: "cod",
      paymentStatus: "paid",
      submittedAt: on(day),
      createdAt: on(day),
      updatedAt: on(day),
      ...extra,
    });
  }

  const address = (recipientName) => ({ deliveryAddress: { recipientName, phone: "9000000002", line1: "4B", city: "Westford" } });

  describe("GET /my/restaurant/orders?view=history", () => {
    let north;
    let south;

    beforeEach(async () => {
      north = await account("restaurant");
      south = await account("restaurant");
      const n = await restaurant("Fictional North", north.id);
      const s = await restaurant("Fictional South", south.id);
      await order("BB-N-0001", "2026-03-01", n, address("Asha"));
      await order("BB-N-0002", "2026-03-02", n, { ...address("Ravi Kiran"), paymentMethod: "online" });
      await order("BB-N-0003", "2026-03-03", n, { ...address("Meera"), status: "rejected" });
      await order("BB-N-0004", "2026-03-04", n, { ...address("Ravi Kumar"), status: "cancelled", paymentMethod: "online" });
      await order("BB-N-0005", "2026-03-04", n, { status: "pending" });
      await order("BB-S-0001", "2026-03-02", s);
      await order("BB-S-0002", "2026-03-03", s, { status: "cancelled", paymentMethod: "online" });
    });

    const history = (who, query = {}) => who.get("/my/restaurant/orders", { view: "history", ...query });

    it("takes several values per filter: OR within one, AND across", async () => {
      const found = async (query) => numbers(await history(north, query));
      assert.deepEqual(await found(), ["BB-N-0001", "BB-N-0002", "BB-N-0003", "BB-N-0004"]);
      assert.deepEqual(await found({ status: "delivered" }), ["BB-N-0001", "BB-N-0002"]);
      assert.deepEqual(await found({ status: "rejected,cancelled" }), ["BB-N-0003", "BB-N-0004"]);
      // A status outside the view is ignored, as before.
      assert.equal((await found({ status: "pending" })).length, 4);
      assert.deepEqual(await found({ paymentMethod: "online" }), ["BB-N-0002", "BB-N-0004"]);
      assert.deepEqual(await found({ status: "delivered", paymentMethod: "online" }), ["BB-N-0002"]);
      assert.deepEqual(await found({ placedFrom: "2026-03-02", placedTo: "2026-03-03" }), ["BB-N-0002", "BB-N-0003"]);
      assert.deepEqual(await found({ search: "n-0003" }), ["BB-N-0003"]);
      assert.deepEqual(await found({ search: "ravi" }), ["BB-N-0002", "BB-N-0004"]);
      // The active view is unchanged (and takes several statuses).
      const active = await north.get("/my/restaurant/orders", { view: "active", status: "pending,confirmed" });
      assert.deepEqual(numbers(active), ["BB-N-0005"]);
      assert.deepEqual(active.body.data.counts, { pending: 1 });

      assert.deepEqual(
        fieldErrors(await history(north, { status: "delivered,lost", paymentMethod: "card", placedFrom: "2026-13-01", facets: "maybe" })),
        { status: "Invalid value", paymentMethod: "Invalid value", placedFrom: "Invalid value", facets: "facets must be true or false" },
      );
    });

    it("counts each facet over the other filters, only the restaurant's own orders", async () => {
      assert.equal("facets" in (await history(north)).body.data, false);
      const res = await history(north, { status: "delivered", paymentMethod: "online", facets: 1 });
      assert.equal(res.body.data.pagination.total, 1);
      assert.deepEqual(Object.keys(res.body.data.facets), ["status", "paymentMethod"]);
      assert.deepEqual(counts(res, "status"), { delivered: 1, rejected: 0, cancelled: 1 });
      assert.deepEqual(counts(res, "paymentMethod"), { cod: 1, online: 1 });
      assert.deepEqual(counts(await history(north, { facets: 1, search: "bb-" }), "status"), { delivered: 2, rejected: 1, cancelled: 1 });

      const theirs = await history(south, { facets: 1 });
      assert.deepEqual(numbers(theirs), ["BB-S-0001", "BB-S-0002"]);
      assert.deepEqual(counts(theirs, "status"), { delivered: 1, rejected: 0, cancelled: 1 });
      // The restaurant still never sees the customer's phone or exact address.
      for (const item of theirs.body.data.items)
        assert.ok(Object.keys(item.deliveryAddress).every((k) => ["recipientName", "area", "city"].includes(k)));
    });
  });

  it("GET /delivery/orders/history filters and counts only the rider's own orders", async () => {
    const rider = await account("delivery");
    const other = await account("delivery");
    const n = await restaurant("Fictional North");
    const s = await restaurant("Fictional South");
    await order("BB-R-0001", "2026-04-01", n, { deliveryPartner: rider.id });
    await order("BB-R-0002", "2026-04-02", s, { deliveryPartner: rider.id });
    await order("BB-R-0003", "2026-04-03", n, { deliveryPartner: rider.id, status: "cancelled" });
    await order("BB-R-0004", "2026-04-03", n, { deliveryPartner: rider.id, status: "on_the_way" });
    await order("BB-X-0001", "2026-04-02", n, { deliveryPartner: other.id });
    await order("BB-X-0002", "2026-04-02", n);
    const found = async (query) => numbers(await rider.get("/delivery/orders/history", query));

    assert.deepEqual(await found(), ["BB-R-0001", "BB-R-0002", "BB-R-0003"]);
    assert.deepEqual(await found({ status: "cancelled" }), ["BB-R-0003"]);
    assert.deepEqual(await found({ status: "delivered,cancelled" }), ["BB-R-0001", "BB-R-0002", "BB-R-0003"]);
    assert.deepEqual(await found({ restaurant: String(n._id) }), ["BB-R-0001", "BB-R-0003"]);
    assert.deepEqual(await found({ restaurant: `${n._id},${s._id}`, status: "delivered" }), ["BB-R-0001", "BB-R-0002"]);
    assert.deepEqual(await found({ placedFrom: "2026-04-02", placedTo: "2026-04-02" }), ["BB-R-0002"]);
    assert.deepEqual(await found({ search: "r-0002" }), ["BB-R-0002"]);
    assert.equal("facets" in (await rider.get("/delivery/orders/history")).body.data, false);

    const res = await rider.get("/delivery/orders/history", { status: "delivered", restaurant: String(n._id), facets: 1 });
    assert.equal(res.body.data.pagination.total, 1);
    assert.deepEqual(counts(res, "status"), { delivered: 1, cancelled: 1 });
    assert.deepEqual(res.body.data.facets.restaurant, [
      { value: String(n._id), label: "Fictional North", count: 1 },
      { value: String(s._id), label: "Fictional South", count: 1 },
    ]);
    const theirs = await other.get("/delivery/orders/history", { facets: 1 });
    assert.deepEqual(numbers(theirs), ["BB-X-0001"]);
    assert.deepEqual(counts(theirs, "restaurant"), { [String(n._id)]: 1 });

    assert.deepEqual(
      Object.keys(fieldErrors(await rider.get("/delivery/orders/history", { status: "on_the_way", restaurant: "nope", placedTo: "x" }))).sort(),
      ["placedTo", "restaurant", "status"],
    );
  });

  it("GET /my/restaurant/foods filters and counts only the restaurant's own dishes", async () => {
    const owner = await account("restaurant");
    const n = await restaurant("Fictional North", owner.id);
    const s = await restaurant("Fictional South");
    const mains = await FoodCategory.create({ name: "Fictional Mains", slug: "fictional-mains" });
    const sweets = await FoodCategory.create({ name: "Fictional Sweets", slug: "fictional-sweets" });
    const food = (kitchen, category, name, extra = {}) =>
      FoodItem.create({ restaurant: kitchen._id, category: category._id, name, pricePaise: 25_000, isVeg: true, ...extra });
    await food(n, mains, "Paneer Plate");
    await food(n, mains, "Chicken Plate", { isVeg: false });
    await food(n, sweets, "Kheer Cup", { isAvailable: false });
    await food(n, sweets, "Old Laddoo", { deletedAt: new Date() });
    await food(s, sweets, "South Halwa");
    await food(s, mains, "South Curry", { isVeg: false });
    const names = async (query = {}) => {
      const res = await owner.get("/my/restaurant/foods", query);
      assert.equal(res.status, 200, JSON.stringify(res.body));
      return res.body.data.items.map((i) => i.name).sort();
    };

    assert.deepEqual(await names(), ["Chicken Plate", "Kheer Cup", "Paneer Plate"]);
    assert.deepEqual(await names({ category: String(sweets._id) }), ["Kheer Cup"]);
    assert.equal((await names({ category: `${mains._id},${sweets._id}` })).length, 3);
    assert.deepEqual(await names({ type: "non_veg" }), ["Chicken Plate"]);
    assert.deepEqual(await names({ availability: "unavailable" }), ["Kheer Cup"]);
    assert.deepEqual(await names({ available: "false" }), ["Kheer Cup"]);
    assert.deepEqual(await names({ type: "veg", category: String(mains._id) }), ["Paneer Plate"]);
    assert.deepEqual(await names({ search: "plate", type: "veg,non_veg" }), ["Chicken Plate", "Paneer Plate"]);
    assert.equal("facets" in (await owner.get("/my/restaurant/foods")).body.data, false);

    const res = await owner.get("/my/restaurant/foods", { type: "veg", facets: 1 });
    assert.equal(res.body.data.pagination.total, 2);
    assert.deepEqual(Object.keys(res.body.data.facets), ["category", "type", "availability"]);
    assert.deepEqual(res.body.data.facets.category, [
      { value: String(mains._id), label: "Fictional Mains", count: 1 },
      { value: String(sweets._id), label: "Fictional Sweets", count: 1 },
    ]);
    assert.deepEqual(counts(res, "type"), { veg: 2, non_veg: 1 });
    assert.deepEqual(counts(res, "availability"), { available: 1, unavailable: 1 });

    assert.deepEqual(
      fieldErrors(await owner.get("/my/restaurant/foods", { category: "nope", type: "vegan", availability: "x" })),
      { category: "Invalid value", type: "Invalid value", availability: "Invalid value" },
    );
  });

  it("GET /my/restaurant/offers counts status and discount type over its own offers", async () => {
    const owner = await account("restaurant");
    const other = await account("restaurant");
    const n = await restaurant("Fictional North", owner.id);
    const s = await restaurant("Fictional South", other.id);
    const now = Date.now();
    const live = { validFrom: new Date(now - DAY), validUntil: new Date(now + DAY) };
    const offer = { kind: "restaurant_offer", source: "restaurant", ...live };
    await Coupon.create([
      { code: "ALPHA10", discountType: "percent", discountValue: 10, ...live },
      { code: "CHARLIE20", ...offer, restaurant: n._id, approvalStatus: "pending", discountType: "percent", discountValue: 20 },
      { code: "GOLF15", ...offer, restaurant: n._id, discountType: "flat", discountValue: 1500 },
      { code: "HOTEL25", ...offer, restaurant: s._id, discountType: "percent", discountValue: 25 },
    ]);
    const codes = (res) => {
      assert.equal(res.status, 200, JSON.stringify(res.body));
      return res.body.data.items.map((c) => c.code).sort();
    };
    const OWN = "/my/restaurant/offers";

    assert.equal("facets" in (await owner.get(OWN)).body.data, false);
    assert.deepEqual(codes(await owner.get(OWN, { discountType: "flat,percent" })), ["CHARLIE20", "GOLF15"]);
    const res = await owner.get(OWN, { status: "active", facets: 1 });
    assert.equal(res.body.data.pagination.total, 1);
    assert.deepEqual(Object.keys(res.body.data.facets), ["status", "discountType"]);
    const status = counts(res, "status");
    assert.equal(status.active, 1);
    assert.equal(status.pending, 1);
    assert.equal(Object.values(status).reduce((a, b) => a + b, 0), 2);
    assert.deepEqual(counts(res, "discountType"), { percent: 0, flat: 1, free_delivery: 0 });
    const theirs = await other.get(OWN, { facets: 1, search: "o" });
    assert.deepEqual(counts(theirs, "discountType"), { percent: 1, flat: 0, free_delivery: 0 });
    assert.deepEqual(Object.keys(fieldErrors(await owner.get(OWN, { facets: "maybe", discountType: "bogo" }))).sort(), ["discountType", "facets"]);
  });
});
