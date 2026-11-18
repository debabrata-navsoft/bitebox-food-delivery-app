// Global filters on the admin coupon list (Marketing & Catalog): multi-value filters and facet
// counts (`facets=1`), and the partner's own offers list that shares the code. Same as the Django
// tests (apps/coupons/tests/test_coupon_list_filters.py). Fictional data only.
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { Coupon } from "../models/coupon.model.js";
import { Restaurant } from "../models/restaurant.model.js";
import { buildApp, createAndLogin, request, resetDb, seedCatalogFor, setupTestDb, teardownTestDb } from "./helpers.js";
import { auth, fieldErrors, listed, oid } from "./list-filter-fixtures.js";

const DAY = 86_400_000;
const codes = (res) => listed(res, "code");

describe("admin coupon list filters and facets", () => {
  let app;
  let admin;
  let partner;
  let north;
  let south;
  let now;

  before(async () => {
    await setupTestDb();
    app = buildApp();
  });
  after(teardownTestDb);

  beforeEach(async () => {
    await resetDb();
    partner = await seedCatalogFor(app);
    admin = await createAndLogin(app, "admin");
    await Coupon.deleteMany({});
    north = await Restaurant.findOneAndUpdate(
      { slug: "spice-route-kitchen" },
      { name: "Fictional North" },
      { returnDocument: "after" },
    );
    const { _id, __v, createdAt: _created, updatedAt: _updated, ...copy } = north.toObject();
    // Another owner (a restaurant has one); no account is needed for these lists.
    south = await Restaurant.create({
      ...copy,
      owner: oid(),
      name: "Fictional South",
      slug: "fictional-south",
    });
    now = Date.now();
    const live = { validFrom: new Date(now - DAY), validUntil: new Date(now + 30 * DAY) };
    // Five coupons, one per status, across kinds, owners, audiences and discount types.
    await Coupon.create([
      { code: "ALPHA10", discountType: "percent", discountValue: 10, ...live },
      {
        code: "BRAVO50",
        kind: "platform_offer",
        discountType: "flat",
        discountValue: 5000,
        audience: "new",
        isActive: false,
        restaurants: [north._id, south._id],
        ...live,
      },
      {
        code: "CHARLIE20",
        kind: "restaurant_offer",
        source: "restaurant",
        restaurant: north._id,
        approvalStatus: "pending",
        discountType: "percent",
        discountValue: 20,
        ...live,
      },
      {
        code: "DELTAFREE",
        kind: "payment_offer",
        discountType: "free_delivery",
        discountValue: 0,
        audience: "existing",
        validFrom: new Date(now + 5 * DAY),
        validUntil: new Date(now + 40 * DAY),
      },
      {
        code: "ECHO75",
        discountType: "flat",
        discountValue: 7500,
        restaurant: south._id,
        validFrom: new Date(now - 30 * DAY),
        validUntil: new Date(now - DAY),
      },
    ]);
  });

  const get = (query, who = admin, path = "/api/v1/admin/coupons") =>
    request(app).get(path).query(query).set(auth(who.token));
  const found = async (query) => codes(await get(query));

  it("takes several values per filter: OR within one, AND across", async () => {
    const n = String(north._id);
    const s = String(south._id);
    assert.deepEqual(await found({ status: "active" }), ["ALPHA10"]); // one value as before
    assert.deepEqual(await found({ status: "paused,scheduled" }), ["BRAVO50", "DELTAFREE"]);
    assert.deepEqual(await found({ status: "expired,pending" }), ["CHARLIE20", "ECHO75"]);
    assert.deepEqual(await found({ kind: "coupon,payment_offer" }), ["ALPHA10", "DELTAFREE", "ECHO75"]);
    assert.deepEqual(await found({ owner: "restaurant" }), ["CHARLIE20"]);
    assert.equal((await found({ owner: "platform,restaurant" })).length, 5);
    assert.deepEqual(await found({ audience: "new,existing" }), ["BRAVO50", "DELTAFREE"]);
    assert.deepEqual(await found({ discountType: "flat" }), ["BRAVO50", "ECHO75"]);
    assert.deepEqual(await found({ discountType: "percent,free_delivery" }), ["ALPHA10", "CHARLIE20", "DELTAFREE"]);
    // A restaurant: its own offers, coupons limited to it, and coupons listing it in their scope.
    assert.deepEqual(await found({ restaurant: n }), ["BRAVO50", "CHARLIE20"]);
    assert.deepEqual(await found({ restaurant: `${n},${s}` }), ["BRAVO50", "CHARLIE20", "ECHO75"]);
    assert.deepEqual(await found({ restaurant: n, owner: "platform" }), ["BRAVO50"]); // AND across
    assert.deepEqual(await found({ kind: "coupon", discountType: "flat", search: "echo" }), ["ECHO75"]);
    // The validity range: coupons valid at some time within it.
    assert.ok(!(await found({ from: new Date(now + DAY).toISOString() })).includes("ECHO75"));
    assert.ok(!(await found({ to: new Date(now + 2 * DAY).toISOString() })).includes("DELTAFREE"));

    assert.deepEqual(
      fieldErrors(
        await get({
          status: "active,lost",
          kind: "voucher",
          owner: "x",
          audience: "vip",
          discountType: "bogo",
          restaurant: `${n},nope`,
        }),
      ),
      {
        status: "Invalid value",
        kind: "Invalid value",
        owner: "Invalid value",
        audience: "Invalid value",
        discountType: "Invalid value",
        restaurant: "Invalid value",
      },
    );
    assert.deepEqual(Object.keys(fieldErrors(await get({ facets: "maybe" }))), ["facets"]);
  });

  it("counts each facet over the other filters (facets=1)", async () => {
    assert.equal("facets" in (await get({})).body.data, false);
    const res = await get({ restaurant: String(north._id), discountType: "percent", facets: 1, limit: 1 });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.pagination.total, 1);
    const { facets } = res.body.data;
    assert.deepEqual(Object.keys(facets), ["status", "kind", "owner", "audience", "discountType", "restaurant"]);
    const counts = (name) => Object.fromEntries(facets[name].map((f) => [f.value, f.count]));
    // Each facet leaves out its own selection: restaurants over the percent coupons...
    assert.deepEqual(facets.restaurant, [{ value: String(north._id), label: "Fictional North", count: 1 }]);
    // ...and discount types over the north restaurant's coupons (every value, in order).
    assert.deepEqual(counts("discountType"), { percent: 1, flat: 1, free_delivery: 0 });
    assert.deepEqual(Object.keys(counts("status")), ["active", "scheduled", "expired", "paused", "draft", "pending", "rejected"]);
    assert.equal(counts("status").pending, 1);
    assert.equal(Object.values(counts("status")).reduce((a, b) => a + b), 1);
    assert.deepEqual(counts("kind"), { coupon: 0, restaurant_offer: 1, platform_offer: 0, payment_offer: 0 });
    assert.deepEqual(counts("owner"), { platform: 0, restaurant: 1 });
    assert.deepEqual(counts("audience"), { all: 1, new: 0, existing: 0 });

    const every = (await get({ facets: 1 })).body.data.facets;
    // Each coupon once per restaurant it is for; by count, then name.
    assert.deepEqual(every.restaurant, [
      { value: String(north._id), label: "Fictional North", count: 2 },
      { value: String(south._id), label: "Fictional South", count: 2 },
    ]);
    assert.deepEqual(Object.fromEntries(every.status.map((f) => [f.value, f.count])), {
      active: 1,
      scheduled: 1,
      expired: 1,
      paused: 1,
      draft: 0,
      pending: 1,
      rejected: 0,
    });
  });

  it("counts older coupons without kind, source, audience or approval as their defaults", async () => {
    await Coupon.deleteMany({});
    await Coupon.collection.insertOne({
      code: "LEGACY5",
      discountType: "flat",
      discountValue: 500,
      validFrom: new Date(now - DAY),
      validUntil: new Date(now + DAY),
      isActive: true,
      usedCount: 0,
      perUserLimit: 1,
    });
    const res = await get({ facets: 1, status: "active", kind: "coupon", owner: "platform", audience: "all" });
    assert.deepEqual(codes(res), ["LEGACY5"]);
    const counts = (name) => Object.fromEntries(res.body.data.facets[name].map((f) => [f.value, f.count]));
    assert.equal(counts("status").active, 1);
    assert.equal(counts("kind").coupon, 1);
    assert.equal(counts("owner").platform, 1);
    assert.equal(counts("audience").all, 1);
  });

  it("lets a partner filter its own offers by several values", async () => {
    await Coupon.create({
      code: "FOXTROT5",
      kind: "restaurant_offer",
      source: "restaurant",
      restaurant: north._id,
      approvalStatus: "draft",
      discountType: "percent",
      discountValue: 5,
      validFrom: new Date(now - DAY),
      validUntil: new Date(now + DAY),
    });
    const own = async (query) => codes(await get(query, partner, "/api/v1/my/restaurant/offers"));
    assert.deepEqual(await own({ status: "pending,draft" }), ["CHARLIE20", "FOXTROT5"]);
    assert.deepEqual(await own({ status: "draft" }), ["FOXTROT5"]);
    // Only its own offers, whatever the filters say.
    assert.deepEqual(await own({ owner: "platform,restaurant" }), ["CHARLIE20", "FOXTROT5"]);
    assert.deepEqual(Object.keys(fieldErrors(await get({ status: "lost" }, partner, "/api/v1/my/restaurant/offers"))), ["status"]);
  });
});
