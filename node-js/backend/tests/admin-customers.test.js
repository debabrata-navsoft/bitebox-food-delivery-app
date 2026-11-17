// Account management, phase 2: the admin customer list, the customer filters on other admin
// lists (payments, reviews, tickets) and the account help actions (password reset and email
// verification links).
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import mongoose from "mongoose";
import { PERMISSIONS as P } from "../config/permissions.js";
import { env } from "../config/env.js";
import { AuditLog } from "../models/audit-log.model.js";
import { Order, Payment } from "../models/order.model.js";
import { Restaurant } from "../models/restaurant.model.js";
import { Review } from "../models/review.model.js";
import { SupportTicket } from "../models/support-ticket.model.js";
import { User } from "../models/user.model.js";
import { flushAudits } from "../services/audit.service.js";
import { testOutbox } from "../services/mail.service.js";
import { localDay, nextDay, zoneDayStart } from "../utils/dates.js";
import {
  buildApp,
  createAndLogin,
  request,
  resetDb,
  seedCatalogFor,
  setupTestDb,
  teardownTestDb,
} from "./helpers.js";

const auth = (token) => ({ Authorization: `Bearer ${token}` });
const oid = () => new mongoose.Types.ObjectId();
const SECOND = 1000;
const DAY = 86_400_000;
const fields = (res) => res.body.error.details.map((e) => e.field);

describe("admin customers", () => {
  let app;
  let admin;
  let rider;
  let restaurantId;

  before(async () => {
    await setupTestDb();
    app = buildApp();
  });
  after(teardownTestDb);

  beforeEach(async () => {
    await resetDb();
    await seedCatalogFor(app);
    admin = await createAndLogin(app, "admin");
    rider = await createAndLogin(app, "delivery");
    // Only the customers each test inserts.
    await User.deleteMany({ role: "customer" });
    restaurantId = (await Restaurant.findOne().select("_id"))._id;
  });

  /** Inserts a customer directly (any createdAt); returns its id. */
  let seq = 0;
  async function customer(fields = {}) {
    const _id = oid();
    const createdAt = fields.createdAt ?? new Date(Date.now() - DAY);
    seq += 1;
    await User.collection.insertOne({
      _id,
      name: `Customer ${seq}`,
      email: `customer${seq}.${_id}@example.test`,
      passwordHash: "x",
      role: "customer",
      status: "active",
      tokenVersion: 0,
      updatedAt: createdAt,
      ...fields,
      createdAt,
    });
    return _id;
  }

  /** Raw orders: [status, totalPaise, createdAt]. */
  async function orders(customerId, rows) {
    await Order.collection.insertMany(
      rows.map(([status, totalPaise, createdAt = new Date()]) => ({
        orderNumber: `BB-T-${oid()}`,
        customer: customerId,
        restaurant: restaurantId,
        restaurantSnapshot: { name: "Copper Kettle" },
        status,
        pricing: { totalPaise },
        createdAt,
        updatedAt: createdAt,
      })),
    );
  }

  const list = (query = {}, token = admin.token) =>
    request(app).get("/api/v1/admin/customers").query(query).set(auth(token));
  const ids = (res) => res.body.data.items.map((u) => u.id);

  async function operatorWith(permissions) {
    const op = await createAndLogin(app, "operator");
    await User.updateOne({ _id: op.user.id }, { customPermissions: permissions });
    return op;
  }

  describe("GET /admin/customers", () => {
    it("lists customers only, newest first, with their order figures", async () => {
      const older = await customer({ name: "Orla Fenwick", createdAt: new Date(Date.now() - 3 * DAY) });
      const newer = await customer({ name: "Tamsin Vale", createdAt: new Date(Date.now() - DAY) });
      const last = new Date(Date.now() - 2 * 3600 * SECOND);
      await orders(older, [
        ["delivered", 45_000, new Date(Date.now() - 2 * DAY)],
        ["delivered", 15_000, new Date(Date.now() - DAY)],
        ["cancelled", 99_000, last],
        ["placed", 20_000, new Date(Date.now() - 3 * 3600 * SECOND)],
      ]);

      const res = await list();
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.deepEqual(ids(res), [String(newer), String(older)]);
      const [n, o] = res.body.data.items;
      assert.equal(o.name, "Orla Fenwick");
      assert.equal(o.role, "customer");
      assert.equal(o.passwordHash, undefined);
      assert.deepEqual(o.stats, { orders: 4, spentPaise: 60_000, lastOrderAt: last.toISOString() });
      assert.deepEqual(n.stats, { orders: 0, spentPaise: 0, lastOrderAt: null });
      assert.deepEqual(res.body.data.pagination, { page: 1, limit: 20, total: 2, totalPages: 1 });
    });

    it("pages", async () => {
      for (let i = 0; i < 5; i++) await customer({ createdAt: new Date(Date.now() - (i + 1) * DAY) });
      const first = await list({ limit: 2 });
      const third = await list({ limit: 2, page: 3 });
      assert.equal(first.body.data.items.length, 2);
      assert.deepEqual(first.body.data.pagination, { page: 1, limit: 2, total: 5, totalPages: 3 });
      assert.equal(third.body.data.items.length, 1);
      assert.equal((await list({ limit: 101 })).status, 422);
      assert.equal((await list({ page: 0 })).status, 422);
    });

    it("searches name, email, phone in any form and the id or its tail", async () => {
      const a = await customer({ name: "Brisa Quell", email: "brisa.q@example.test", phone: "9000011111" });
      const b = await customer({ name: "Dorian Ashby", email: "dash@example.test", phone: "+919000022222" });
      const search = async (s) => ids(await list({ search: s }));
      assert.deepEqual(await search("bRiSa"), [String(a)]);
      assert.deepEqual(await search("DASH@EXAMPLE"), [String(b)]);
      assert.deepEqual(await search("90000111"), [String(a)]);
      assert.deepEqual(await search("+91 90000 11111"), [String(a)], "stored without +91");
      assert.deepEqual(await search("9000022222"), [String(b)], "stored with +91");
      const tail = String(b).slice(-8).toUpperCase();
      assert.deepEqual(await search(`#${tail}`), [String(b)], "as shown in the app");
      assert.deepEqual(await search(String(b).slice(-6)), [String(b)]);
      assert.deepEqual(await search(String(a)), [String(a)], "full id");
      assert.deepEqual(await search("zzz-nobody"), []);
      assert.equal((await list({ search: "x".repeat(101) })).status, 422);
    });

    it("filters by status and verification", async () => {
      const verified = await customer({ emailVerifiedAt: new Date(), phone: "9000033333" });
      const phoneOk = await customer({ phone: "9000044444", phoneVerifiedAt: new Date() });
      const blocked = await customer({ status: "blocked" });
      const sorted = async (q) => ids(await list(q)).sort();
      assert.deepEqual(await sorted({ status: "blocked" }), [String(blocked)]);
      assert.deepEqual(await sorted({ status: "active" }), [String(verified), String(phoneOk)].sort());
      assert.deepEqual(await sorted({ verification: "email_verified" }), [String(verified)]);
      assert.deepEqual(await sorted({ verification: "email_unverified" }), [String(phoneOk), String(blocked)].sort());
      assert.deepEqual(await sorted({ verification: "phone_verified" }), [String(phoneOk)]);
      assert.deepEqual(await sorted({ verification: "phone_unverified" }), [String(verified), String(blocked)].sort());
      const bad = await list({ verification: "verified", status: "gone" });
      assert.equal(bad.status, 422);
      assert.deepEqual(fields(bad).sort(), ["status", "verification"]);
    });

    it("filters by sign-up day, inclusive, in the report time zone", async () => {
      const tz = env.reportTimezone;
      const day = "2026-03-10";
      const start = zoneDayStart(day, tz);
      const end = zoneDayStart(nextDay(day), tz);
      // The edges really are the local midnights (checked with the existing formatter).
      assert.equal(localDay(start, tz), day);
      assert.equal(localDay(new Date(start - SECOND), tz), "2026-03-09");
      assert.equal(localDay(new Date(end - SECOND), tz), day);
      assert.equal(localDay(end, tz), "2026-03-11");

      const before = await customer({ createdAt: new Date(start - SECOND) });
      const first = await customer({ createdAt: start });
      const lastSecond = await customer({ createdAt: new Date(end - SECOND) });
      const afterDay = await customer({ createdAt: end });
      const sorted = async (q) => ids(await list(q)).sort();

      assert.deepEqual(await sorted({ joinedFrom: day, joinedTo: day }), [String(first), String(lastSecond)].sort());
      assert.deepEqual(await sorted({ joinedFrom: day }), [String(first), String(lastSecond), String(afterDay)].sort());
      assert.deepEqual(await sorted({ joinedTo: day }), [String(before), String(first), String(lastSecond)].sort());

      const reversed = await list({ joinedFrom: "2026-03-11", joinedTo: day });
      assert.equal(reversed.status, 422);
      assert.deepEqual(reversed.body.error.details.map((e) => e.field), ["joinedTo"]);
      const invalid = await list({ joinedFrom: "2026-02-30" });
      assert.equal(invalid.status, 422);
      assert.deepEqual(invalid.body.error.details.map((e) => e.field), ["joinedFrom"]);
    });

    it("sorts by name, age, orders and spend (ties newest first)", async () => {
      const t = (days) => new Date(Date.now() - days * DAY);
      const ana = await customer({ name: "ana Prell", createdAt: t(4) });
      const bo = await customer({ name: "Bo Lindqvist", createdAt: t(3) });
      const cy = await customer({ name: "Cy Ormond", createdAt: t(2) });
      const dee = await customer({ name: "Dee Harrow", createdAt: t(1) });
      await orders(ana, [["delivered", 10_000], ["delivered", 10_000], ["cancelled", 5_000]]);
      await orders(bo, [["delivered", 90_000]]);
      await orders(cy, [["placed", 70_000], ["delivered", 20_000], ["rejected", 1_000]]);
      const sorted = async (sort) => ids(await list({ sort }));

      assert.deepEqual(await sorted("newest"), [dee, cy, bo, ana].map(String));
      assert.deepEqual(await sorted(undefined), [dee, cy, bo, ana].map(String));
      assert.deepEqual(await sorted("oldest"), [ana, bo, cy, dee].map(String));
      assert.deepEqual(await sorted("name"), [ana, bo, cy, dee].map(String), "case-insensitive A to Z");
      // ana and cy both have 3 orders: cy is newer.
      assert.deepEqual(await sorted("orders"), [cy, ana, bo, dee].map(String));
      // spent: bo 90000, ana 20000, cy 20000 (cy newer), dee 0.
      assert.deepEqual(await sorted("spent"), [bo, cy, ana, dee].map(String));
      // Sorted in the database, so paging follows the sort.
      const page2 = await list({ sort: "spent", limit: 2, page: 2 });
      assert.deepEqual(ids(page2), [ana, dee].map(String));
      assert.deepEqual(page2.body.data.items[0].stats.spentPaise, 20_000);
      assert.equal((await list({ sort: "rating" })).status, 422);
    });

    it("needs customers:view", async () => {
      const none = await operatorWith([P.RIDERS_VIEW]);
      assert.equal((await list({}, none.token)).status, 403);
      const viewer = await operatorWith([P.CUSTOMERS_VIEW]);
      const id = await customer();
      const res = await list({}, viewer.token);
      assert.equal(res.status, 200);
      assert.ok(ids(res).includes(String(id)));
      assert.ok(res.body.data.items.every((u) => u.role === "customer"));
      assert.equal((await list({}, rider.token)).status, 403);
    });
  });

  describe("customer filters on other admin lists", () => {
    it("payments of one customer's orders", async () => {
      const mine = await customer();
      const other = await customer();
      const order = async (who) => {
        const _id = oid();
        await Order.collection.insertOne({ _id, orderNumber: `BB-P-${_id}`, customer: who, status: "delivered" });
        const [p] = await Payment.collection
          .insertOne({ order: _id, user: who, method: "cod", provider: "cash_on_delivery", amountPaise: 100, status: "pending", createdAt: new Date() })
          .then((r) => [r.insertedId]);
        return p;
      };
      const p1 = await order(mine);
      await order(other);
      const res = await request(app)
        .get("/api/v1/admin/payments")
        .query({ customer: String(mine) })
        .set(auth(admin.token));
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.deepEqual(res.body.data.items.map((p) => p.id), [String(p1)]);
      const bad = await request(app).get("/api/v1/admin/payments?customer=nope").set(auth(admin.token));
      assert.equal(bad.status, 422);
      assert.deepEqual(bad.body.error.details.map((e) => e.field), ["customer"]);
    });

    it("reviewed orders of one customer", async () => {
      const mine = await customer({ name: "Wren Halloway" });
      const other = await customer({ name: "Ivo Marsh" });
      const reviewOf = async (who, name) => {
        const order = oid();
        await Review.collection.insertOne({
          target: "restaurant",
          customer: who,
          customerName: name,
          order,
          orderNumber: `BB-R-${order}`,
          restaurant: restaurantId,
          rating: 4,
          comment: "",
          status: "published",
          openReports: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        return order;
      };
      const reviewed = await reviewOf(mine, "Wren Halloway");
      await reviewOf(other, "Ivo Marsh");
      const res = await request(app)
        .get("/api/v1/admin/reviews/orders")
        .query({ customer: String(mine) })
        .set(auth(admin.token));
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.deepEqual(res.body.data.items.map((o) => o.order), [String(reviewed)]);
      const bad = await request(app).get("/api/v1/admin/reviews/orders?customer=1").set(auth(admin.token));
      assert.equal(bad.status, 422);
      assert.deepEqual(bad.body.error.details.map((e) => e.field), ["customer"]);
    });

    it("tickets one person raised", async () => {
      const mine = await customer({ name: "Pell Garrow" });
      const other = await customer({ name: "Juno Sable" });
      const ticket = (who, name, n) =>
        SupportTicket.create({
          number: `T-${n}`,
          raisedBy: who,
          requesterRole: "customer",
          requesterName: name,
          type: "other",
          subject: "Question about my account",
        });
      const t1 = await ticket(mine, "Pell Garrow", 1);
      await ticket(other, "Juno Sable", 2);
      const res = await request(app)
        .get("/api/v1/admin/support/tickets")
        .query({ requester: String(mine) })
        .set(auth(admin.token));
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.deepEqual(res.body.data.items.map((t) => t.id), [String(t1._id)]);
      const bad = await request(app).get("/api/v1/admin/support/tickets?requester=abc").set(auth(admin.token));
      assert.equal(bad.status, 422);
      assert.deepEqual(bad.body.error.details.map((e) => e.field), ["requester"]);
    });

    it("coin transactions keep the userId filter name", async () => {
      const bad = await request(app).get("/api/v1/admin/rewards/transactions?userId=abc").set(auth(admin.token));
      assert.equal(bad.status, 422);
      assert.deepEqual(bad.body.error.details.map((e) => e.field), ["userId"]);
    });
  });

  describe("account help", () => {
    const help = (id, action, token = admin.token) =>
      request(app).post(`/api/v1/admin/customers/${id}/${action}`).set(auth(token));
    const mails = (prefix) => testOutbox.filter((m) => m.subject.startsWith(prefix));
    const tokenIn = (mail) => new URL(mail.text.match(/https?:\/\/\S+/)[0]).searchParams.get("token");
    const audits = async (action) => {
      await flushAudits();
      return AuditLog.find({ action }).lean();
    };

    it("sends the forgot-password email, whose link resets the password", async () => {
      const id = await customer({ name: "Liora Quint", email: "liora.quint@example.test" });
      const res = await help(id, "password-reset");
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.equal(res.body.message, "Password reset link sent");
      assert.equal(res.body.data, null);

      // The same email as forgot-password.
      const [adminSent] = mails("Reset your");
      assert.equal(adminSent.to, "liora.quint@example.test");
      await request(app).post("/api/v1/auth/forgot-password").send({ email: "liora.quint@example.test" });
      const [, selfSent] = mails("Reset your");
      const strip = (m) => m.text.replace(/token=\S+/, "");
      assert.equal(strip(adminSent), strip(selfSent));
      assert.equal(adminSent.subject, selfSent.subject);

      const reset = await request(app)
        .post("/api/v1/auth/reset-password")
        .send({ token: tokenIn(selfSent), password: "Fresh-pass-42" });
      assert.equal(reset.status, 200, JSON.stringify(reset.body));
      const login = await request(app)
        .post("/api/v1/auth/login")
        .send({ email: "liora.quint@example.test", password: "Fresh-pass-42" });
      assert.equal(login.status, 200);

      const [row] = await audits("customer.password_reset");
      assert.equal(row.description, "Sent a password reset link");
      assert.equal(row.resourceType, "user");
      assert.equal(String(row.resourceId), String(id));
      assert.equal(row.accountType, "customer");
    });

    it("the admin's link works with the reset endpoint", async () => {
      const id = await customer({ email: "rhea.tallis@example.test" });
      await help(id, "password-reset");
      const reset = await request(app)
        .post("/api/v1/auth/reset-password")
        .send({ token: tokenIn(mails("Reset your").at(-1)), password: "Fresh-pass-42" });
      assert.equal(reset.status, 200, JSON.stringify(reset.body));
    });

    it("refuses inactive accounts, non-customers and a second link within a minute", async () => {
      for (const status of ["inactive", "suspended", "blocked"]) {
        const res = await help(await customer({ status }), "password-reset");
        assert.equal(res.status, 409);
        assert.equal(res.body.message, "The account is not active");
      }
      assert.equal(mails("Reset your").length, 0);

      const notCustomer = await help(rider.user.id, "password-reset");
      assert.equal(notCustomer.status, 404);
      assert.equal(notCustomer.body.message, "Customer not found");
      assert.equal((await help(oid(), "email-verification")).status, 404);
      assert.equal((await help(admin.user.id, "email-verification")).status, 404);
      assert.equal((await help("nope", "password-reset")).status, 422);

      const id = await customer();
      assert.equal((await help(id, "password-reset")).status, 200);
      const again = await help(id, "password-reset");
      assert.equal(again.status, 429);
      assert.equal(mails("Reset your").length, 1);
      // A minute later it may go again.
      await User.collection.updateOne(
        { _id: id },
        [{ $set: { passwordResetExpiresAt: { $subtract: ["$passwordResetExpiresAt", 61 * SECOND] } } }],
      );
      assert.equal((await help(id, "password-reset")).status, 200);
      assert.equal((await audits("customer.password_reset")).length, 2, "refusals are not audited");
    });

    it("sends the email verification link, once a minute, and not when verified", async () => {
      const id = await customer({ email: "esme.varga@example.test" });
      const res = await help(id, "email-verification");
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.equal(res.body.message, "Verification email sent");
      assert.equal(res.body.data, null);
      const [mail] = mails("Confirm your BiteBox email");
      assert.equal(mail.to, "esme.varga@example.test");

      assert.equal((await help(id, "email-verification")).status, 429);
      assert.equal(mails("Confirm your BiteBox email").length, 1);

      const verify = await request(app).post("/api/v1/auth/email/verify").send({ token: tokenIn(mail) });
      assert.equal(verify.status, 200, JSON.stringify(verify.body));
      const done = await help(id, "email-verification");
      assert.equal(done.status, 409);
      assert.equal(done.body.message, "The email is already verified");

      const [row] = await audits("customer.email_verification");
      assert.equal(row.description, "Sent an email verification link");
      assert.equal(row.accountType, "customer");
      assert.equal((await audits("customer.email_verification")).length, 1);
    });

    it("needs customers:edit", async () => {
      const id = await customer();
      const viewer = await operatorWith([P.CUSTOMERS_VIEW]);
      assert.equal((await help(id, "password-reset", viewer.token)).status, 403);
      assert.equal((await help(id, "email-verification", viewer.token)).status, 403);
      const editor = await operatorWith([P.CUSTOMERS_VIEW, P.CUSTOMERS_EDIT]);
      assert.equal((await help(id, "password-reset", editor.token)).status, 200);
      assert.equal((await help(id, "email-verification", editor.token)).status, 200);
      const support = await createAndLogin(app, "support_admin");
      assert.equal((await help(await customer(), "password-reset", support.token)).status, 200);
    });
  });
});
