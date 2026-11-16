import assert from "node:assert/strict";
import mongoose from "mongoose";
import { after, before, beforeEach, describe, it } from "node:test";
import { Coupon, CouponRedemption } from "../models/coupon.model.js";
import { FoodItem } from "../models/food-item.model.js";
import { Notification } from "../models/notification.model.js";
import { Restaurant } from "../models/restaurant.model.js";
import { useOfferApproval } from "../services/coupon.service.js";
import {
  buildApp,
  createAndLogin,
  registerUser,
  request,
  resetDb,
  seedCatalogFor,
  setupTestDb,
  teardownTestDb,
} from "./helpers.js";

/**
 * Coupons and restaurant offers (Django: apps/coupons/tests/test_offers.py): admin management, the
 * approval queue, what customers see, and the engine's rules at checkout.
 */
const WINDOW = { validFrom: "2026-01-01T00:00:00Z", validUntil: "2027-12-31T00:00:00Z" };
const ADDRESS = {
  recipientName: "Asha",
  phone: "9000000002",
  line1: "Flat 4B, 80 Feet Road",
  city: "Bengaluru",
  state: "Karnataka",
  postalCode: "560034",
  location: { latitude: 12.9352, longitude: 77.6271 },
};

describe("coupons and restaurant offers", () => {
  let app;
  let admin;
  let partner;
  let customer;
  let food;
  let kitchen;
  const as = (who) => ({
    get: (url) => request(app).get(url).set("Authorization", `Bearer ${who.token}`),
    post: (url, body) => request(app).post(url).set("Authorization", `Bearer ${who.token}`).send(body),
    patch: (url, body) => request(app).patch(url).set("Authorization", `Bearer ${who.token}`).send(body),
  });

  before(async () => {
    await setupTestDb();
    app = buildApp();
  });
  after(async () => {
    useOfferApproval(null);
    await teardownTestDb();
  });
  beforeEach(async () => {
    useOfferApproval(null);
    await resetDb();
    partner = await seedCatalogFor(app);
    const { seedCheckoutData } = await import("../scripts/seed.js");
    await seedCheckoutData();
    await Coupon.deleteMany({});
    kitchen = await Restaurant.findOneAndUpdate(
      { slug: "spice-route-kitchen" },
      { openingTime: "00:00", closingTime: "00:00" },
      { returnDocument: "after" },
    );
    admin = await createAndLogin(app, "admin");
    customer = await createAndLogin(app, "customer");
    food = Object.fromEntries((await FoodItem.find()).map((f) => [f.name, f]));
    await as(customer).post("/api/v1/addresses", ADDRESS);
  });

  const add = async (...names) => {
    for (const name of names) {
      const res = await as(customer).post("/api/v1/cart/items", { foodItemId: food[name].id, quantity: 1 });
      assert.equal(res.status, 200, JSON.stringify(res.body));
    }
  };
  const apply = (code) => as(customer).post("/api/v1/cart/coupon", { code });
  const adminCoupon = async (body = {}) => {
    const res = await as(admin).post("/api/v1/admin/coupons", { discountType: "percent", discountValue: 10, ...WINDOW, ...body });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    return res.body.data.coupon;
  };
  const offer = async (body = {}) => {
    const res = await as(partner).post("/api/v1/my/restaurant/offers", {
      name: "Weekday treat",
      discountType: "percent",
      discountValue: 20,
      ...WINDOW,
      ...body,
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    return res.body.data.coupon;
  };
  const publicCodes = async () => {
    const res = await request(app).get("/api/v1/restaurants/spice-route-kitchen/offers");
    assert.equal(res.status, 200, JSON.stringify(res.body));
    return res.body.data.offers.map((o) => o.code);
  };

  it("lets admins create coupons with generated codes and manage them", async () => {
    const first = await adminCoupon({ name: "Weekend saver", terms: "One per order." });
    assert.ok(first.code.startsWith("BB"));
    assert.equal(first.status, "active");
    assert.deepEqual([first.source, first.approvalStatus], ["platform", "approved"]);
    const free = await adminCoupon({ code: "freeship", discountType: "free_delivery", discountValue: null });
    assert.deepEqual([free.code, free.discountValue], ["FREESHIP", 0]);

    const paused = await as(admin).patch(`/api/v1/admin/coupons/${first.id}/status`, { isActive: false });
    assert.equal(paused.body.data.coupon.status, "paused");
    const listed = (await as(admin).get("/api/v1/admin/coupons?status=paused")).body.data.items;
    assert.deepEqual(listed.map((c) => c.code), [first.code]);

    const copy = await as(admin).post(`/api/v1/admin/coupons/${free.id}/duplicate`);
    assert.equal(copy.status, 201);
    assert.notEqual(copy.body.data.coupon.code, "FREESHIP");
    assert.equal(copy.body.data.coupon.isActive, false);

    const stats = (await as(admin).get("/api/v1/admin/coupons/analytics")).body.data;
    assert.deepEqual([stats.total, stats.active, stats.paused, stats.redemptions], [3, 1, 2, 0]);
  });

  it("holds restaurant offers for approval and only then shows them to customers", async () => {
    const created = await offer({ maxDiscountPaise: 10000 });
    assert.deepEqual([created.source, created.status], ["restaurant", "pending"]);
    assert.deepEqual(await publicCodes(), []);
    assert.deepEqual((await as(customer).get("/api/v1/coupons/offers")).body.data.offers, []);

    const pending = (await as(admin).get("/api/v1/admin/restaurant-offers/pending")).body.data.items;
    assert.deepEqual(pending.map((p) => p.id), [created.id]);
    const approved = await as(admin).post(`/api/v1/admin/restaurant-offers/${created.id}/approve`);
    assert.equal(approved.body.data.coupon.status, "active");
    assert.deepEqual(await publicCodes(), [created.code]);

    const cards = (await request(app).get("/api/v1/restaurants")).body.data.items;
    const card = cards.find((c) => c.slug === "spice-route-kitchen");
    assert.equal(card.offer.code, created.code);
    assert.equal(card.offer.maxDiscountPaise, 10000);

    // Any edit sends it back for review, hiding it meanwhile.
    const edited = await as(partner).patch(`/api/v1/my/restaurant/offers/${created.id}`, { discountValue: 25 });
    assert.equal(edited.body.data.coupon.status, "pending");
    assert.deepEqual(await publicCodes(), []);

    const reject = `/api/v1/admin/restaurant-offers/${created.id}/reject`;
    assert.equal((await as(admin).post(reject, {})).status, 422); // needs a reason
    const rejected = await as(admin).post(reject, { reason: "Too generous for a weekday" });
    assert.equal(rejected.body.data.coupon.rejectionReason, "Too generous for a weekday");
    assert.ok(await Notification.exists({ user: kitchen.owner, type: "offer.rejected" }));
  });

  it("puts offers live at once when approval is off", async () => {
    useOfferApproval(false);
    assert.equal((await offer()).status, "active");
    assert.equal((await offer({ draft: true })).status, "draft"); // a draft never reaches customers
  });

  it("lets partners manage only their own offers and dishes", async () => {
    const mine = await offer();
    const { token } = await registerUser(app, { role: "restaurant" });
    const rival = { token };
    assert.equal((await as(rival).get(`/api/v1/my/restaurant/offers/${mine.id}`)).status, 404);
    assert.equal((await as(rival).patch(`/api/v1/my/restaurant/offers/${mine.id}`, { discountValue: 90 })).status, 404);

    const foreign = food["Masala Dosa"].toObject();
    delete foreign._id;
    const dish = await FoodItem.create({ ...foreign, name: "Rival Burger", restaurant: new mongoose.Types.ObjectId() });
    const refused = await as(partner).post("/api/v1/my/restaurant/offers", {
      discountType: "flat",
      discountValue: 5000,
      ...WINDOW,
      foodItems: [dish.id],
    });
    assert.equal(refused.status, 422);
    assert.equal(refused.body.error.details[0].field, "foodItems");
    assert.equal((await as(customer).get("/api/v1/my/restaurant/offers")).status, 403);
  });

  it("hides expired and paused coupons", async () => {
    await adminCoupon({ code: "LATE10" });
    const now = Date.now();
    await Coupon.updateOne({ code: "LATE10" }, { validFrom: new Date(now - 10 * 864e5), validUntil: new Date(now - 864e5) });
    assert.ok(!(await publicCodes()).includes("LATE10"));
    await add("Masala Dosa");
    const expired = await apply("LATE10");
    assert.equal(expired.status, 422);
    assert.equal(expired.body.error.code, "COUPON_EXPIRED");
    await Coupon.updateOne({ code: "LATE10" }, { validUntil: new Date(now + 864e5), isActive: false });
    assert.ok(!(await publicCodes()).includes("LATE10"));
  });

  it("keeps first-order coupons for new customers", async () => {
    await adminCoupon({ code: "FIRST50", audience: "new" });
    const codes = async () => (await as(customer).get("/api/v1/coupons/available")).body.data.coupons.map((c) => c.code);
    assert.deepEqual(await codes(), ["FIRST50"]);
    await add("Masala Dosa", "Gulab Jamun (2 pcs)");
    const quote = (await as(customer).get("/api/v1/cart")).body.data;
    const placed = await as(customer).post("/api/v1/orders", { paymentMethod: "cod", addressId: quote.address.id });
    assert.equal(placed.status, 201, JSON.stringify(placed.body));
    assert.deepEqual(await codes(), []);
    await add("Masala Dosa");
    assert.equal((await apply("FIRST50")).body.error.code, "COUPON_NEW_CUSTOMERS");
  });

  it("discounts only the dishes in a category coupon's categories", async () => {
    const desserts = String(food["Gulab Jamun (2 pcs)"].category);
    await adminCoupon({ code: "SWEET50", discountValue: 50, categories: [desserts] });
    await add("Masala Dosa");
    assert.equal((await apply("SWEET50")).body.error.code, "COUPON_NOT_APPLICABLE");
    await add("Gulab Jamun (2 pcs)");
    const quote = (await apply("SWEET50")).body.data;
    assert.equal(quote.pricing.discountPaise, Math.floor(food["Gulab Jamun (2 pcs)"].pricePaise / 2));
  });

  it("waives the delivery fee with a free-delivery coupon and keeps it on the order", async () => {
    await adminCoupon({ code: "NODELIVERY", discountType: "free_delivery" });
    await add("Masala Dosa", "Gulab Jamun (2 pcs)"); // below the free-delivery threshold
    const before = (await as(customer).get("/api/v1/cart")).body.data;
    const waived = before.pricing.deliveryFeePaise;
    assert.ok(waived > 0);
    const quote = (await apply("NODELIVERY")).body.data;
    assert.equal(quote.pricing.deliveryFeePaise, 0);
    assert.equal(quote.pricing.deliveryDiscountPaise, waived);
    assert.equal(quote.pricing.totalPaise, before.pricing.totalPaise - waived);
    assert.equal(quote.coupon.discountPaise, waived);

    const placed = await as(customer).post("/api/v1/orders", { paymentMethod: "cod", addressId: quote.address.id });
    assert.equal(placed.status, 201, JSON.stringify(placed.body));
    const order = placed.body.data.order;
    assert.equal(order.pricing.deliveryDiscountPaise, waived);
    assert.equal((await CouponRedemption.findOne({ order: order.id })).discountPaise, waived);
  });
});
