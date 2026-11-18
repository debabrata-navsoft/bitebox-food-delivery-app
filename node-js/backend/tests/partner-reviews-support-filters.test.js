// Global filters on the restaurant panel's and the rider's lists (reviews, settlements, payouts)
// and on "Help & support" (a requester's own tickets): multi-value filters (OR within one, AND
// across), facet counts (`facets=1`) over the signed-in user's own rows only, and 422s. Same
// cases as backend/apps/reviews/tests/test_partner_review_filters.py,
// backend/apps/support/tests/test_my_ticket_filters.py and
// backend/apps/finance/tests/test_partner_finance_filters.py. Fictional data only.
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import mongoose from "mongoose";
import { FoodItem } from "../models/food-item.model.js";
import { Order } from "../models/order.model.js";
import { Payout } from "../models/payout.model.js";
import { Review } from "../models/review.model.js";
import { SupportTicket } from "../models/support-ticket.model.js";
import { buildApp, createAndLogin, request, resetDb, setupTestDb, teardownTestDb } from "./helpers.js";
import {
  at,
  auth,
  counts,
  fieldErrors as errors,
  insertRestaurant as restaurant,
  insertUser as user,
  listed,
  ok,
  oid,
} from "./list-filter-fixtures.js";

const PHOTO = "/uploads/reviews/plate.jpg";

describe("partner and requester list filters and facets", () => {
  let app;
  let owner;
  let rider;
  let seq = 0;

  before(async () => {
    await setupTestDb();
    app = buildApp();
  });
  after(teardownTestDb);

  beforeEach(async () => {
    await resetDb();
    owner = await createAndLogin(app, "restaurant");
    rider = await createAndLogin(app, "delivery");
  });

  const getAs = (who, path, query = {}) =>
    request(app).get(`/api/v1/${path}`).query(query).set(auth(who.token));

  async function dish(kitchen, name) {
    const _id = oid();
    await FoodItem.collection.insertOne({ _id, restaurant: kitchen._id, name, pricePaise: 25_000 });
    return _id;
  }

  describe("reviews", () => {
    const ORDERS = "my/restaurant/reviews/orders";
    const RIDER = "delivery/reviews";
    let bowl;
    let wrap;

    async function review(orderNumber, order, kitchen, target, rating, { day = "2026-04-02", replied, ...fields } = {}) {
      await Review.collection.insertOne({
        target,
        customer: oid(),
        customerName: "Tara Fenwick",
        order,
        orderNumber,
        restaurant: kitchen._id,
        rating,
        comment: "",
        images: [],
        status: "published",
        openReports: 0,
        createdAt: at(day),
        updatedAt: at(day),
        ...(replied && { response: { text: "Thank you for ordering!", respondedAt: at(day) } }),
        ...fields,
      });
    }

    beforeEach(async () => {
      const mine = await restaurant("Aster Kitchen", new mongoose.Types.ObjectId(owner.user.id));
      const other = await restaurant("Birch Diner");
      bowl = await dish(mine, "Paneer Bowl");
      wrap = await dish(mine, "Veg Wrap");
      const me = new mongoose.Types.ObjectId(rider.user.id);
      const [a, b, c, x] = [oid(), oid(), oid(), oid()];
      // A: 5-star restaurant review with photos (replied) and a 4-star dish review.
      await review("BB-A-000001", a, mine, "restaurant", 5, { images: [PHOTO], replied: true, comment: "Lovely food" });
      await review("BB-A-000001", a, mine, "food", 4, { foodItem: bowl, foodName: "Paneer Bowl" });
      // B: 2-star restaurant review, not replied; and a rider rating the restaurant never sees.
      await review("BB-B-000002", b, mine, "restaurant", 2, { day: "2026-04-05", comment: "Cold on arrival" });
      await review("BB-B-000002", b, mine, "rider", 1, { day: "2026-04-05", deliveryPartner: me, comment: "Late" });
      // C: a hidden review (never shown) and a 3-star dish review.
      await review("BB-C-000003", c, mine, "restaurant", 1, { status: "hidden" });
      await review("BB-C-000003", c, mine, "food", 3, { day: "2026-04-07", foodItem: wrap, foodName: "Veg Wrap" });
      // Another restaurant's review and another rider's rating: never counted here.
      await review("BB-X-000009", x, other, "restaurant", 5, { images: [PHOTO] });
      await review("BB-X-000009", x, other, "rider", 5, { deliveryPartner: oid(), comment: "Great" });
      await review("BB-A-000001", a, mine, "rider", 4, { deliveryPartner: me });
      await review("BB-C-000003", c, mine, "rider", 5, { day: "2026-04-07", deliveryPartner: me, comment: "Quick and kind" });
    });

    const numbers = (res) => [...new Set(listed(res, "orderNumber"))];
    const restaurantOrders = (query) => getAs(owner, ORDERS, query);
    const riderRatings = (query) => getAs(rider, RIDER, query);

    it("filters the restaurant's reviews with several values per filter", async () => {
      const every = ["BB-A-000001", "BB-B-000002", "BB-C-000003"];
      assert.deepEqual(numbers(await restaurantOrders()), every);
      assert.deepEqual(numbers(await restaurantOrders({ rating: "2,3" })), ["BB-B-000002", "BB-C-000003"]);
      assert.deepEqual(numbers(await restaurantOrders({ target: "food" })), ["BB-A-000001", "BB-C-000003"]);
      assert.deepEqual(numbers(await restaurantOrders({ reply: "needed" })), every);
      assert.deepEqual(numbers(await restaurantOrders({ reply: "replied" })), ["BB-A-000001"]);
      assert.deepEqual(numbers(await restaurantOrders({ photos: "with" })), ["BB-A-000001"]);
      assert.deepEqual(numbers(await restaurantOrders({ dish: `${bowl},${wrap}` })), ["BB-A-000001", "BB-C-000003"]);
      // AND across filters.
      assert.deepEqual(numbers(await restaurantOrders({ target: "food", rating: "3", reply: "needed" })), ["BB-C-000003"]);
      assert.deepEqual(numbers(await restaurantOrders({ createdFrom: "2026-04-05", createdTo: "2026-04-06" })), ["BB-B-000002"]);
      assert.deepEqual(numbers(await restaurantOrders({ search: "cold" })), ["BB-B-000002"]);
      assert.deepEqual(numbers(await restaurantOrders({ search: "veg wrap" })), ["BB-C-000003"]);
      // The older single filters still work.
      assert.deepEqual(numbers(await restaurantOrders({ rating: "4" })), ["BB-A-000001"]);
      assert.deepEqual(numbers(await restaurantOrders({ responded: "true" })), ["BB-A-000001"]);
      assert.deepEqual(numbers(await restaurantOrders({ foodItemId: String(wrap) })), ["BB-C-000003"]);
    });

    it("counts the restaurant's own orders over the other filters", async () => {
      assert.equal(ok(await restaurantOrders()).facets, undefined);
      const everything = await restaurantOrders({ facets: "1" });
      assert.deepEqual(counts(everything, "target"), { restaurant: 2, food: 2 });
      assert.deepEqual(counts(everything, "rating"), { 1: 0, 2: 1, 3: 1, 4: 1, 5: 1 });
      assert.deepEqual(counts(everything, "reply"), { needed: 3, replied: 1 });
      assert.deepEqual(counts(everything, "photos"), { with: 1, without: 3 });
      assert.deepEqual(ok(everything).facets.dish, [
        { value: String(bowl), label: "Paneer Bowl", count: 1 },
        { value: String(wrap), label: "Veg Wrap", count: 1 },
      ]);
      const res = await restaurantOrders({ target: "restaurant", facets: "1" });
      assert.deepEqual(numbers(res), ["BB-A-000001", "BB-B-000002"]);
      assert.deepEqual(counts(res, "target"), { restaurant: 2, food: 2 });
      assert.deepEqual(counts(res, "rating"), { 1: 0, 2: 1, 3: 0, 4: 0, 5: 1 });
      assert.deepEqual(counts(res, "photos"), { with: 1, without: 1 });
      assert.deepEqual(ok(res).facets.dish, []);
    });

    it("filters and counts the rider's own ratings only", async () => {
      const every = ok(await riderRatings());
      assert.deepEqual(every.items.map((r) => r.orderNumber).sort(), ["BB-A-000001", "BB-B-000002", "BB-C-000003"]);
      assert.equal(every.facets, undefined);
      assert.deepEqual(numbers(await riderRatings({ rating: "1,5" })), ["BB-B-000002", "BB-C-000003"]);
      assert.deepEqual(numbers(await riderRatings({ rating: "4" })), ["BB-A-000001"]);
      assert.deepEqual(numbers(await riderRatings({ comment: "with" })), ["BB-B-000002", "BB-C-000003"]);
      assert.deepEqual(numbers(await riderRatings({ comment: "with", rating: "5" })), ["BB-C-000003"]);
      assert.deepEqual(numbers(await riderRatings({ createdFrom: "2026-04-07" })), ["BB-C-000003"]);
      assert.deepEqual(numbers(await riderRatings({ search: "late" })), ["BB-B-000002"]);
      const res = await riderRatings({ comment: "with", facets: "1" });
      assert.deepEqual(counts(res, "comment"), { with: 2, without: 1 });
      assert.deepEqual(counts(res, "rating"), { 1: 1, 2: 0, 3: 0, 4: 0, 5: 1 });
    });

    it("rejects invalid values with 422", async () => {
      assert.equal(errors(await restaurantOrders({ rating: "6" })).rating, "Invalid value");
      assert.equal(errors(await restaurantOrders({ target: "rider" })).target, "Invalid value");
      assert.equal(errors(await restaurantOrders({ reply: "maybe" })).reply, "Invalid value");
      assert.equal(errors(await restaurantOrders({ photos: "some" })).photos, "Invalid value");
      assert.equal(errors(await restaurantOrders({ dish: "abc" })).dish, "Invalid value");
      assert.ok(errors(await restaurantOrders({ createdFrom: "2026-04-05", createdTo: "2026-04-01" })).createdTo);
      assert.equal(errors(await riderRatings({ rating: "0" })).rating, "Invalid value");
      assert.equal(errors(await riderRatings({ comment: "yes" })).comment, "Invalid value");
    });
  });

  describe("my tickets", () => {
    const TICKETS = "support/tickets";

    async function ticket(subject, by, { day = "2026-03-10", ...fields } = {}) {
      seq += 1;
      const _id = oid();
      await SupportTicket.collection.insertOne({
        _id,
        number: `TK-MINE-${seq}`,
        raisedBy: by,
        requesterRole: "restaurant",
        requesterName: "Neel Fictional",
        type: "account",
        subject,
        priority: "medium",
        status: "open",
        messages: [],
        history: [],
        lastActivityAt: at(day),
        createdAt: at(day),
        updatedAt: at(day),
        ...fields,
      });
      return _id;
    }

    beforeEach(async () => {
      const me = new mongoose.Types.ObjectId(owner.user.id);
      const other = await user("Ivy Fictional", "restaurant");
      await ticket("Menu upload fails", me, {
        // A staff-only note on the partner's own ticket: the search never reads notes.
        messages: [
          { author: oid(), authorRole: "support_admin", authorName: "Mira Support", body: "Internal: escalate quietly", internal: true, createdAt: at("2026-03-10") },
        ],
      });
      await ticket("Payout missing", me, { type: "payment", status: "waiting_for_response" });
      await ticket("Refund dispute", me, {
        type: "refund",
        status: "resolved",
        orderNumber: "BB-260401-ABC123",
        day: "2026-03-12",
      });
      await ticket("Old account question", me, { status: "closed", day: "2026-03-14" });
      // Somebody else's tickets: never listed or counted.
      await ticket("Not yours", other, { type: "payment", status: "waiting_for_response" });
      await ticket("Not yours either", other, { type: "refund", status: "closed" });
    });

    const mine = (query) => getAs(owner, TICKETS, query);
    const subjects = (res) => listed(res, "subject");

    it("filters the requester's own tickets with several values per filter", async () => {
      assert.deepEqual(subjects(await mine()), ["Menu upload fails", "Old account question", "Payout missing", "Refund dispute"]);
      // The older values still work: open = not resolved or closed yet; closed = resolved or closed.
      assert.deepEqual(subjects(await mine({ status: "open" })), ["Menu upload fails", "Payout missing"]);
      assert.deepEqual(subjects(await mine({ status: "closed" })), ["Old account question", "Refund dispute"]);
      assert.deepEqual(subjects(await mine({ status: "waiting_for_response,closed" })), [
        "Old account question",
        "Payout missing",
        "Refund dispute",
      ]);
      assert.deepEqual(subjects(await mine({ type: "payment,refund" })), ["Payout missing", "Refund dispute"]);
      assert.deepEqual(subjects(await mine({ type: "payment,refund", status: "closed" })), ["Refund dispute"]);
      assert.deepEqual(subjects(await mine({ createdFrom: "2026-03-12", createdTo: "2026-03-13" })), ["Refund dispute"]);
      assert.deepEqual(subjects(await mine({ search: "ABC123" })), ["Refund dispute"]);
      assert.deepEqual(subjects(await mine({ search: "not yours" })), []);
      assert.deepEqual(subjects(await mine({ search: "quietly" })), []);
    });

    it("counts the requester's own tickets over the other filters", async () => {
      assert.equal(ok(await mine()).facets, undefined);
      const everything = await mine({ facets: "1" });
      assert.deepEqual(counts(everything, "status"), { open: 2, waiting_for_response: 1, closed: 2 });
      assert.deepEqual(counts(everything, "type"), {
        order_issue: 0,
        delivery: 0,
        payment: 1,
        refund: 1,
        account: 2,
        other: 0,
      });
      const res = await mine({ status: "closed", facets: "1" });
      assert.deepEqual(subjects(res), ["Old account question", "Refund dispute"]);
      assert.deepEqual(counts(res, "status"), { open: 2, waiting_for_response: 1, closed: 2 });
      assert.equal(counts(res, "type").refund, 1);
      assert.equal(counts(res, "type").payment, 0);
      // The list rows carry no messages (and so no internal notes).
      assert.ok(ok(res).items.every((t) => t.messages.length === 0));
    });

    it("rejects invalid values with 422", async () => {
      assert.equal(errors(await mine({ status: "in_progress" })).status, "Invalid value");
      assert.equal(errors(await mine({ type: "billing" })).type, "Invalid value");
      assert.ok(errors(await mine({ createdFrom: "2026-03-12", createdTo: "2026-03-01" })).createdTo);
    });
  });

  describe("settlements and payouts", () => {
    async function payout(payee, kitchen, status, reference, day) {
      const _id = oid();
      await Payout.collection.insertOne({
        _id,
        type: kitchen ? "restaurant" : "rider",
        payee,
        payeeName: "Fictional Payee",
        ...(kitchen && { restaurant: kitchen._id }),
        orders: 1,
        amountPaise: 10_000,
        status,
        reference,
        createdBy: oid(),
        createdAt: at(day),
        updatedAt: at(day),
      });
      return _id;
    }

    async function settled(kitchen, riderId, orderNumber, day, links = {}) {
      await Order.collection.insertOne({
        orderNumber,
        customer: oid(),
        restaurant: kitchen._id,
        deliveryPartner: riderId,
        status: "delivered",
        pricing: { subtotalPaise: 25_000, discountPaise: 0, totalPaise: 29_250 },
        settlement: { at: at(day), restaurantPaise: 21_250, riderPaise: 4_000, platformPaise: 1_000, commissionBp: 1500 },
        payouts: { restaurant: links.restaurant ?? null, rider: links.rider ?? null },
        createdAt: at(day),
        updatedAt: at(day),
      });
    }

    beforeEach(async () => {
      const ownerId = new mongoose.Types.ObjectId(owner.user.id);
      const riderId = new mongoose.Types.ObjectId(rider.user.id);
      const mine = await restaurant("Aster Kitchen", ownerId);
      const otherOwner = await user("Owner Two", "restaurant");
      const other = await restaurant("Birch Diner", otherOwner);
      const otherRider = await user("Uma Rider", "delivery");
      const paid = await payout(ownerId, mine, "paid", "UTR-PAID-1", "2026-05-02");
      const pending = await payout(ownerId, mine, "pending", "UTR-PEND-2", "2026-05-06");
      await payout(ownerId, mine, "cancelled", "UTR-CANC-3", "2026-05-08");
      const riderPaid = await payout(riderId, null, "paid", "UTR-RIDE-4", "2026-05-03");
      // Another restaurant's and another rider's payouts: never listed or counted.
      await payout(otherOwner, other, "pending", "UTR-OTHR-5", "2026-05-06");
      await payout(otherRider, null, "pending", "UTR-OTHR-6", "2026-05-06");
      await settled(mine, riderId, "BB-S-000001", "2026-05-01", { restaurant: paid, rider: riderPaid });
      await settled(mine, riderId, "BB-S-000002", "2026-05-05", { restaurant: pending });
      await settled(mine, otherRider, "BB-S-000003", "2026-05-07");
      await settled(other, otherRider, "BB-S-000009", "2026-05-07");
    });

    const numbers = (res) => listed(res, "orderNumber");
    const references = (res) => listed(res, "reference");

    it("filters and counts a partner's own settlements", async () => {
      const url = "my/restaurant/settlements";
      const get = (query) => getAs(owner, url, query);
      assert.deepEqual(numbers(await get()), ["BB-S-000001", "BB-S-000002", "BB-S-000003"]);
      assert.equal(ok(await get()).facets, undefined);
      assert.deepEqual(numbers(await get({ status: "due,pending" })), ["BB-S-000002", "BB-S-000003"]);
      assert.deepEqual(numbers(await get({ status: "paid" })), ["BB-S-000001"]);
      assert.deepEqual(numbers(await get({ settledFrom: "2026-05-05", settledTo: "2026-05-06" })), ["BB-S-000002"]);
      assert.deepEqual(numbers(await get({ search: "000003" })), ["BB-S-000003"]);
      const res = await get({ status: "paid", settledFrom: "2026-05-02", facets: "1" });
      assert.deepEqual(numbers(res), []);
      assert.deepEqual(counts(res, "status"), { due: 1, pending: 1, paid: 0 });
      // The rider's side follows the rider's own payout link.
      const riderUrl = "delivery/settlements";
      assert.deepEqual(numbers(await getAs(rider, riderUrl)), ["BB-S-000001", "BB-S-000002"]);
      assert.deepEqual(counts(await getAs(rider, riderUrl, { facets: "1" }), "status"), { due: 1, pending: 0, paid: 1 });
    });

    it("filters and counts a partner's own payouts", async () => {
      const get = (query) => getAs(owner, "my/restaurant/payouts", query);
      assert.deepEqual(references(await get()), ["UTR-CANC-3", "UTR-PAID-1", "UTR-PEND-2"]);
      assert.deepEqual(references(await get({ status: "paid,cancelled" })), ["UTR-CANC-3", "UTR-PAID-1"]);
      assert.deepEqual(references(await get({ createdFrom: "2026-05-05" })), ["UTR-CANC-3", "UTR-PEND-2"]);
      assert.deepEqual(references(await get({ search: "pend" })), ["UTR-PEND-2"]);
      const res = await get({ status: "paid", facets: "1" });
      assert.deepEqual(Object.keys(ok(res).facets), ["status"]);
      assert.deepEqual(counts(res, "status"), { pending: 1, paid: 1, cancelled: 1 });
      const riders = await getAs(rider, "delivery/payouts", { facets: "1" });
      assert.deepEqual(references(riders), ["UTR-RIDE-4"]);
      assert.deepEqual(counts(riders, "status"), { pending: 0, paid: 1, cancelled: 0 });
    });

    it("rejects invalid values with 422", async () => {
      assert.equal(errors(await getAs(owner, "my/restaurant/settlements", { status: "cancelled" })).status, "Invalid value");
      assert.ok(
        errors(await getAs(owner, "my/restaurant/settlements", { settledFrom: "2026-05-05", settledTo: "2026-05-01" }))
          .settledTo,
      );
      assert.equal(errors(await getAs(rider, "delivery/payouts", { status: "due" })).status, "Invalid value");
      assert.ok(errors(await getAs(owner, "my/restaurant/payouts", { createdFrom: "May 1" })).createdFrom);
    });
  });
});
