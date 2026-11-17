// Account management, phase 3: restaurant accounts (list, account view, admin edit, status and
// closing for orders) and the restaurant filters on other admin lists.
import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import mongoose from "mongoose";
import { env } from "../config/env.js";
import { PERMISSIONS as P } from "../config/permissions.js";
import { AuditLog } from "../models/audit-log.model.js";
import { CommissionRule } from "../models/commission-rule.model.js";
import { Coupon } from "../models/coupon.model.js";
import { FoodItem } from "../models/food-item.model.js";
import { KycDocument, PayoutAccount } from "../models/kyc-document.model.js";
import { Order } from "../models/order.model.js";
import { Payout } from "../models/payout.model.js";
import { Restaurant } from "../models/restaurant.model.js";
import { Review } from "../models/review.model.js";
import { User } from "../models/user.model.js";
import { flushAudits } from "../services/audit.service.js";
import { useRestaurantKyc } from "../services/restaurant.service.js";
import { nextDay, zoneDayStart } from "../utils/dates.js";
import { buildApp, createAndLogin, request, resetDb, setupTestDb, teardownTestDb } from "./helpers.js";

const auth = (token) => ({ Authorization: `Bearer ${token}` });
const oid = () => new mongoose.Types.ObjectId();
const DAY = 86_400_000;
const fields = (res) => res.body.error.details.map((e) => e.field);
const BASE = "/api/v1/admin/restaurant-accounts";
const ALL_DOCS = { fssai_licence: "approved", pan_card: "approved", cancelled_cheque: "approved" };

describe("admin restaurant accounts", () => {
  let app;
  let admin;

  before(async () => {
    await setupTestDb();
    app = buildApp();
  });
  after(teardownTestDb);

  beforeEach(async () => {
    await resetDb();
    admin = await createAndLogin(app, "admin");
  });
  afterEach(() => useRestaurantKyc(null));

  let seq = 0;
  /** A restaurant and its owner, inserted directly. Returns { id, ownerId }. */
  async function restaurant(fields = {}, owner = {}) {
    seq += 1;
    const ownerId = oid();
    const createdAt = fields.createdAt ?? new Date(Date.now() - DAY);
    await User.collection.insertOne({
      _id: ownerId,
      name: `Owner ${seq}`,
      email: `owner${seq}.${ownerId}@example.test`,
      passwordHash: "x",
      role: "restaurant",
      status: "active",
      tokenVersion: 0,
      createdAt,
      updatedAt: createdAt,
      ...owner,
    });
    const r = await Restaurant.create({
      owner: ownerId,
      name: `Kitchen ${seq}`,
      slug: `kitchen-${seq}-${ownerId}`,
      cuisines: ["Thali"],
      phone: "9000000000",
      address: { line1: "12 Lantern Row", city: "Westford", state: "Avalon", postalCode: "560001" },
      location: { type: "Point", coordinates: [77.6, 12.9] },
      costForTwoPaise: 40_000,
      openingTime: "09:00",
      closingTime: "22:00",
      status: "approved",
      ...fields,
    });
    await Restaurant.collection.updateOne({ _id: r._id }, { $set: { createdAt } });
    return { id: String(r._id), ownerId: String(ownerId) };
  }

  /** The owner's documents ({ kind: status }) and, unless `account: false`, a bank account. */
  async function kyc(ownerId, docs = ALL_DOCS, { account = true } = {}) {
    for (const [kind, status] of Object.entries(docs))
      await KycDocument.create({ user: ownerId, kind, fileName: `${oid()}.pdf`, contentType: "application/pdf", size: 10, status });
    if (account)
      await PayoutAccount.create({
        user: ownerId,
        holderName: "Fictional Foods",
        accountNumberEncrypted: "x",
        accountLast4: "1234",
        ifsc: "FAKE0001234",
      });
  }

  async function orders(restaurantId, rows) {
    await Order.collection.insertMany(
      rows.map(([status, totalPaise, createdAt = new Date()]) => ({
        orderNumber: `BB-T-${oid()}`,
        customer: oid(),
        restaurant: new mongoose.Types.ObjectId(restaurantId),
        restaurantSnapshot: { name: "Fictional" },
        status,
        pricing: { totalPaise },
        createdAt,
        updatedAt: createdAt,
      })),
    );
  }

  const list = (query = {}, token = admin.token) => request(app).get(BASE).query(query).set(auth(token));
  const ids = (res) => res.body.data.items.map((r) => r.id);

  async function operatorWith(permissions) {
    const op = await createAndLogin(app, "operator");
    await User.updateOne({ _id: op.user.id }, { customPermissions: permissions });
    return op;
  }

  describe("GET /admin/restaurant-accounts", () => {
    it("lists restaurants newest first with owner, stats, commission and KYC state", async () => {
      const old = await restaurant(
        { name: "Saffron Lantern", imageUrl: "https://img.example.test/s.jpg", rating: { average: 4.5, count: 8 } },
        { name: "Mira Quell", phone: "9000011111" },
      );
      const fresh = await restaurant({ createdAt: new Date(Date.now() - 3600_000) });
      await orders(old.id, [["delivered", 50_000], ["cancelled", 9_000], ["placed", 1_000]]);
      await CommissionRule.create({ restaurant: old.id, basisPoints: 1750, effectiveFrom: new Date() });
      await kyc(old.ownerId);

      const res = await list();
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.deepEqual(ids(res), [fresh.id, old.id]);
      const item = res.body.data.items[1];
      assert.deepEqual(Object.keys(item).sort(), [
        "city", "commissionPercent", "createdAt", "id", "imageUrl", "isAcceptingOrders", "kycStatus",
        "name", "owner", "slug", "stats", "status", "statusReason",
      ]);
      assert.equal(item.name, "Saffron Lantern");
      assert.equal(item.city, "Westford");
      assert.equal(item.statusReason, null);
      assert.deepEqual(item.owner, {
        id: old.ownerId, name: "Mira Quell", email: item.owner.email, phone: "9000011111", status: "active", avatarUrl: null,
      });
      assert.deepEqual(item.stats, { orders: 3, rating: { average: 4.5, count: 8 } });
      assert.equal(item.commissionPercent, 17.5);
      assert.equal(item.kycStatus, "verified");
      const other = res.body.data.items[0];
      assert.equal(other.commissionPercent, 15);
      assert.equal(other.kycStatus, "incomplete");
      assert.deepEqual(other.stats.orders, 0);
      assert.deepEqual(res.body.data.pagination, { page: 1, limit: 20, total: 2, totalPages: 1 });
    });

    it("filters by status, owner account status and city", async () => {
      const a = await restaurant({ status: "pending", address: { line1: "1 Elm Way", city: "North Fen", state: "Avalon", postalCode: "560002" } });
      const b = await restaurant({}, { status: "suspended" });
      await restaurant({ status: "rejected" });
      assert.deepEqual(ids(await list({ status: "pending" })), [a.id]);
      assert.deepEqual(ids(await list({ accountStatus: "suspended" })), [b.id]);
      assert.deepEqual(ids(await list({ city: "north fen" })), [a.id]);
      assert.deepEqual(ids(await list({ city: "North" })), []);
    });

    it("filters by KYC state", async () => {
      const verified = await restaurant();
      await kyc(verified.ownerId);
      const pending = await restaurant();
      await kyc(pending.ownerId, { ...ALL_DOCS, pan_card: "pending" });
      const rejected = await restaurant();
      await kyc(rejected.ownerId, { fssai_licence: "rejected" }); // also incomplete: rejected wins
      const noAccount = await restaurant();
      await kyc(noAccount.ownerId, ALL_DOCS, { account: false });
      const gstMissing = await restaurant({ gstRegistered: true, gstin: "29ABCDE1234F1Z5" });
      await kyc(gstMissing.ownerId);
      const nothing = await restaurant();

      const kycOf = async (state) => new Set(ids(await list({ kyc: state })));
      assert.deepEqual(await kycOf("verified"), new Set([verified.id]));
      assert.deepEqual(await kycOf("pending"), new Set([pending.id]));
      assert.deepEqual(await kycOf("rejected"), new Set([rejected.id]));
      assert.deepEqual(await kycOf("incomplete"), new Set([noAccount.id, gstMissing.id, nothing.id]));
    });

    it("searches name, slug, owner name, email, phone in any form and the id or its tail", async () => {
      const a = await restaurant({ name: "Copper Ladle", slug: "copper-ladle-hq" }, { name: "Tobin Ashgrove", email: "tobin.a@example.test", phone: "9000022222" });
      const b = await restaurant({ name: "Juniper Pot" }, { phone: "+919000033333" });
      const find = async (search) => ids(await list({ search }));
      assert.deepEqual(await find("copper"), [a.id]);
      assert.deepEqual(await find("ladle-hq"), [a.id]);
      assert.deepEqual(await find("ashgrove"), [a.id]);
      assert.deepEqual(await find("TOBIN.A@"), [a.id]);
      assert.deepEqual(await find("+91 90000 22222"), [a.id]);
      assert.deepEqual(await find("9000033333"), [b.id]);
      assert.deepEqual(await find(b.id), [b.id]);
      assert.deepEqual(await find(`#${b.id.slice(-8).toUpperCase()}`), [b.id]);
      assert.deepEqual(await find("nothing-like-this"), []);
    });

    it("filters by joined days in the report time zone, inclusive", async () => {
      const tz = env.reportTimezone;
      const day = "2026-03-10";
      const start = zoneDayStart(day, tz);
      const end = zoneDayStart(nextDay(day), tz);
      const first = await restaurant({ createdAt: start });
      const last = await restaurant({ createdAt: new Date(end.getTime() - 1) });
      await restaurant({ createdAt: new Date(start.getTime() - 1) });
      await restaurant({ createdAt: end });
      assert.deepEqual(new Set(ids(await list({ joinedFrom: day, joinedTo: day }))), new Set([first.id, last.id]));
      assert.equal((await list({ joinedFrom: nextDay(day) })).body.data.items.length, 1);
      const bad = await list({ joinedFrom: "2026-03-11", joinedTo: "2026-03-10" });
      assert.equal(bad.status, 422);
      assert.deepEqual(fields(bad), ["joinedTo"]);
    });

    it("sorts by orders, rating, name and oldest (ties newest first)", async () => {
      const a = await restaurant({ name: "banyan", rating: { average: 4, count: 10 }, createdAt: new Date(Date.now() - 3 * DAY) });
      const b = await restaurant({ name: "Acacia", rating: { average: 4.8, count: 2 }, createdAt: new Date(Date.now() - 2 * DAY) });
      const c = await restaurant({ name: "Cedar", rating: { average: 4, count: 30 }, createdAt: new Date(Date.now() - DAY) });
      await orders(a.id, [["delivered", 1], ["delivered", 1]]);
      await orders(b.id, [["placed", 1]]);
      assert.deepEqual(ids(await list({ sort: "orders" })), [a.id, b.id, c.id]);
      assert.deepEqual(ids(await list({ sort: "orders", limit: 1, page: 2 })), [b.id]);
      assert.deepEqual(ids(await list({ sort: "rating" })), [b.id, c.id, a.id]);
      assert.deepEqual(ids(await list({ sort: "name" })), [b.id, a.id, c.id]);
      assert.deepEqual(ids(await list({ sort: "oldest" })), [a.id, b.id, c.id]);
    });

    it("pages and rejects invalid values", async () => {
      for (let i = 0; i < 3; i++) await restaurant({ createdAt: new Date(Date.now() - (i + 1) * DAY) });
      const page = await list({ limit: 2, page: 2 });
      assert.equal(page.body.data.items.length, 1);
      assert.deepEqual(page.body.data.pagination, { page: 2, limit: 2, total: 3, totalPages: 2 });
      for (const [key, value] of [["status", "open"], ["accountStatus", "x"], ["kyc", "done"], ["sort", "best"], ["limit", "101"], ["joinedFrom", "2026-02-30"]]) {
        const res = await list({ [key]: value });
        assert.equal(res.status, 422, key);
        assert.deepEqual(res.body.error.details, [{ field: key, message: "Invalid value" }]);
      }
      // Unknown parameters are dropped.
      assert.equal((await list({ colour: "blue" })).status, 200);
    });

    it("needs restaurants:view", async () => {
      const op = await operatorWith([P.CUSTOMERS_VIEW, P.RESTAURANTS_MANAGE]);
      assert.equal((await list({}, op.token)).status, 403);
      const viewer = await operatorWith([P.RESTAURANTS_VIEW]);
      assert.equal((await list({}, viewer.token)).status, 200);
    });

    it("lists distinct cities A to Z", async () => {
      const at = (city) => ({ address: { line1: "3 Quay St", city, state: "Avalon", postalCode: "560003" } });
      await restaurant(at("westford"));
      await restaurant(at("Westford"));
      await restaurant(at("  Ashby "));
      await restaurant(at("Marlow"));
      const res = await request(app).get(`${BASE}/cities`).set(auth(admin.token));
      assert.equal(res.status, 200);
      assert.deepEqual(res.body.data.cities, ["Ashby", "Marlow", "Westford"]);
    });
  });

  describe("GET /admin/restaurant-accounts/:id", () => {
    it("shows the restaurant, owner, order figures, commission and KYC", async () => {
      const r = await restaurant({ rating: { average: 4.2, count: 5 } }, { name: "Edda Morrow" });
      const last = new Date(Date.now() - 3600_000);
      await orders(r.id, [
        ["delivered", 30_000, new Date(Date.now() - DAY)],
        ["delivered", 20_000, new Date(Date.now() - 2 * DAY)],
        ["cancelled", 5_000, new Date(Date.now() - 3 * DAY)],
        ["rejected", 7_000, last],
        ["preparing", 4_000, new Date(Date.now() - 2 * 3600_000)],
      ]);
      await kyc(r.ownerId, { fssai_licence: "approved", pan_card: "pending" });

      const res = await request(app).get(`${BASE}/${r.id}`).set(auth(admin.token));
      assert.equal(res.status, 200, JSON.stringify(res.body));
      const d = res.body.data;
      const partner = (await Restaurant.findById(r.id)).toJSON();
      assert.deepEqual(Object.keys(d.restaurant).sort(), Object.keys(partner).concat(["statusReason", "reviewedAt"]).sort());
      assert.equal(d.restaurant.id, r.id);
      assert.equal(d.restaurant.owner, r.ownerId);
      assert.equal(d.restaurant.statusReason, null);
      assert.equal(d.restaurant.reviewedAt, null);
      assert.equal(d.owner.id, r.ownerId);
      assert.equal(d.owner.name, "Edda Morrow");
      assert.equal(d.owner.passwordHash, undefined);
      assert.deepEqual(d.stats, {
        orders: 5, delivered: 2, cancelled: 2, grossPaise: 50_000, lastOrderAt: last.toISOString(),
        rating: { average: 4.2, count: 5 },
      });
      assert.deepEqual(d.commission, { percent: 15, source: "default" });
      assert.deepEqual(d.kyc, { status: "incomplete", missing: ["cancelled_cheque"] });
    });

    it("commission source: global rule, then the restaurant's own", async () => {
      const r = await restaurant();
      const get = async () => (await request(app).get(`${BASE}/${r.id}`).set(auth(admin.token))).body.data.commission;
      await CommissionRule.create({ restaurant: null, basisPoints: 1800, effectiveFrom: new Date() });
      assert.deepEqual(await get(), { percent: 18, source: "default" });
      await CommissionRule.create({ restaurant: r.id, basisPoints: 1250, effectiveFrom: new Date() });
      assert.deepEqual(await get(), { percent: 12.5, source: "restaurant" });
    });

    it("KYC: pending, rejected, verified and the GST certificate for GST-registered", async () => {
      const kycOf = async (id) => (await request(app).get(`${BASE}/${id}`).set(auth(admin.token))).body.data.kyc;
      const p = await restaurant();
      await kyc(p.ownerId, { ...ALL_DOCS, cancelled_cheque: "pending" });
      assert.deepEqual(await kycOf(p.id), { status: "pending", missing: [] });
      const x = await restaurant();
      await kyc(x.ownerId, { ...ALL_DOCS, pan_card: "rejected" });
      assert.deepEqual(await kycOf(x.id), { status: "rejected", missing: [] });
      const v = await restaurant();
      await kyc(v.ownerId);
      assert.deepEqual(await kycOf(v.id), { status: "verified", missing: [] });
      await Restaurant.updateOne({ _id: v.id }, { gstRegistered: true });
      assert.deepEqual(await kycOf(v.id), { status: "incomplete", missing: ["gst_certificate"] });
    });

    it("404 for an unknown restaurant, 422 for a malformed id", async () => {
      const missing = await request(app).get(`${BASE}/${oid()}`).set(auth(admin.token));
      assert.equal(missing.status, 404);
      assert.equal(missing.body.message, "Restaurant not found");
      assert.equal((await request(app).get(`${BASE}/nope`).set(auth(admin.token))).status, 422);
    });
  });

  describe("PATCH /admin/restaurant-accounts/:id", () => {
    const patch = (id, body, token = admin.token) => request(app).patch(`${BASE}/${id}`).set(auth(token)).send(body);

    it("edits the partner's details and records what changed", async () => {
      const r = await restaurant({ status: "rejected", statusReason: "Blurry photos" });
      const res = await patch(r.id, {
        name: "Willow Hearth",
        ownerName: "Rafe Tolland",
        address: { line1: "9 Mill Lane", city: "Eastvale", state: "Avalon", postalCode: "560009" },
        status: "approved",
        commissionPercent: 2,
        ownerEmail: "someone@example.test",
        email: "kitchen@example.test",
      });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.equal(res.body.message, "Restaurant updated");
      const out = res.body.data.restaurant;
      assert.equal(out.name, "Willow Hearth");
      assert.match(out.slug, /^willow-hearth/);
      assert.equal(out.ownerName, "Rafe Tolland");
      assert.equal(out.status, "rejected"); // the approval status never changes here
      assert.equal(out.statusReason, "Blurry photos");
      const owner = await User.findById(r.ownerId);
      assert.notEqual(owner.email, "someone@example.test");

      await flushAudits();
      const [row] = await AuditLog.find({ action: "restaurant.update" });
      assert.equal(row.resourceType, "restaurant");
      assert.equal(row.resourceId, r.id);
      assert.equal(row.accountType, "restaurant");
      assert.equal(row.description, "Updated restaurant details");
      assert.deepEqual(row.changes.name, { from: "Kitchen " + row.changes.name.from.split(" ")[1], to: "Willow Hearth" });
      assert.deepEqual(row.changes.ownerName, { from: null, to: "Rafe Tolland" });
      assert.deepEqual(row.changes["address.city"], { from: "Westford", to: "Eastvale" });
      assert.deepEqual(row.changes["address.line1"], { from: "12 Lantern Row", to: "9 Mill Lane" });
      assert.deepEqual(row.changes.email, { from: null, to: "kitchen@example.test" });
      assert.equal(row.changes.status, undefined);
    });

    it("uses the partner's validation", async () => {
      const r = await restaurant();
      const bad = await patch(r.id, { phone: "12", gstin: "NOTAGSTIN", fssaiNumber: "123", name: "x" });
      assert.equal(bad.status, 422);
      assert.deepEqual(new Set(fields(bad)), new Set(["phone", "gstin", "fssaiNumber", "name"]));
      const gst = await patch(r.id, { gstRegistered: true });
      assert.equal(gst.status, 422);
      assert.deepEqual(fields(gst), ["gstin"]);
      assert.equal((await patch("nope", { name: "Valid Name" })).status, 422);
      assert.equal((await patch(String(oid()), { name: "Valid Name" })).status, 404);
    });

    it("sends an approved GST or FSSAI document back for review when its number changes", async () => {
      const r = await restaurant({ gstRegistered: true, gstin: "29ABCDE1234F1Z5", fssaiNumber: "12345678901234" });
      await kyc(r.ownerId, { ...ALL_DOCS, gst_certificate: "approved" });
      const before = await request(app).get(`${BASE}/${r.id}`).set(auth(admin.token));
      assert.equal(before.body.data.kyc.status, "verified");

      const res = await patch(r.id, { gstin: "29ABCDE1234F2Z4", fssaiNumber: "12345678901234" });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.equal(res.body.data.restaurant.status, "approved");
      assert.equal((await KycDocument.findOne({ user: r.ownerId, kind: "gst_certificate" })).status, "pending");
      assert.equal((await KycDocument.findOne({ user: r.ownerId, kind: "fssai_licence" })).status, "approved");
      const after = await request(app).get(`${BASE}/${r.id}`).set(auth(admin.token));
      assert.equal(after.body.data.kyc.status, "pending");

      await flushAudits();
      const row = await AuditLog.findOne({ action: "restaurant.update" });
      assert.deepEqual(row.changes.gstin, { from: "29ABCDE1234F1Z5", to: "29ABCDE1234F2Z4" });
      assert.equal(row.changes.fssaiNumber, undefined);
      assert.deepEqual(row.changes.reverified, ["gst_certificate"]);

      await patch(r.id, { fssaiNumber: "99999999999999" });
      await flushAudits();
      assert.equal((await KycDocument.findOne({ user: r.ownerId, kind: "fssai_licence" })).status, "pending");
    });

    it("changes nothing without an audit row when the values are the same", async () => {
      const r = await restaurant({ name: "Same Old Place" });
      const res = await patch(r.id, { name: "Same Old Place", phone: "9000000000", status: "suspended" });
      assert.equal(res.status, 200);
      assert.equal(res.body.data.restaurant.status, "approved");
      await flushAudits();
      assert.equal(await AuditLog.countDocuments({ action: "restaurant.update" }), 0);
    });

    it("needs restaurants:edit", async () => {
      const r = await restaurant();
      const viewer = await operatorWith([P.RESTAURANTS_VIEW]);
      assert.equal((await patch(r.id, { name: "Other Name" }, viewer.token)).status, 403);
      const editor = await operatorWith([P.RESTAURANTS_VIEW, P.RESTAURANTS_EDIT]);
      assert.equal((await patch(r.id, { name: "Other Name" }, editor.token)).status, 200);
    });
  });

  describe("PATCH /admin/restaurant-accounts/:id/status", () => {
    const setStatus = (id, body, token = admin.token) =>
      request(app).patch(`${BASE}/${id}/status`).set(auth(token)).send(body);

    it("approves, suspends and reactivates with the messages and audit", async () => {
      const r = await restaurant({ status: "pending" });
      const ok = await setStatus(r.id, { status: "approved" });
      assert.equal(ok.status, 200, JSON.stringify(ok.body));
      assert.equal(ok.body.message, "Restaurant approved");
      assert.equal(ok.body.data.restaurant.status, "approved");
      assert.ok(ok.body.data.restaurant.reviewedAt);
      assert.equal(ok.body.data.restaurant.owner, r.ownerId);

      const sus = await setStatus(r.id, { status: "suspended", reason: "Hygiene complaint" });
      assert.equal(sus.body.message, "Restaurant suspended");
      assert.equal(sus.body.data.restaurant.statusReason, "Hygiene complaint");
      const back = await setStatus(r.id, { status: "approved" });
      assert.equal(back.body.message, "Restaurant reactivated");

      await flushAudits();
      const rows = await AuditLog.find({ action: "restaurant.status" }).sort({ createdAt: 1, _id: 1 });
      assert.equal(rows.length, 3);
      assert.deepEqual(rows[1].changes, { status: { from: "approved", to: "suspended" } });
      assert.equal(rows[1].reason, "Hygiene complaint");
      assert.equal(rows[1].accountType, "restaurant");
      assert.equal(rows[1].resourceId, r.id);
    });

    it("rejects and asks for resubmission, which need a reason", async () => {
      const r = await restaurant({ status: "pending" });
      const none = await setStatus(r.id, { status: "rejected" });
      assert.equal(none.status, 422);
      assert.deepEqual(fields(none), ["reason"]);
      assert.equal((await setStatus(r.id, { status: "suspended", reason: " ab " })).status, 422);
      assert.equal((await setStatus(r.id, { status: "pending" })).status, 422);
      const ask = await setStatus(r.id, { status: "resubmission_requested", reason: "Upload the PAN card" });
      assert.equal(ask.body.message, "Asked for resubmission");
      const rej = await setStatus(r.id, { status: "rejected", reason: "Outside our area" });
      assert.equal(rej.body.message, "Restaurant rejected");
      // The existing transitions still apply.
      const bad = await setStatus(r.id, { status: "suspended", reason: "Not allowed now" });
      assert.equal(bad.status, 409);
    });

    it("the same status again is a no-op without an audit row", async () => {
      const r = await restaurant();
      const res = await setStatus(r.id, { status: "approved" });
      assert.equal(res.status, 200);
      assert.equal(res.body.data.restaurant.status, "approved");
      await flushAudits();
      assert.equal(await AuditLog.countDocuments({ action: "restaurant.status" }), 0);
    });

    it("keeps the KYC approval check", async () => {
      useRestaurantKyc(true);
      const r = await restaurant({ status: "pending" });
      const res = await setStatus(r.id, { status: "approved" });
      assert.equal(res.status, 409);
      assert.equal(res.body.error.code, "KYC_INCOMPLETE");
    });

    it("approve vs status permissions", async () => {
      // One operator account; its permissions change between requests (re-read each request).
      const op = await operatorWith([]);
      const as = async (permissions, id, body) => {
        await User.updateOne({ _id: op.user.id }, { customPermissions: [P.RESTAURANTS_VIEW, ...permissions] });
        return (await setStatus(id, body, op.token)).status;
      };
      const APPROVE = [P.RESTAURANTS_APPROVE];
      const STATUS = [P.RESTAURANTS_STATUS];
      const r = await restaurant({ status: "pending" });
      const suspend = { status: "suspended", reason: "Many complaints" };
      assert.equal(await as(STATUS, r.id, { status: "approved" }), 403);
      assert.equal(await as(APPROVE, r.id, { status: "approved" }), 200);
      assert.equal(await as(APPROVE, r.id, suspend), 403);
      assert.equal(await as(STATUS, r.id, suspend), 200);
      assert.equal(await as(APPROVE, r.id, { status: "approved" }), 403); // lifting a suspension
      assert.equal(await as(STATUS, r.id, { status: "approved" }), 200);
      assert.equal(await as([], r.id, suspend), 403);
      const other = await restaurant({ status: "pending" });
      assert.equal(await as(STATUS, other.id, { status: "rejected", reason: "Outside our area" }), 403);
      assert.equal(await as(APPROVE, other.id, { status: "rejected", reason: "Outside our area" }), 200);
    });
  });

  describe("PATCH /admin/restaurant-accounts/:id/accepting-orders", () => {
    const setOpen = (id, body, token = admin.token) =>
      request(app).patch(`${BASE}/${id}/accepting-orders`).set(auth(token)).send(body);

    it("closes with a reason and reopens, audited", async () => {
      const r = await restaurant();
      const none = await setOpen(r.id, { isAcceptingOrders: false });
      assert.equal(none.status, 422);
      assert.deepEqual(fields(none), ["reason"]);
      const closed = await setOpen(r.id, { isAcceptingOrders: false, reason: "Kitchen flooded" });
      assert.equal(closed.status, 200, JSON.stringify(closed.body));
      assert.equal(closed.body.message, "Restaurant closed for orders");
      assert.equal(closed.body.data.restaurant.isAcceptingOrders, false);
      const open = await setOpen(r.id, { isAcceptingOrders: true });
      assert.equal(open.body.message, "Restaurant open for orders");
      assert.equal((await Restaurant.findById(r.id)).isAcceptingOrders, true);
      assert.equal((await setOpen(r.id, { isAcceptingOrders: "maybe" })).status, 422);

      await flushAudits();
      const rows = await AuditLog.find({ action: "restaurant.accepting_orders" }).sort({ createdAt: 1, _id: 1 });
      assert.equal(rows.length, 2);
      assert.deepEqual(rows[0].changes, { isAcceptingOrders: { from: true, to: false } });
      assert.equal(rows[0].reason, "Kitchen flooded");
      assert.equal(rows[0].accountType, "restaurant");
      await setOpen(r.id, { isAcceptingOrders: true }); // no change, no row
      await flushAudits();
      assert.equal(await AuditLog.countDocuments({ action: "restaurant.accepting_orders" }), 2);
    });

    it("needs restaurants:status", async () => {
      const r = await restaurant();
      const editor = await operatorWith([P.RESTAURANTS_VIEW, P.RESTAURANTS_EDIT, P.RESTAURANTS_APPROVE]);
      assert.equal((await setOpen(r.id, { isAcceptingOrders: false, reason: "Closed today" }, editor.token)).status, 403);
    });
  });

  describe("restaurant filters on other admin lists", () => {
    const get = (path, query) => request(app).get(`/api/v1/admin${path}`).query(query).set(auth(admin.token));

    it("orders", async () => {
      const a = await restaurant();
      const b = await restaurant();
      await orders(a.id, [["delivered", 1], ["placed", 1]]);
      await orders(b.id, [["delivered", 1]]);
      const res = await get("/orders", { restaurant: a.id });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.equal(res.body.data.items.length, 2);
      assert.deepEqual(res.body.data.counts, { delivered: 1, placed: 1 });
      assert.deepEqual(fields(await get("/orders", { restaurant: "1" })), ["restaurant"]);
    });

    it("coupons: the restaurant's own offers and coupons limited to it", async () => {
      const a = await restaurant();
      const b = await restaurant();
      const coupon = (code, extra) =>
        Coupon.create({
          code, discountType: "flat", discountValue: 5000, validFrom: new Date(), validUntil: new Date(Date.now() + DAY), ...extra,
        });
      await coupon("OWNA", { source: "restaurant", kind: "restaurant_offer", restaurant: a.id, approvalStatus: "approved" });
      await coupon("SCOPEDA", { restaurants: [a.id, b.id] });
      await coupon("OWNB", { source: "restaurant", kind: "restaurant_offer", restaurant: b.id, approvalStatus: "approved" });
      await coupon("EVERYWHERE", {});
      const res = await get("/coupons", { restaurant: a.id });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.deepEqual(res.body.data.items.map((c) => c.code).sort(), ["OWNA", "SCOPEDA"]);
      assert.deepEqual(fields(await get("/coupons", { restaurant: "x" })), ["restaurant"]);
    });

    it("payouts", async () => {
      const a = await restaurant();
      const b = await restaurant();
      const payout = (r) =>
        Payout.create({ type: "restaurant", restaurant: r.id, payee: r.ownerId, payeeName: "Fictional", createdBy: admin.user.id });
      const mine = await payout(a);
      await payout(b);
      const res = await get("/finance/payouts", { restaurant: a.id });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.deepEqual(res.body.data.items.map((p) => p.id), [String(mine._id)]);
      assert.deepEqual(fields(await get("/finance/payouts", { restaurant: "x" })), ["restaurant"]);
    });

    it("reviewed orders and menu items", async () => {
      const a = await restaurant();
      const b = await restaurant();
      const review = async (r) => {
        const order = oid();
        await Review.collection.insertOne({
          target: "restaurant", customer: oid(), customerName: "Nell Varga", order, orderNumber: `BB-R-${order}`,
          restaurant: new mongoose.Types.ObjectId(r.id), rating: 5, comment: "", status: "published", openReports: 0,
          createdAt: new Date(), updatedAt: new Date(),
        });
        return String(order);
      };
      const reviewed = await review(a);
      await review(b);
      const res = await get("/reviews/orders", { restaurantId: a.id });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.deepEqual(res.body.data.items.map((o) => o.order), [reviewed]);
      assert.deepEqual(fields(await get("/reviews/orders", { restaurantId: "x" })), ["restaurantId"]);

      const food = (r, name) =>
        FoodItem.collection.insertOne({
          restaurant: new mongoose.Types.ObjectId(r.id), name, slug: name.toLowerCase(), pricePaise: 100, isVeg: true,
          isAvailable: true, deletedAt: null, createdAt: new Date(), updatedAt: new Date(),
        });
      await food(a, "Barley Soup");
      await food(b, "Rye Toast");
      const foods = await get("/foods", { restaurant: a.id });
      assert.equal(foods.status, 200, JSON.stringify(foods.body));
      assert.deepEqual(foods.body.data.items.map((f) => f.name), ["Barley Soup"]);
      assert.deepEqual(fields(await get("/foods", { restaurant: "x" })), ["restaurant"]);
    });

    it("audit log: up to 5 resource ids separated by commas", async () => {
      const r = await restaurant();
      await setOpenAs(r.id);
      await request(app).patch(`${BASE}/${r.id}`).set(auth(admin.token)).send({ name: "Lark Kitchen" });
      await AuditLog.create({ admin: admin.user.id, adminRole: "admin", action: "user.update", description: "x", resourceType: "user", resourceId: r.ownerId });
      await AuditLog.create({ admin: admin.user.id, adminRole: "admin", action: "user.update", description: "y", resourceType: "user", resourceId: String(oid()) });
      await flushAudits();
      const res = await get("/audit-logs", { resourceId: `${r.id}, ${r.ownerId}` });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.equal(res.body.data.items.length, 3);
      assert.equal((await get("/audit-logs", { resourceId: r.ownerId })).body.data.items.length, 1);
      const many = await get("/audit-logs", { resourceId: "a,b,c,d,e,f" });
      assert.equal(many.status, 422);
      assert.deepEqual(fields(many), ["resourceId"]);
      assert.equal((await get("/audit-logs", { resourceId: "a,,b" })).status, 422);
    });

    const setOpenAs = (id) =>
      request(app).patch(`${BASE}/${id}/accepting-orders`).set(auth(admin.token)).send({ isAcceptingOrders: false, reason: "Closed for a wedding" });
  });
});
