import assert from "node:assert/strict";
import mongoose from "mongoose";
import { after, before, beforeEach, describe, it } from "node:test";
import { Coupon, CouponRedemption } from "../models/coupon.model.js";
import { FoodItem } from "../models/food-item.model.js";
import { Notification } from "../models/notification.model.js";
import { Order } from "../models/order.model.js";
import { Restaurant } from "../models/restaurant.model.js";
import { useOfferApproval } from "../services/coupon.service.js";
import { settlementFor } from "../services/earnings.service.js";
import { mockProvider } from "../services/payments/mock.provider.js";
import { useOnlineProvider } from "../services/payments/payment.service.js";
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

  it("suggests the coupon that saves most on the cart", async () => {
    await adminCoupon({ code: "TENOFF" });
    await adminCoupon({ code: "FLAT60", discountType: "flat", discountValue: 6000 });
    await adminCoupon({ code: "NODELIVERY", discountType: "free_delivery" });
    await adminCoupon({ code: "BIGHALF", discountValue: 50, minOrderPaise: 50000 }); // cart is below ₹500
    assert.equal((await as(customer).get("/api/v1/cart")).body.data.bestCoupon, null); // empty cart
    await add("Masala Dosa", "Gulab Jamun (2 pcs)");
    const best = (await as(customer).get("/api/v1/cart")).body.data.bestCoupon;
    assert.deepEqual([best.code, best.savingPaise], ["FLAT60", 6000]);
    const quote = (await apply("FLAT60")).body.data;
    assert.equal(quote.coupon.discountPaise, best.savingPaise); // the suggestion is exact
  });

  /** One of each kind: the kitchen's 20% offer, ₹30 platform offer, 10% coupon, ₹25 on UPI. */
  const stacked = async () => {
    useOfferApproval(false);
    await offer({ code: "KITCHEN20", discountValue: 20 });
    await adminCoupon({ code: "ALL30", kind: "platform_offer", discountType: "flat", discountValue: 3000 });
    await adminCoupon({ code: "TENOFF" });
    await adminCoupon({
      code: "UPI25",
      kind: "payment_offer",
      paymentChannels: ["upi"],
      discountType: "flat",
      discountValue: 2500,
    });
    await add("Masala Dosa", "Gulab Jamun (2 pcs)"); // ₹248
  };

  it("stacks discounts in order, each on what is left", async () => {
    await stacked();
    // Without a payment channel: the two automatic offers; UPI's offer is listed for later.
    let quote = (await as(customer).get("/api/v1/cart")).body.data;
    assert.deepEqual(
      quote.discounts.map((d) => [d.code, d.foodPaise]),
      [
        ["KITCHEN20", 4960], // 20% of ₹248
        ["ALL30", 3000],
      ],
    );
    assert.equal(quote.bestCoupon.code, "TENOFF");
    assert.deepEqual(
      quote.paymentOffers.map((p) => [p.channel, p.code, p.savingPaise]),
      [["upi", "UPI25", 2500]],
    );
    // Codes are only for coupons: an automatic offer can't be entered.
    assert.equal((await apply("ALL30")).body.error.code, "COUPON_AUTOMATIC");

    await apply("TENOFF");
    quote = (await as(customer).get("/api/v1/cart?payment=upi")).body.data;
    assert.deepEqual(
      quote.discounts.map((d) => [d.kind, d.code, d.foodPaise]),
      [
        ["restaurant_offer", "KITCHEN20", 4960],
        ["platform_offer", "ALL30", 3000],
        ["coupon", "TENOFF", 1684], // 10% of the ₹168.40 left
        ["payment_offer", "UPI25", 2500],
      ],
    );
    assert.equal(quote.pricing.discountPaise, 4960 + 3000 + 1684 + 2500);
    assert.deepEqual(quote.coupon, {
      code: "TENOFF",
      description: null,
      discountType: "percent",
      discountPaise: 1684,
    });
    const card = (await as(customer).get("/api/v1/cart?payment=card")).body.data;
    assert.ok(!card.discounts.map((d) => d.code).includes("UPI25"));
  });

  it("keeps every discount on the order and gives the uses back", async () => {
    const restore = useOnlineProvider(mockProvider);
    try {
      await stacked();
      await apply("TENOFF");
      const addressId = (await as(customer).get("/api/v1/cart")).body.data.address.id;
      const placed = await as(customer).post("/api/v1/orders", {
        paymentMethod: "online",
        paymentChannel: "upi",
        addressId,
      });
      assert.equal(placed.status, 201, JSON.stringify(placed.body));
      const data = placed.body.data.order;
      assert.equal(data.paymentChannel, "upi");
      assert.deepEqual(data.discounts.map((d) => d.code), ["KITCHEN20", "ALL30", "TENOFF", "UPI25"]);
      assert.deepEqual(data.coupon, { code: "TENOFF", discountPaise: 1684 });
      assert.equal(await CouponRedemption.countDocuments({ order: data.id }), 4);
      assert.deepEqual(await Coupon.distinct("usedCount"), [1]);

      // Only the restaurant's own offer comes out of its payout (15% commission on the rest).
      const order = await Order.findById(data.id);
      assert.equal(order.restaurantDiscountPaise, 4960);
      assert.equal(settlementFor(order, 1500).restaurantPaise, Math.floor(((24800 - 4960) * 85) / 100));

      const cancelled = await as(customer).post(`/api/v1/orders/${data.id}/cancel`, {});
      assert.equal(cancelled.status, 200, JSON.stringify(cancelled.body));
      assert.deepEqual(await Coupon.distinct("usedCount"), [0]);
      assert.equal(await CouponRedemption.exists({ order: data.id }), null);
    } finally {
      restore();
    }
  });

  it("applies one restaurant offer and lets the customer pick another", async () => {
    useOfferApproval(false);
    await offer({ code: "KITCHEN20", discountValue: 20 });
    await offer({ code: "KITCHEN10", discountValue: 10 });
    await adminCoupon({ code: "ALL30", kind: "platform_offer", discountType: "flat", discountValue: 3000 });
    await add("Masala Dosa", "Gulab Jamun (2 pcs)"); // ₹248
    const restaurantOffers = async () => {
      const quote = (await as(customer).get("/api/v1/cart")).body.data;
      const applied = quote.discounts.filter((d) => d.kind === "restaurant_offer").map((d) => d.code);
      const listed = quote.restaurantOffers.map((o) => [o.code, o.applied]);
      assert.equal(applied.length, 1); // only one ever applies
      assert.ok(listed.some(([code, on]) => code === applied[0] && on));
      return listed;
    };
    assert.deepEqual(await restaurantOffers(), [["KITCHEN20", true], ["KITCHEN10", false]]); // best first
    const picked = await apply("KITCHEN10");
    assert.equal(picked.status, 200, JSON.stringify(picked.body));
    assert.deepEqual(await restaurantOffers(), [["KITCHEN20", false], ["KITCHEN10", true]]);
    assert.equal(picked.body.data.coupon, null); // the coupon slot is untouched
    assert.equal((await apply("ALL30")).body.error.code, "COUPON_AUTOMATIC");
  });

  it("applies a restaurant's offer only to its own dishes", async () => {
    const now = Date.now();
    await Coupon.create({
      code: "HARBOR30",
      kind: "restaurant_offer",
      source: "restaurant",
      restaurant: new mongoose.Types.ObjectId(), // another restaurant
      approvalStatus: "approved",
      discountType: "percent",
      discountValue: 30,
      validFrom: new Date(now - 864e5),
      validUntil: new Date(now + 864e5),
    });
    await add("Masala Dosa"); // from the seeded kitchen
    const quote = (await as(customer).get("/api/v1/cart")).body.data;
    assert.deepEqual(quote.discounts, []);
    assert.deepEqual(quote.restaurantOffers, []);
    assert.equal((await apply("HARBOR30")).body.error.code, "COUPON_NOT_APPLICABLE");
  });
});
