// Global filters, phase A: multi-value filters (comma-separated, OR within a field, AND across
// fields) and facet counts (`facets=1`) on the admin customers, restaurant accounts, delivery
// partner accounts, admins and audit log lists. Same as the Django tests.
import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import mongoose from "mongoose";
import { AuditLog } from "../models/audit-log.model.js";
import { DeliveryPartner } from "../models/delivery-partner.model.js";
import { KycDocument, PayoutAccount } from "../models/kyc-document.model.js";
import { Restaurant } from "../models/restaurant.model.js";
import { ADMIN_ROLES, User } from "../models/user.model.js";
import { useRiderKyc } from "../services/delivery-partner.service.js";
import { useRestaurantKyc } from "../services/restaurant.service.js";
import { buildApp, createAndLogin, request, resetDb, setupTestDb, teardownTestDb } from "./helpers.js";

const auth = (token) => ({ Authorization: `Bearer ${token}` });
const oid = () => new mongoose.Types.ObjectId();
const DAY = 86_400_000;
const fields = (res) => res.body.error.details.map((e) => e.field);
const ids = (res) => res.body.data.items.map((r) => String(r.id)).sort();
const sorted = (list) => list.map(String).sort();
/** A facet as { value: count }, in the response's order. */
const counts = (res, name) => Object.fromEntries(res.body.data.facets[name].map((f) => [f.value, f.count]));
const order = (res, name) => res.body.data.facets[name].map((f) => f.value);

describe("admin list filters and facets", () => {
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
    useRiderKyc(false);
    admin = await createAndLogin(app, "admin");
    // Only the accounts each test inserts (the signed-in super admin stays).
    await User.deleteMany({ _id: { $ne: admin.user.id } });
  });
  afterEach(() => {
    useRiderKyc(null);
    useRestaurantKyc(null);
  });

  const get = (path, query = {}) =>
    request(app).get(`/api/v1/admin/${path}`).query(query).set(auth(admin.token));

  async function user(role, fields = {}) {
    seq += 1;
    const _id = oid();
    const createdAt = fields.createdAt ?? new Date(Date.now() - DAY);
    await User.collection.insertOne({
      _id,
      name: `Person ${seq}`,
      email: `person${seq}.${_id}@example.test`,
      passwordHash: "x",
      role,
      status: "active",
      tokenVersion: 0,
      updatedAt: createdAt,
      ...fields,
      createdAt,
    });
    return String(_id);
  }

  /** The common checks: no facets without facets=1, and `limit=1&facets=1` keeps the total. */
  async function plainAndPreview(path, query, total) {
    const plain = await get(path, query);
    assert.equal(plain.status, 200);
    assert.equal("facets" in plain.body.data, false);
    assert.equal("facets" in (await get(path, { ...query, facets: "0" })).body.data, false);
    const preview = await get(path, { ...query, limit: 1, facets: 1 });
    assert.equal(preview.status, 200);
    assert.equal(preview.body.data.items.length, Math.min(1, total));
    assert.equal(preview.body.data.pagination.total, total);
    assert.ok(preview.body.data.facets);
  }

  describe("GET /admin/customers", () => {
    let c;
    beforeEach(async () => {
      const at = new Date();
      c = {
        emailOnly: await user("customer", { name: "Ada Lane", emailVerifiedAt: at }),
        phoneOnly: await user("customer", { status: "suspended", phoneVerifiedAt: at }),
        both: await user("customer", { status: "blocked", emailVerifiedAt: at, phoneVerifiedAt: at }),
        neither: await user("customer", { name: "Ada Moss" }),
      };
    });

    it("takes several values per filter: OR within one, AND across", async () => {
      assert.deepEqual(ids(await get("customers", { status: "active,suspended" })), sorted([c.emailOnly, c.phoneOnly, c.neither]));
      assert.deepEqual(ids(await get("customers", { verification: "email_verified,phone_verified" })), sorted([c.emailOnly, c.phoneOnly, c.both]));
      assert.deepEqual(
        ids(await get("customers", { status: "active, blocked", verification: "email_verified" })),
        sorted([c.emailOnly, c.both]),
      );
      // One value as before; empty items are ignored.
      assert.deepEqual(ids(await get("customers", { status: "suspended" })), [c.phoneOnly]);
      assert.equal((await get("customers", { status: ",," })).body.data.items.length, 4);
    });

    it("rejects any invalid value on that field", async () => {
      for (const [name, value] of [["status", "active,gone"], ["verification", "email_verified,maybe"]]) {
        const res = await get("customers", { [name]: value });
        assert.equal(res.status, 422, name);
        assert.deepEqual(fields(res), [name]);
      }
      assert.deepEqual(fields(await get("customers", { facets: "yes" })), ["facets"]);
    });

    it("counts each facet with every filter but its own", async () => {
      const res = await get("customers", { status: "active", facets: 1 });
      assert.deepEqual(res.body.data.facets.status, [
        { value: "active", count: 2 },
        { value: "inactive", count: 0 },
        { value: "suspended", count: 1 },
        { value: "blocked", count: 1 },
      ]);
      // Overlapping values: each customer counts once per channel.
      assert.deepEqual(counts(res, "verification"), {
        email_verified: 1,
        email_unverified: 1,
        phone_verified: 0,
        phone_unverified: 2,
      });
      assert.deepEqual(order(res, "verification"), ["email_verified", "email_unverified", "phone_verified", "phone_unverified"]);

      // The search applies to every facet.
      const ada = await get("customers", { verification: "phone_unverified", search: "Ada", facets: 1 });
      assert.deepEqual(counts(ada, "status"), { active: 2, inactive: 0, suspended: 0, blocked: 0 });
      assert.deepEqual(counts(ada, "verification"), {
        email_verified: 1,
        email_unverified: 1,
        phone_verified: 0,
        phone_unverified: 2,
      });
    });

    it("leaves facets out unless asked; limit=1 keeps the total", () =>
      plainAndPreview("customers", { status: "active,blocked" }, 3));
  });

  describe("GET /admin/restaurant-accounts", () => {
    async function restaurant(fields = {}, owner = {}) {
      const ownerId = await user("restaurant", owner);
      seq += 1;
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
      return { id: String(r._id), ownerId };
    }
    const at = (city) => ({ address: { line1: "1 Row", city, state: "Avalon", postalCode: "560001" } });

    let r;
    beforeEach(async () => {
      r = {
        west: await restaurant(at("Westford")),
        westLower: await restaurant({ status: "pending", ...at("westford ") }, { status: "suspended" }),
        east: await restaurant({ status: "suspended", ...at("Eastvale") }),
        north: await restaurant(at("Northgate")),
      };
      for (const kind of ["fssai_licence", "pan_card", "cancelled_cheque"])
        await KycDocument.create({ user: r.west.ownerId, kind, fileName: `${oid()}.pdf`, contentType: "application/pdf", size: 10, status: "approved" });
      await PayoutAccount.create({ user: r.west.ownerId, holderName: "Fictional Owner", accountNumberEncrypted: "x", accountLast4: "1234", ifsc: "FAKE0001234" });
    });

    it("takes several values per filter", async () => {
      assert.deepEqual(ids(await get("restaurant-accounts", { status: "pending,suspended" })), sorted([r.westLower.id, r.east.id]));
      assert.deepEqual(ids(await get("restaurant-accounts", { city: "WESTFORD, eastvale" })), sorted([r.west.id, r.westLower.id, r.east.id]));
      assert.deepEqual(ids(await get("restaurant-accounts", { accountStatus: "suspended,blocked" })), [r.westLower.id]);
      assert.deepEqual(ids(await get("restaurant-accounts", { kyc: "verified,pending" })), [r.west.id]);
      assert.deepEqual(ids(await get("restaurant-accounts", { kyc: "verified,incomplete", city: "Northgate" })), [r.north.id]);
    });

    it("rejects any invalid value on that field", async () => {
      for (const [name, value] of [["status", "approved,open"], ["accountStatus", "x"], ["kyc", "verified,done"], ["city", `Westford,${"x".repeat(61)}`]]) {
        const res = await get("restaurant-accounts", { [name]: value });
        assert.equal(res.status, 422, name);
        assert.deepEqual(fields(res), [name]);
      }
    });

    it("counts fixed values in enum order and cities by count, then name", async () => {
      const res = await get("restaurant-accounts", { city: "Eastvale", facets: 1 });
      assert.deepEqual(res.body.data.facets.city, [
        { value: "Westford", count: 2 },
        { value: "Eastvale", count: 1 },
        { value: "Northgate", count: 1 },
      ]);
      assert.deepEqual(res.body.data.facets.status, [
        { value: "pending", count: 0 },
        { value: "approved", count: 0 },
        { value: "rejected", count: 0 },
        { value: "suspended", count: 1 },
        { value: "resubmission_requested", count: 0 },
      ]);
      assert.deepEqual(counts(res, "accountStatus"), { active: 1, inactive: 0, suspended: 0, blocked: 0 });
      assert.deepEqual(res.body.data.facets.kyc, [
        { value: "verified", count: 0 },
        { value: "pending", count: 0 },
        { value: "incomplete", count: 1 },
        { value: "rejected", count: 0 },
      ]);

      const kyc = await get("restaurant-accounts", { kyc: "verified", accountStatus: "active", facets: 1 });
      assert.deepEqual(counts(kyc, "kyc"), { verified: 1, pending: 0, incomplete: 2, rejected: 0 });
      assert.deepEqual(counts(kyc, "accountStatus"), { active: 1, inactive: 0, suspended: 0, blocked: 0 });
      assert.deepEqual(kyc.body.data.facets.city, [{ value: "Westford", count: 1 }]);
      assert.deepEqual(counts(kyc, "status"), { pending: 0, approved: 1, rejected: 0, suspended: 0, resubmission_requested: 0 });
    });

    it("leaves facets out unless asked; limit=1 keeps the total", () =>
      plainAndPreview("restaurant-accounts", { city: "westford" }, 2));
  });

  describe("GET /admin/delivery-partner-accounts", () => {
    async function rider(fields = {}, profile = {}) {
      const id = await user("delivery", fields);
      if (profile !== false)
        await DeliveryPartner.create({ user: id, vehicleType: "scooter", verificationStatus: "approved", ...profile });
      return id;
    }

    let d;
    beforeEach(async () => {
      d = {
        free: await rider({}, { isOnline: true, zone: "North Loop" }),
        offline: await rider({}, { verificationStatus: "pending", vehicleType: "bicycle", zone: "north loop" }),
        busy: await rider({ status: "suspended" }, { verificationStatus: "rejected", vehicleType: "car", isOnline: true, activeOrder: oid(), zone: "South Bank" }),
        bare: await rider({}, false),
      };
    });

    it("takes several values per filter", async () => {
      const list = (q) => get("delivery-partner-accounts", q);
      assert.deepEqual(ids(await list({ availability: "online,busy" })), sorted([d.free, d.busy]));
      assert.deepEqual(ids(await list({ verification: "pending,rejected" })), sorted([d.offline, d.busy, d.bare]));
      assert.deepEqual(ids(await list({ vehicleType: "bicycle,car" })), sorted([d.offline, d.busy]));
      assert.deepEqual(ids(await list({ zone: "NORTH LOOP,south bank" })), sorted([d.free, d.offline, d.busy]));
      assert.deepEqual(ids(await list({ accountStatus: "active,blocked", availability: "offline" })), sorted([d.offline, d.bare]));
      assert.deepEqual(ids(await list({ kyc: "verified,incomplete", vehicleType: "scooter" })), [d.free]);
    });

    it("rejects any invalid value on that field", async () => {
      for (const [name, value] of [
        ["verification", "approved,ok"], ["availability", "online,away"], ["kyc", "x"],
        ["accountStatus", "active,gone"], ["vehicleType", "car,boat"], ["zone", "y".repeat(61)],
      ]) {
        const res = await get("delivery-partner-accounts", { [name]: value });
        assert.equal(res.status, 422, name);
        assert.deepEqual(fields(res), [name]);
      }
    });

    it("counts each facet with every filter but its own", async () => {
      const res = await get("delivery-partner-accounts", { vehicleType: "bicycle", facets: 1 });
      const { facets } = res.body.data;
      assert.deepEqual(Object.keys(facets), ["verification", "availability", "kyc", "accountStatus", "zone", "vehicleType"]);
      // The rider with no profile has no vehicle.
      assert.deepEqual(facets.vehicleType, [
        { value: "bicycle", count: 1 },
        { value: "scooter", count: 1 },
        { value: "motorbike", count: 0 },
        { value: "car", count: 1 },
      ]);
      assert.deepEqual(counts(res, "verification"), { pending: 1, approved: 0, rejected: 0, resubmission_requested: 0 });
      assert.deepEqual(facets.availability, [
        { value: "online", count: 0 },
        { value: "offline", count: 1 },
        { value: "busy", count: 0 },
      ]);
      assert.deepEqual(counts(res, "kyc"), { verified: 0, pending: 0, incomplete: 1, rejected: 0 });
      assert.deepEqual(counts(res, "accountStatus"), { active: 1, inactive: 0, suspended: 0, blocked: 0 });
      assert.deepEqual(facets.zone, [{ value: "north loop", count: 1 }]);

      const all = await get("delivery-partner-accounts", { availability: "online", facets: 1 });
      assert.deepEqual(counts(all, "availability"), { online: 1, offline: 2, busy: 1 });
      assert.deepEqual(all.body.data.facets.zone, [{ value: "North Loop", count: 1 }]);
      const zones = await get("delivery-partner-accounts", { zone: "south bank", facets: 1 });
      assert.deepEqual(zones.body.data.facets.zone, [
        { value: "North Loop", count: 2 },
        { value: "South Bank", count: 1 },
      ]);
    });

    it("leaves facets out unless asked; limit=1 keeps the total", () =>
      plainAndPreview("delivery-partner-accounts", { availability: "offline,busy" }, 3));
  });

  describe("GET /admin/admins", () => {
    let a;
    beforeEach(async () => {
      a = {
        ops: await user("operations_admin"),
        finance: await user("finance_admin", { status: "suspended" }),
        support: await user("support_admin", { status: "inactive" }),
        operator: await user("operator"),
      };
      await user("customer");
    });

    it("takes several values per filter", async () => {
      assert.deepEqual(ids(await get("admins", { role: "finance_admin,support_admin" })), sorted([a.finance, a.support]));
      assert.deepEqual(ids(await get("admins", { status: "suspended,inactive", role: "support_admin,operator" })), [a.support]);
      assert.equal((await get("admins", { status: "active" })).body.data.items.length, 3);
    });

    it("rejects any invalid value on that field", async () => {
      for (const [name, value] of [["role", "operator,customer"], ["status", "active,gone"]]) {
        const res = await get("admins", { [name]: value });
        assert.equal(res.status, 422, name);
        assert.deepEqual(fields(res), [name]);
      }
    });

    it("counts each facet with every filter but its own", async () => {
      const res = await get("admins", { status: "active", facets: 1 });
      assert.deepEqual(res.body.data.facets.role, [
        { value: "admin", count: 1 },
        { value: "operations_admin", count: 1 },
        { value: "finance_admin", count: 0 },
        { value: "support_admin", count: 0 },
        { value: "operator", count: 1 },
      ]);
      assert.deepEqual(order(res, "role"), [...ADMIN_ROLES]);
      assert.deepEqual(counts(res, "status"), { active: 3, inactive: 1, suspended: 1, blocked: 0 });
      const both = await get("admins", { status: "active", role: "operator", facets: 1 });
      assert.deepEqual(counts(both, "status"), { active: 1, inactive: 0, suspended: 0, blocked: 0 });
    });

    it("leaves facets out unless asked; limit=1 keeps the total", () =>
      plainAndPreview("admins", { role: "operator,finance_admin" }, 2));
  });

  describe("GET /admin/audit-logs", () => {
    beforeEach(async () => {
      await AuditLog.collection.deleteMany({});
      const row = (action, adminRole = "admin", accountType = "") => ({
        admin: oid(),
        adminRole,
        action,
        description: `Did ${action}`,
        accountType,
        changes: {},
        reason: "",
        createdAt: new Date(),
      });
      await AuditLog.collection.insertMany([
        row("order.cancel", "operations_admin"),
        row("order.cancel", "operations_admin"),
        row("order.cancel", "support_admin"),
        row("b.edit", "finance_admin", "restaurant"),
        row("b.edit", "admin", "customer"),
        row("a.edit", "admin", "customer"),
        row("a.edit", "admin", "admin"),
        // 55 actions seen once: only the first 50 values (by count, then name) are listed.
        ...Array.from({ length: 55 }, (_, i) => row(`z.once${String(i).padStart(2, "0")}`)),
      ]);
    });

    it("takes several values per filter", async () => {
      const list = (q) => get("audit-logs", { limit: 100, ...q });
      assert.equal((await list({ action: "order.cancel, a.edit" })).body.data.pagination.total, 5);
      assert.equal((await list({ role: "operations_admin,support_admin" })).body.data.pagination.total, 3);
      assert.equal((await list({ accountType: "customer,admin" })).body.data.pagination.total, 3);
      assert.equal((await list({ accountType: "customer,admin", action: "b.edit,order.cancel" })).body.data.pagination.total, 1);
    });

    it("rejects any invalid value on that field", async () => {
      for (const [name, value] of [["role", "admin,customer"], ["accountType", "customer,user"], ["action", `a.edit,${"x".repeat(61)}`]]) {
        const res = await get("audit-logs", { [name]: value });
        assert.equal(res.status, 422, name);
        assert.deepEqual(fields(res), [name]);
      }
    });

    it("lists the actions that occur, most first then A to Z, at most 50", async () => {
      const res = await get("audit-logs", { facets: 1 });
      const actions = res.body.data.facets.action;
      assert.equal(actions.length, 50);
      assert.deepEqual(actions.slice(0, 4), [
        { value: "order.cancel", count: 3 },
        { value: "a.edit", count: 2 },
        { value: "b.edit", count: 2 },
        { value: "z.once00", count: 1 },
      ]);
      assert.equal(actions.at(-1).value, "z.once46");
      assert.deepEqual(res.body.data.facets.accountType, [
        { value: "customer", count: 2 },
        { value: "restaurant", count: 1 },
        { value: "delivery", count: 0 },
        { value: "admin", count: 1 },
      ]);
      assert.deepEqual(order(res, "role"), [...ADMIN_ROLES]);
    });

    it("counts each facet with every filter but its own", async () => {
      const res = await get("audit-logs", { role: "operations_admin,admin", action: "order.cancel", facets: 1 });
      assert.deepEqual(res.body.data.facets.action.slice(0, 4), [
        { value: "a.edit", count: 2 },
        { value: "order.cancel", count: 2 },
        { value: "b.edit", count: 1 },
        { value: "z.once00", count: 1 },
      ]);
      assert.equal(res.body.data.pagination.total, 2);
      assert.deepEqual(counts(res, "role"), {
        admin: 0,
        operations_admin: 2,
        finance_admin: 0,
        support_admin: 1,
        operator: 0,
      });
      assert.deepEqual(counts(res, "accountType"), { customer: 0, restaurant: 0, delivery: 0, admin: 0 });
    });

    it("leaves facets out unless asked; limit=1 keeps the total", () =>
      plainAndPreview("audit-logs", { action: "a.edit,b.edit" }, 4));
  });
});
