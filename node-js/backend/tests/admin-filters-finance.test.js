// Global filters on the admin finance lists: multi-value filters (OR within one, AND across) and
// facet counts (`facets=1`) on transactions, the refund queue, payout history and the ledger.
// Same cases as backend/apps/finance/tests/test_finance_list_filters.py. Fictional data only.
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { LedgerEntry } from "../models/ledger-entry.model.js";
import { Order, Payment } from "../models/order.model.js";
import { Payout } from "../models/payout.model.js";
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

const sorted = (list) => list.map(String).sort();
const ids = (res) => listed(res, "id");

describe("admin finance list filters and facets", () => {
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

  /** A payment of a new order of `r` (raw inserts, so dates can be set). */
  async function payment(r, { orderStatus = "delivered", method = "cod", provider = "cash_on_delivery", status = "paid", customer, ...extra } = {}) {
    seq += 1;
    const orderId = oid();
    const customerId = customer ?? (await user(`Customer ${seq}`));
    await Order.collection.insertOne({
      _id: orderId,
      orderNumber: `BB-FICT-${String(seq).padStart(6, "0")}`,
      customer: customerId,
      restaurant: r._id,
      restaurantSnapshot: { name: r.name },
      items: [],
      pricing: { totalPaise: 29_250 },
      status: orderStatus,
      paymentMethod: method,
      paymentStatus: status,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const _id = oid();
    await Payment.collection.insertOne({
      _id,
      order: orderId,
      user: customerId,
      method,
      provider,
      amountPaise: 29_250,
      refundedPaise: 0,
      currency: "INR",
      status,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...extra,
    });
    return { id: String(_id), orderNumber: `BB-FICT-${String(seq).padStart(6, "0")}` };
  }

  describe("GET /admin/payments", () => {
    it("filters with several values, counts facets, rejects invalid values", async () => {
      const amber = await restaurant("Amber Spoon");
      const birch = await restaurant("Birch Table");
      const asha = await user("Asha Fictional");
      const a = await payment(amber, { orderStatus: "pending", status: "pending", customer: asha });
      const b = await payment(amber, { method: "online", provider: "razorpay" });
      const c = await payment(birch, { orderStatus: "cancelled", method: "online", provider: "mock" });
      const d = await payment(birch, { orderStatus: "rejected", method: "online", provider: "razorpay", status: "refunded" });
      const found = async (query) => ids(await get("payments", query));

      assert.deepEqual(await found({ status: "pending" }), sorted([a.id]));
      assert.deepEqual(await found({ status: "pending,refunded" }), sorted([a.id, d.id]));
      assert.deepEqual(await found({ method: "online" }), sorted([b.id, c.id, d.id]));
      assert.deepEqual(await found({ provider: "mock,cash_on_delivery" }), sorted([a.id, c.id]));
      assert.deepEqual(await found({ orderState: "cancelled" }), sorted([c.id, d.id]));
      assert.deepEqual(await found({ orderState: "active,delivered" }), sorted([a.id, b.id]));
      assert.deepEqual(await found({ restaurant: String(birch._id) }), sorted([c.id, d.id]));
      assert.deepEqual(await found({ restaurant: `${amber._id},${birch._id}` }), sorted([a.id, b.id, c.id, d.id]));
      assert.deepEqual(await found({ restaurant: String(birch._id), provider: "razorpay" }), [d.id]);
      assert.deepEqual(await found({ method: "online", status: "paid", search: "Asha" }), []);
      assert.deepEqual(await found({ search: "asha fictional" }), [a.id]);

      assert.equal("facets" in (await get("payments")).body.data, false);
      const res = await get("payments", { method: "online", provider: "razorpay", facets: 1, limit: 1 });
      assert.equal(res.status, 200);
      const page = res.body.data;
      assert.equal(page.pagination.total, 2);
      assert.equal(page.items.length, 1);
      assert.deepEqual(Object.keys(page.facets), ["status", "method", "provider", "orderState", "restaurant"]);
      assert.deepEqual(page.facets.status, [
        { value: "pending", count: 0 },
        { value: "paid", count: 1 },
        { value: "failed", count: 0 },
        { value: "refunded", count: 1 },
        { value: "partially_refunded", count: 0 },
        { value: "cancelled", count: 0 },
      ]);
      assert.deepEqual(counts(res, "method"), { cod: 0, online: 2 });
      assert.deepEqual(counts(res, "provider"), { cash_on_delivery: 0, razorpay: 2, mock: 1 });
      assert.deepEqual(counts(res, "orderState"), { active: 0, delivered: 1, cancelled: 1 });
      assert.deepEqual(page.facets.restaurant, [
        { value: String(amber._id), label: "Amber Spoon", count: 1 },
        { value: String(birch._id), label: "Birch Table", count: 1 },
      ]);
      const byAmber = await get("payments", { restaurant: String(amber._id), facets: 1 });
      assert.equal(byAmber.body.data.facets.restaurant.length, 2);
      assert.deepEqual(counts(byAmber, "orderState"), { active: 1, delivered: 1, cancelled: 0 });

      assert.deepEqual(
        errors(
          await get("payments", {
            status: "paid,lost",
            method: "card",
            provider: "x",
            orderState: "gone",
            restaurant: `${amber._id},nope`,
            facets: "maybe",
          }),
        ),
        {
          status: "Invalid value",
          method: "Invalid value",
          provider: "Invalid value",
          orderState: "Invalid value",
          restaurant: "Invalid value",
          facets: "facets must be true or false",
        },
      );
    });
  });

  describe("GET /admin/finance/refunds", () => {
    it("filters with several values, counts facets, rejects invalid values", async () => {
      const amber = await restaurant("Amber Spoon");
      const birch = await restaurant("Birch Table");
      const online = { method: "online", provider: "mock" };
      const needed = await payment(amber, { orderStatus: "cancelled", ...online, updatedAt: at("2026-03-01", 0) });
      const refunded = await payment(amber, { orderStatus: "rejected", status: "refunded", ...online, updatedAt: at("2026-03-02", 23) });
      const partly = await payment(birch, { status: "partially_refunded", ...online, updatedAt: at("2026-03-03", 12) });
      await payment(birch, online); // paid and delivered: not in the queue
      await payment(birch, { orderStatus: "cancelled", status: "cancelled" }); // cash, never paid
      const found = async (query) => ids(await get("finance/refunds", query));

      assert.deepEqual(await found({}), sorted([needed.id, refunded.id, partly.id]));
      assert.deepEqual(await found({ state: "needed" }), [needed.id]);
      assert.deepEqual(await found({ state: "refunded" }), sorted([refunded.id, partly.id]));
      assert.deepEqual(await found({ state: "needed,refunded" }), sorted([needed.id, refunded.id, partly.id]));
      assert.deepEqual(await found({ restaurant: String(birch._id) }), [partly.id]);
      assert.deepEqual(await found({ state: "refunded", restaurant: String(amber._id) }), [refunded.id]);
      assert.deepEqual(await found({ updatedFrom: "2026-03-02", updatedTo: "2026-03-03" }), sorted([refunded.id, partly.id]));
      assert.deepEqual(await found({ updatedTo: "2026-03-01" }), [needed.id]);
      assert.deepEqual(await found({ search: needed.orderNumber }), [needed.id]);

      assert.equal("facets" in (await get("finance/refunds")).body.data, false);
      const res = await get("finance/refunds", { state: "refunded", restaurant: String(amber._id), facets: 1, limit: 1 });
      const page = res.body.data;
      assert.equal(page.pagination.total, 1);
      assert.deepEqual(Object.keys(page.facets), ["state", "restaurant"]);
      assert.deepEqual(page.facets.state, [
        { value: "needed", count: 1 },
        { value: "refunded", count: 1 },
      ]);
      assert.deepEqual(page.facets.restaurant, [
        { value: String(amber._id), label: "Amber Spoon", count: 1 },
        { value: String(birch._id), label: "Birch Table", count: 1 },
      ]);

      assert.deepEqual(errors(await get("finance/refunds", { state: "needed,lost", restaurant: "nope", updatedFrom: "2026-02-30" })), {
        state: "Invalid value",
        restaurant: "Invalid value",
        updatedFrom: "Invalid value",
      });
      assert.deepEqual(errors(await get("finance/refunds", { updatedFrom: "2026-03-04", updatedTo: "2026-03-01" })), {
        updatedTo: "Must be on or after updatedFrom",
      });
    });
  });

  describe("GET /admin/finance/payouts", () => {
    it("filters with several values, counts facets, rejects invalid values", async () => {
      const amber = await restaurant("Amber Spoon");
      const birch = await restaurant("Birch Table");
      const ravi = await user("Ravi Rider", "delivery");
      const mira = await user("Mira Rider", "delivery");
      const by = oid();
      const payout = async (type, payee, r, extra = {}) => {
        const _id = oid();
        await Payout.collection.insertOne({
          _id,
          type,
          payee,
          payeeName: r ? r.name : type,
          restaurant: r?._id,
          orders: 1,
          amountPaise: 10_000,
          status: "pending",
          createdBy: by,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...extra,
        });
        return String(_id);
      };
      const r1 = await payout("restaurant", amber.owner, amber, { createdAt: at("2026-03-01", 0) });
      const r2 = await payout("restaurant", amber.owner, amber, { status: "paid", reference: "UTR-FICT-1" });
      const r3 = await payout("restaurant", birch.owner, birch, { status: "cancelled" });
      const d1 = await payout("rider", ravi, null, { payeeName: "Ravi Rider", createdAt: at("2026-03-02", 23) });
      const d2 = await payout("rider", mira, null, { payeeName: "Mira Rider", status: "paid" });
      const found = async (query) => ids(await get("finance/payouts", query));

      assert.deepEqual(await found({ type: "restaurant" }), sorted([r1, r2, r3]));
      assert.deepEqual(await found({ type: "restaurant,rider" }), sorted([r1, r2, r3, d1, d2]));
      assert.deepEqual(await found({ type: "restaurant", status: "pending,cancelled" }), sorted([r1, r3]));
      assert.deepEqual(await found({ restaurant: String(amber._id) }), sorted([r1, r2]));
      assert.deepEqual(await found({ restaurant: `${amber._id},${birch._id}`, status: "paid" }), [r2]);
      assert.deepEqual(await found({ rider: String(ravi) }), [d1]);
      assert.deepEqual(await found({ rider: `${ravi},${mira}` }), sorted([d1, d2]));
      assert.deepEqual(await found({ rider: String(amber.owner) }), []);
      assert.deepEqual(await found({ createdFrom: "2026-03-01", createdTo: "2026-03-02" }), sorted([r1, d1]));
      assert.deepEqual(await found({ search: "utr-fict" }), [r2]);
      assert.deepEqual(await found({ type: "rider", search: "mira" }), [d2]);

      assert.equal("facets" in (await get("finance/payouts", { type: "restaurant" })).body.data, false);
      const res = await get("finance/payouts", { type: "restaurant", status: "pending,paid", facets: 1, limit: 1 });
      const page = res.body.data;
      assert.equal(page.pagination.total, 2);
      assert.deepEqual(Object.keys(page.facets), ["status", "restaurant", "rider"]);
      assert.deepEqual(page.facets.status, [
        { value: "pending", count: 1 },
        { value: "paid", count: 1 },
        { value: "cancelled", count: 1 },
      ]);
      assert.deepEqual(page.facets.restaurant, [{ value: String(amber._id), label: "Amber Spoon", count: 2 }]);
      assert.deepEqual(page.facets.rider, []);
      const riders = await get("finance/payouts", { type: "rider", rider: String(ravi), facets: 1 });
      assert.deepEqual(riders.body.data.facets.rider, [
        { value: String(mira), label: "Mira Rider", count: 1 },
        { value: String(ravi), label: "Ravi Rider", count: 1 },
      ]);
      assert.deepEqual(counts(riders, "status"), { pending: 1, paid: 0, cancelled: 0 });

      assert.deepEqual(
        errors(await get("finance/payouts", { type: "bank", status: "paid,lost", restaurant: "x", rider: `${oid()},y` })),
        { type: "Invalid value", status: "Invalid value", restaurant: "Invalid value", rider: "Invalid value" },
      );
    });
  });

  describe("GET /admin/finance/ledger", () => {
    it("filters with several values, counts facets, keeps the balances whole", async () => {
      const order = oid();
      const group = async (key, lines, description, createdAt) => {
        const g = String(oid());
        await LedgerEntry.insertMany(
          lines.map(([account, amountPaise]) => ({
            group: g,
            key,
            account,
            amountPaise,
            order: key.startsWith("payout") ? null : order,
            description,
            createdAt,
          })),
        );
      };
      await group(
        `settle:${order}`,
        [["customer_payments", 30_000], ["restaurant_payable", -20_000], ["rider_payable", -10_000]],
        "Order BB-FICT-000001 delivered",
        at("2026-03-01", 0),
      );
      await group("payout:p1", [["restaurant_payable", 20_000], ["payouts", -20_000]], "Payout to Amber Spoon", at("2026-03-02", 23));
      await group("refund:r1", [["customer_payments", -5_000], ["restaurant_payable", 5_000]], "Refund on order BB-FICT-000001", at("2026-03-04", 9));
      const rows = async (query) => {
        const res = await get("finance/ledger", query);
        assert.equal(res.status, 200, JSON.stringify(res.body));
        return res.body.data.items.map((e) => `${e.description}/${e.account}`);
      };

      assert.equal((await rows({})).length, 7);
      assert.equal((await rows({ account: "restaurant_payable" })).length, 3);
      assert.equal((await rows({ account: "payouts,rider_payable" })).length, 2);
      assert.deepEqual((await rows({ event: "payout" })).sort(), [
        "Payout to Amber Spoon/payouts",
        "Payout to Amber Spoon/restaurant_payable",
      ]);
      assert.equal((await rows({ event: "settlement,refund" })).length, 5);
      assert.equal((await rows({ event: "settlement,refund", account: "customer_payments" })).length, 2);
      assert.equal((await rows({ createdFrom: "2026-03-02", createdTo: "2026-03-04" })).length, 4);
      assert.equal((await rows({ search: "amber spoon" })).length, 2);
      assert.equal((await rows({ search: "bb-fict-000001" })).length, 5);

      const plain = (await get("finance/ledger", { account: "payouts" })).body.data;
      assert.equal("facets" in plain, false);
      const balances = Object.fromEntries(plain.accounts.map((a) => [a.account, a.balancePaise]));
      assert.equal(balances.customer_payments, 25_000);
      assert.equal(plain.balanced, true);

      const res = await get("finance/ledger", { account: "restaurant_payable", event: "payout,refund", facets: 1, limit: 1 });
      const page = res.body.data;
      assert.equal(page.pagination.total, 2);
      assert.deepEqual(Object.keys(page.facets), ["account", "event"]);
      assert.deepEqual(page.facets.account, [
        { value: "customer_payments", count: 1 },
        { value: "restaurant_payable", count: 2 },
        { value: "rider_payable", count: 0 },
        { value: "platform_revenue", count: 0 },
        { value: "tax_payable", count: 0 },
        { value: "payouts", count: 1 },
      ]);
      assert.deepEqual(page.facets.event, [
        { value: "settlement", count: 1 },
        { value: "payout", count: 1 },
        { value: "refund", count: 1 },
      ]);

      assert.deepEqual(errors(await get("finance/ledger", { account: "cash", event: "payout,gift", createdTo: "2026-02-30" })), {
        account: "Invalid value",
        event: "Invalid value",
        createdTo: "Invalid value",
      });
    });
  });
});
