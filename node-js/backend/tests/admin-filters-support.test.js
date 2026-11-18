// Global filters on the admin support queue and the admin review list: multi-value filters (OR
// within one, AND across) and facet counts (`facets=1`). Same cases as
// backend/apps/support/tests/test_support_list_filters.py and
// backend/apps/reviews/tests/test_admin_review_filters.py. Fictional data only.
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import mongoose from "mongoose";
import { Review } from "../models/review.model.js";
import { SupportTicket } from "../models/support-ticket.model.js";
import { User } from "../models/user.model.js";
import { buildApp, createAndLogin, request, resetDb, setupTestDb, teardownTestDb } from "./helpers.js";
import {
  at,
  auth,
  counts,
  fieldErrors as errors,
  insertRestaurant as restaurant,
  insertUser as user,
  listed,
  oid,
} from "./list-filter-fixtures.js";

describe("admin support and review list filters and facets", () => {
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
  });

  const get = (path, query = {}) => request(app).get(`/api/v1/admin/${path}`).query(query).set(auth(admin.token));

  describe("support tickets", () => {
    const TICKETS = "support/tickets";
    let me;
    let other;

    async function ticket(subject, by, { day = "2026-03-10", ...fields } = {}) {
      seq += 1;
      await SupportTicket.collection.insertOne({
        number: `TK-TEST-${seq}`,
        raisedBy: by,
        requesterRole: "customer",
        requesterName: "Fictional Person",
        type: "account",
        subject,
        priority: "medium",
        status: "open",
        assignee: null,
        messages: [],
        history: [],
        lastActivityAt: at(day),
        createdAt: at(day),
        updatedAt: at(day),
        ...fields,
      });
    }

    beforeEach(async () => {
      me = new mongoose.Types.ObjectId(String(admin.user.id ?? admin.user._id));
      await User.collection.updateOne({ _id: me }, { $set: { name: "Mira Support" } });
      other = await user("Kabir Support", "support_admin");
      const customer = await user("Tara Fictional");
      const partner = await user("Neel Fictional", "restaurant");
      await ticket("Late order", customer, { priority: "high", status: "open", assignee: me });
      await ticket("Wrong dish", customer, { type: "order_issue", priority: "urgent", status: "in_progress" });
      await ticket("Refund please", customer, {
        type: "refund",
        priority: "high",
        status: "resolved",
        assignee: other,
        day: "2026-03-12",
      });
      await ticket("Menu update", partner, {
        requesterRole: "restaurant",
        priority: "low",
        status: "waiting_for_response",
        assignee: other,
        day: "2026-03-14",
      });
      await ticket("Old issue", partner, { requesterRole: "restaurant", status: "closed", day: "2026-03-14" });
    });

    const subjects = async (query) => listed(await get(TICKETS, query), "subject");

    it("takes several values per filter and combines filters", async () => {
      assert.deepEqual(await subjects({ status: "open,resolved" }), ["Late order", "Refund please"]);
      assert.deepEqual(await subjects({ priority: "high,urgent", status: "active" }), ["Late order", "Wrong dish"]);
      assert.deepEqual(await subjects({ requesterRole: "restaurant", priority: "low" }), ["Menu update"]);
      assert.deepEqual(await subjects({ type: "refund,order_issue" }), ["Refund please", "Wrong dish"]);
      assert.deepEqual(await subjects({ status: "closed" }), ["Old issue"]);
    });

    it("takes me, unassigned and admin ids as the assignee", async () => {
      assert.deepEqual(await subjects({ assignee: "me" }), ["Late order"]);
      assert.deepEqual(await subjects({ assignee: "unassigned" }), ["Old issue", "Wrong dish"]);
      assert.deepEqual(await subjects({ assignee: `me,${other}` }), ["Late order", "Menu update", "Refund please"]);
    });

    it("narrows by the day created and the search", async () => {
      assert.deepEqual(await subjects({ createdFrom: "2026-03-12", createdTo: "2026-03-13" }), ["Refund please"]);
      assert.deepEqual(await subjects({ createdFrom: "2026-03-14", search: "menu" }), ["Menu update"]);
    });

    it("counts each option over the other filters", async () => {
      const plain = await get(TICKETS);
      assert.equal(plain.body.data.facets, undefined);
      const res = await get(TICKETS, { status: "open,in_progress", priority: "high", facets: "1" });
      assert.deepEqual(listed(res, "subject"), ["Late order"]);
      assert.deepEqual(counts(res, "status"), {
        open: 1,
        in_progress: 0,
        waiting_for_response: 0,
        resolved: 1,
        closed: 0,
      });
      assert.deepEqual(counts(res, "priority"), { low: 0, medium: 0, high: 1, urgent: 1 });
      assert.equal(counts(res, "type").account, 1);
      assert.deepEqual(counts(res, "requesterRole"), { customer: 1, restaurant: 0, delivery: 0 });
      const everyone = (await get(TICKETS, { facets: "true" })).body.data.facets.assignee;
      assert.deepEqual(everyone, [
        { value: "unassigned", label: "Not assigned", count: 2 },
        { value: String(other), label: "Kabir Support", count: 2 },
        { value: String(me), label: "Mira Support", count: 1 },
      ]);
    });

    it("rejects invalid values with 422", async () => {
      assert.equal(errors(await get(TICKETS, { status: "open,bogus" })).status, "Invalid value");
      assert.equal(errors(await get(TICKETS, { assignee: "someone" })).assignee, "Invalid value");
      assert.equal(errors(await get(TICKETS, { priority: "top" })).priority, "Invalid value");
      assert.ok("createdFrom" in errors(await get(TICKETS, { createdFrom: "14-03-2026" })));
      assert.ok("createdTo" in errors(await get(TICKETS, { createdFrom: "2026-03-14", createdTo: "2026-03-10" })));
      assert.ok("facets" in errors(await get(TICKETS, { facets: "maybe" })));
    });
  });

  describe("reviews", () => {
    const ORDERS = "reviews/orders";
    let north;
    let south;

    async function review(orderNumber, kitchen, target, rating, { day = "2026-04-02", order, ...fields } = {}) {
      await Review.collection.insertOne({
        target,
        customer: oid(),
        customerName: "Tara F.",
        order,
        orderNumber,
        restaurant: kitchen._id,
        ...(target === "food" && { foodItem: oid(), foodName: "Paneer Bowl" }),
        ...(target === "rider" && { deliveryPartner: oid() }),
        rating,
        comment: "",
        images: [],
        status: "published",
        openReports: 0,
        createdAt: at(day),
        updatedAt: at(day),
        ...fields,
      });
    }

    beforeEach(async () => {
      north = await restaurant("Aster Kitchen");
      south = await restaurant("Birch Diner");
      const [a, b, c, d] = [oid(), oid(), oid(), oid()];
      // Order A: two reviews, a 5-star restaurant one and a 4-star dish (counts once per order).
      await review("BB-A-000001", north, "restaurant", 5, { order: a });
      await review("BB-A-000001", north, "food", 4, { order: a });
      await review("BB-B-000002", north, "restaurant", 2, {
        order: b,
        status: "hidden",
        openReports: 1,
        day: "2026-04-05",
      });
      await review("BB-C-000003", south, "rider", 1, { order: c, day: "2026-04-07" });
      await review("BB-D-000004", south, "restaurant", 3, { order: d, status: "deleted" });
    });

    const numbers = async (query) => listed(await get(ORDERS, query), "orderNumber");

    it("takes several values per filter and combines filters", async () => {
      assert.deepEqual(await numbers({}), ["BB-A-000001", "BB-B-000002", "BB-C-000003"]);
      assert.deepEqual(await numbers({ rating: "1,2" }), ["BB-B-000002", "BB-C-000003"]);
      assert.deepEqual(await numbers({ target: "food,rider" }), ["BB-A-000001", "BB-C-000003"]);
      assert.deepEqual(await numbers({ status: "hidden,deleted" }), ["BB-B-000002", "BB-D-000004"]);
      assert.deepEqual(await numbers({ restaurant: String(north._id), rating: "2,3" }), ["BB-B-000002"]);
      assert.deepEqual(await numbers({ rating: "4" }), ["BB-A-000001"]);
      assert.deepEqual(await numbers({ restaurantId: String(north._id), reported: "true" }), ["BB-B-000002"]);
      assert.deepEqual(await numbers({ createdFrom: "2026-04-05", createdTo: "2026-04-06" }), ["BB-B-000002"]);
    });

    it("counts orders per option over the other filters", async () => {
      assert.equal((await get(ORDERS)).body.data.facets, undefined);
      const res = await get(ORDERS, { target: "restaurant", facets: "1" });
      assert.deepEqual(listed(res, "orderNumber"), ["BB-A-000001", "BB-B-000002"]);
      assert.deepEqual(counts(res, "target"), { restaurant: 2, food: 1, rider: 1 });
      assert.deepEqual(counts(res, "status"), { published: 1, hidden: 1, removed: 0, deleted: 1 });
      assert.deepEqual(counts(res, "rating"), { 1: 0, 2: 1, 3: 0, 4: 0, 5: 1 });
      assert.deepEqual(res.body.data.facets.restaurant, [
        { value: String(north._id), label: "Aster Kitchen", count: 2 },
      ]);
      const everything = await get(ORDERS, { facets: "1" });
      assert.deepEqual(counts(everything, "rating"), { 1: 1, 2: 1, 3: 0, 4: 1, 5: 1 });
      assert.deepEqual(everything.body.data.facets.restaurant, [
        { value: String(north._id), label: "Aster Kitchen", count: 2 },
        { value: String(south._id), label: "Birch Diner", count: 1 },
      ]);
    });

    it("rejects invalid values with 422", async () => {
      assert.equal(errors(await get(ORDERS, { rating: "6" })).rating, "Invalid value");
      assert.equal(errors(await get(ORDERS, { status: "published,gone" })).status, "Invalid value");
      assert.equal(errors(await get(ORDERS, { target: "menu" })).target, "Invalid value");
      assert.equal(errors(await get(ORDERS, { restaurant: "abc" })).restaurant, "Invalid value");
      assert.ok("createdTo" in errors(await get(ORDERS, { createdFrom: "2026-04-05", createdTo: "2026-04-01" })));
    });
  });
});

