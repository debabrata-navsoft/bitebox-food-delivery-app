import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import mongoose from "mongoose";
import { Restaurant } from "../models/restaurant.model.js";
import { Review } from "../models/review.model.js";
import { buildApp, request, resetDb, seedCatalogFor, setupTestDb, teardownTestDb } from "./helpers.js";

describe("featured reviews (home page)", () => {
  let app;
  before(async () => {
    await setupTestDb();
    app = buildApp();
  });
  after(teardownTestDb);
  beforeEach(resetDb);

  // Raw inserts: only the fields the public view reads.
  const add = (restaurant, fields) =>
    Review.collection.insertOne({
      target: "restaurant",
      restaurant: restaurant._id,
      customer: new mongoose.Types.ObjectId(),
      customerName: "Meera Iyer",
      order: new mongoose.Types.ObjectId(),
      status: "published",
      rating: 5,
      comment: "Hot, fresh and on time.",
      createdAt: new Date(),
      ...fields,
    });

  it("lists recent happy reviews with a comment, publicly and without private details", async () => {
    await seedCatalogFor(app);
    const live = await Restaurant.findOne({ slug: "spice-route-kitchen" });
    await add(live, {});
    await add(live, { rating: 2, comment: "Cold food." });
    await add(live, { comment: "" });
    await add(live, { status: "hidden" });
    const res = await request(app).get("/api/v1/reviews/featured");
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const { items } = res.body.data;
    assert.equal(items.length, 1);
    assert.equal(items[0].authorName, "Meera Iyer"); // same as public restaurant reviews
    assert.equal(items[0].restaurant.slug, "spice-route-kitchen");
    assert.ok(!("customer" in items[0]) && !("order" in items[0]));
  });

  it("leaves out reviews of restaurants that are not live", async () => {
    await seedCatalogFor(app);
    const live = await Restaurant.findOne({ slug: "spice-route-kitchen" });
    await add(live, {});
    await Restaurant.updateOne({ _id: live._id }, { status: "suspended" });
    const res = await request(app).get("/api/v1/reviews/featured");
    assert.equal(res.body.data.items.length, 0);
  });
});
