// Account management, phase 4: delivery partner accounts (list, account view, admin edit,
// verification, taking a rider offline, availability history) and the rider filters on other
// admin lists. Same as backend/apps/delivery/tests (Django).
import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import mongoose from "mongoose";
import { PERMISSIONS as P } from "../config/permissions.js";
import { AuditLog } from "../models/audit-log.model.js";
import { DeliveryPartner } from "../models/delivery-partner.model.js";
import { KycDocument, PayoutAccount } from "../models/kyc-document.model.js";
import { Notification } from "../models/notification.model.js";
import { Order } from "../models/order.model.js";
import { Payout } from "../models/payout.model.js";
import { Review } from "../models/review.model.js";
import { RiderAvailabilityLog } from "../models/rider-availability-log.model.js";
import { User } from "../models/user.model.js";
import { flushAudits } from "../services/audit.service.js";
import { useRiderKyc } from "../services/delivery-partner.service.js";
import { sweep } from "../services/dispatch.service.js";
import { buildApp, createAndLogin, registerUser, request, resetDb, setupTestDb, teardownTestDb } from "./helpers.js";

const auth = (token) => ({ Authorization: `Bearer ${token}` });
const oid = () => new mongoose.Types.ObjectId();
const DAY = 86_400_000;
const fields = (res) => res.body.error.details.map((e) => e.field);
const BASE = "/api/v1/admin/delivery-partner-accounts";
const ALL_DOCS = { driving_licence: "approved", vehicle_rc: "approved", id_proof: "approved" };
const ADDRESS = { line1: "7 Quill Street", city: "Westford", state: "Avalon", postalCode: "560001" };
const NEAR = { latitude: 12.97, longitude: 77.59 };

describe("admin delivery partner accounts", () => {
  let app;
  let admin;

  before(async () => {
    await setupTestDb();
    app = buildApp();
  });
  after(teardownTestDb);

  beforeEach(async () => {
    await resetDb();
    useRiderKyc(false);
    admin = await createAndLogin(app, "admin");
    // Keep the seeded development rider out of the lists (seeding again leaves it alone).
    await User.updateMany({ role: "delivery", email: /@bitebox\.test$/ }, { role: "customer" });
  });
  afterEach(() => useRiderKyc(null));

  let seq = 0;
  /** A rider account and (unless `profile: false`) profile, inserted directly. Returns the id. */
  async function rider(user = {}, profile = {}) {
    seq += 1;
    const id = oid();
    const createdAt = user.createdAt ?? new Date(Date.now() - DAY);
    await User.collection.insertOne({
      _id: id,
      name: `Rider ${seq}`,
      email: `rider${seq}.${id}@example.test`,
      passwordHash: "x",
      role: "delivery",
      status: "active",
      tokenVersion: 0,
      createdAt,
      updatedAt: createdAt,
      ...user,
    });
    if (profile !== false)
      await DeliveryPartner.create({
        user: id,
        vehicleType: "scooter",
        vehicleNumber: "KA01AB1234",
        verificationStatus: "approved",
        ...profile,
      });
    return String(id);
  }

  /** The rider's documents ({ kind: status }) and, unless `account: false`, a bank account. */
  async function kyc(userId, docs = ALL_DOCS, { account = true } = {}) {
    for (const [kind, status] of Object.entries(docs))
      await KycDocument.create({ user: userId, kind, fileName: `${oid()}.pdf`, contentType: "application/pdf", size: 10, status });
    if (account)
      await PayoutAccount.create({
        user: userId,
        holderName: "Fictional Rider",
        accountNumberEncrypted: "x",
        accountLast4: "1234",
        ifsc: "FAKE0001234",
      });
  }

  async function orders(riderId, rows) {
    await Order.collection.insertMany(
      rows.map(([status, riderPaise, at = new Date()]) => ({
        orderNumber: `BB-T-${oid()}`,
        customer: oid(),
        restaurant: oid(),
        restaurantSnapshot: { name: "Fictional" },
        deliveryPartner: riderId ? new mongoose.Types.ObjectId(riderId) : null,
        status,
        pricing: { totalPaise: 50_000 },
        ...(status === "delivered" && { settlement: { riderPaise, at } }),
        createdAt: at,
        updatedAt: at,
      })),
    );
  }

  const list = (query = {}, token = admin.token) => request(app).get(BASE).query(query).set(auth(token));
  const ids = (res) => res.body.data.items.map((r) => r.id);
  const detail = (id, token = admin.token) => request(app).get(`${BASE}/${id}`).set(auth(token));

  async function operatorWith(permissions) {
    const op = await createAndLogin(app, "operator");
    await User.updateOne({ _id: op.user.id }, { customPermissions: permissions });
    return op;
  }

  describe("GET /admin/delivery-partner-accounts", () => {
    it("lists riders newest first with profile figures and the KYC state", async () => {
      const old = await rider(
        { name: "Tamsin Vale", phone: "9000011111", avatarUrl: "https://img.example.test/t.jpg" },
        { zone: "North Loop", completedDeliveries: 12, rating: { average: 4.5, count: 8 } },
      );
      const fresh = await rider({ createdAt: new Date(Date.now() - 3600_000) }, false);
      await kyc(old);

      const res = await list();
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.deepEqual(ids(res), [fresh, old]);
      const item = res.body.data.items[1];
      assert.deepEqual(Object.keys(item).sort(), [
        "avatarUrl", "busy", "completedDeliveries", "createdAt", "email", "id", "isOnline", "kycStatus", "name",
        "phone", "rating", "status", "statusReason", "vehicleNumber", "vehicleType", "verificationStatus", "zone",
      ]);
      assert.equal(item.name, "Tamsin Vale");
      assert.equal(item.phone, "9000011111");
      assert.equal(item.zone, "North Loop");
      assert.equal(item.vehicleType, "scooter");
      assert.equal(item.vehicleNumber, "KA01AB1234");
      assert.equal(item.completedDeliveries, 12);
      assert.deepEqual(item.rating, { average: 4.5, count: 8 });
      assert.equal(item.kycStatus, "verified");
      assert.equal(item.verificationStatus, "approved");
      assert.equal(item.isOnline, false);
      assert.equal(item.busy, false);
      assert.equal(item.statusReason, null);
      // No profile yet: pending, offline, nothing set.
      const bare = res.body.data.items[0];
      assert.equal(bare.verificationStatus, "pending");
      assert.equal(bare.vehicleType, null);
      assert.equal(bare.zone, null);
      assert.equal(bare.completedDeliveries, 0);
      assert.deepEqual(bare.rating, { average: 0, count: 0 });
      assert.equal(bare.kycStatus, "incomplete");
      assert.deepEqual(res.body.data.pagination, { page: 1, limit: 20, total: 2, totalPages: 1 });
    });

    it("searches name, email, phone, vehicle number and id", async () => {
      const a = await rider({ name: "Orla Brightwater", phone: "9876543210" }, { vehicleNumber: "KA 05 MN 4321" });
      const b = await rider({ name: "Pell Hartigan", email: "pell.h@example.test" }, { vehicleNumber: "TN09ZZ0001" });
      await rider({ role: "customer", name: "Orla Customer" }, false);
      const found = async (search) => ids(await list({ search }));
      assert.deepEqual(await found("orla"), [a]);
      assert.deepEqual(await found("PELL.H@"), [b]);
      assert.deepEqual(await found("+91 98765 43210"), [a]);
      assert.deepEqual(await found("ka05mn"), [a]);
      assert.deepEqual(await found("tn 09 zz"), [b]);
      assert.deepEqual(await found(`#${b.slice(-6)}`), [b]);
      assert.deepEqual(await found(a), [a]);
    });

    it("filters by account status, verification, zone, vehicle type and join date", async () => {
      const suspended = await rider({ status: "suspended", statusReason: "Fictional reason" });
      const pending = await rider({}, { verificationStatus: "pending", zone: "North Loop", vehicleType: "bicycle" });
      const legacy = await rider({}, { verificationStatus: undefined });
      const noProfile = await rider({}, false);
      const rejected = await rider({ createdAt: new Date("2026-01-10T12:00:00Z") }, { verificationStatus: "rejected", zone: "south bank" });

      assert.deepEqual(ids(await list({ accountStatus: "suspended" })), [suspended]);
      assert.equal((await list({ accountStatus: "suspended" })).body.data.items[0].statusReason, "Fictional reason");
      assert.deepEqual(ids(await list({ verification: "pending" })).sort(), [noProfile, pending].sort());
      assert.ok(ids(await list({ verification: "approved" })).includes(legacy));
      assert.deepEqual(ids(await list({ verification: "rejected" })), [rejected]);
      assert.deepEqual(ids(await list({ zone: "north loop" })), [pending]);
      assert.deepEqual(ids(await list({ zone: "SOUTH BANK" })), [rejected]);
      assert.deepEqual(ids(await list({ vehicleType: "bicycle" })), [pending]);
      assert.deepEqual(ids(await list({ joinedFrom: "2026-01-10", joinedTo: "2026-01-10" })), [rejected]);
    });

    it("filters by availability: online (free), busy (carrying an order), offline", async () => {
      const free = await rider({}, { isOnline: true });
      const busy = await rider({}, { isOnline: true, activeOrder: oid() });
      const offline = await rider();
      const none = await rider({}, false);
      assert.deepEqual(ids(await list({ availability: "online" })), [free]);
      assert.deepEqual(ids(await list({ availability: "busy" })), [busy]);
      assert.deepEqual(ids(await list({ availability: "offline" })).sort(), [offline, none].sort());
      const items = (await list()).body.data.items;
      assert.equal(items.find((i) => i.id === busy).busy, true);
      assert.equal(items.find((i) => i.id === busy).isOnline, true);
      assert.equal(items.find((i) => i.id === free).busy, false);
    });

    it("filters by KYC state with the rider checklist and bank account", async () => {
      const verified = await rider();
      await kyc(verified);
      const pending = await rider();
      await kyc(pending, { ...ALL_DOCS, id_proof: "pending" });
      const noAccount = await rider();
      await kyc(noAccount, ALL_DOCS, { account: false });
      const missingDoc = await rider();
      await kyc(missingDoc, { driving_licence: "approved", vehicle_rc: "approved" });
      const rejected = await rider();
      await kyc(rejected, { ...ALL_DOCS, vehicle_rc: "rejected" });
      assert.deepEqual(ids(await list({ kyc: "verified" })), [verified]);
      assert.deepEqual(ids(await list({ kyc: "pending" })), [pending]);
      assert.deepEqual(ids(await list({ kyc: "incomplete" })).sort(), [missingDoc, noAccount].sort());
      assert.deepEqual(ids(await list({ kyc: "rejected" })), [rejected]);
    });

    it("sorts by name, deliveries and rating (ties newest first), and pages", async () => {
      const t = (h) => ({ createdAt: new Date(Date.now() - h * 3600_000) });
      const a = await rider({ name: "beatrix Moss", ...t(5) }, { completedDeliveries: 3, rating: { average: 4.2, count: 2 } });
      const b = await rider({ name: "Aldo Finch", ...t(4) }, { completedDeliveries: 9, rating: { average: 4.8, count: 1 } });
      const c = await rider({ name: "Cyra Lowe", ...t(3) }, { completedDeliveries: 3, rating: { average: 4.8, count: 6 } });
      const d = await rider({ name: "Dov Pike", ...t(2) }, false);
      assert.deepEqual(ids(await list({ sort: "name" })), [b, a, c, d]);
      assert.deepEqual(ids(await list({ sort: "oldest" })), [a, b, c, d]);
      assert.deepEqual(ids(await list({ sort: "deliveries" })), [b, c, a, d]);
      assert.deepEqual(ids(await list({ sort: "rating" })), [c, b, a, d]);
      const page2 = await list({ sort: "deliveries", page: 2, limit: 2 });
      assert.deepEqual(ids(page2), [a, d]);
      assert.deepEqual(page2.body.data.pagination, { page: 2, limit: 2, total: 4, totalPages: 2 });
    });

    it("rejects invalid filters on the field", async () => {
      for (const [key, value] of [
        ["accountStatus", "gone"], ["verification", "maybe"], ["availability", "away"], ["kyc", "done"],
        ["vehicleType", "boat"], ["sort", "fastest"], ["joinedFrom", "2026-13-01"], ["limit", "0"],
      ]) {
        const res = await list({ [key]: value });
        assert.equal(res.status, 422, key);
        assert.deepEqual(fields(res), [key]);
        assert.equal(res.body.error.details[0].message, "Invalid value");
      }
      assert.deepEqual(fields(await list({ joinedFrom: "2026-02-02", joinedTo: "2026-02-01" })), ["joinedTo"]);
    });

    it("needs riders:view", async () => {
      const op = await operatorWith([P.CUSTOMERS_VIEW, P.RIDERS_MANAGE]);
      assert.equal((await list({}, op.token)).status, 403);
      assert.equal((await request(app).get(`${BASE}/zones`).set(auth(op.token))).status, 403);
      const viewer = await operatorWith([P.RIDERS_VIEW]);
      assert.equal((await list({}, viewer.token)).status, 200);
    });
  });

  it("GET /zones lists distinct zones A to Z, case-insensitively unique", async () => {
    await rider({}, { zone: "south bank" });
    await rider({}, { zone: "North Loop" });
    await rider({}, { zone: "north loop" });
    await rider({}, { zone: "  " });
    await rider();
    const res = await request(app).get(`${BASE}/zones`).set(auth(admin.token));
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.data, { zones: ["North Loop", "south bank"] });
  });

  describe("GET /admin/delivery-partner-accounts/:id", () => {
    it("returns the account, the rider profile, figures and KYC", async () => {
      const id = await rider(
        { name: "Wren Ashby" },
        {
          zone: "Harbour",
          emergencyContact: { name: "Ida Ashby", phone: "9000022222", relation: "Sister" },
          rating: { average: 4.6, count: 5 },
          address: ADDRESS,
        },
      );
      await kyc(id, { driving_licence: "approved", vehicle_rc: "pending" });
      const last = new Date("2026-03-05T10:00:00Z");
      await orders(id, [
        ["delivered", 4_000, new Date("2026-03-01T10:00:00Z")],
        ["delivered", 6_000, last],
        ["cancelled", 0],
        ["on_the_way", 0],
      ]);
      await orders(null, [["delivered", 9_000]]);

      const res = await detail(id);
      assert.equal(res.status, 200, JSON.stringify(res.body));
      const { data } = res.body;
      assert.deepEqual(Object.keys(data).sort(), ["kyc", "rider", "stats", "user"]);
      assert.equal(data.user.id, id);
      assert.equal(data.user.name, "Wren Ashby");
      assert.equal(data.user.passwordHash, undefined);
      assert.equal(data.rider.zone, "Harbour");
      assert.deepEqual(data.rider.emergencyContact, { name: "Ida Ashby", phone: "9000022222", relation: "Sister" });
      assert.equal(data.rider.verification.status, "approved");
      assert.equal(data.rider.vehicleNumber, "KA01AB1234");
      assert.deepEqual(data.stats, {
        deliveries: 2,
        cancelled: 1,
        earningsPaise: 10_000,
        lastDeliveryAt: last.toISOString(),
        rating: { average: 4.6, count: 5 },
      });
      assert.deepEqual(data.kyc, { status: "incomplete", missing: ["id_proof"] });
    });

    it("shows null contact and zone, and the KYC states", async () => {
      const id = await rider();
      let res = await detail(id);
      assert.equal(res.body.data.rider.emergencyContact, null);
      assert.equal(res.body.data.rider.zone, null);
      assert.deepEqual(res.body.data.kyc, { status: "incomplete", missing: ["driving_licence", "vehicle_rc", "id_proof"] });
      await kyc(id, { ...ALL_DOCS, id_proof: "pending" });
      res = await detail(id);
      assert.deepEqual(res.body.data.kyc, { status: "pending", missing: [] });
      await KycDocument.updateOne({ user: id, kind: "id_proof" }, { status: "rejected" });
      assert.equal((await detail(id)).body.data.kyc.status, "rejected");
      await KycDocument.updateOne({ user: id, kind: "id_proof" }, { status: "approved" });
      assert.equal((await detail(id)).body.data.kyc.status, "verified");
    });

    it("404 for unknown and non-rider ids, 422 for malformed ones", async () => {
      const customer = await rider({ role: "customer" }, false);
      for (const id of [String(oid()), customer, admin.user.id]) {
        const res = await detail(id);
        assert.equal(res.status, 404);
        assert.equal(res.body.message, "Delivery partner not found");
      }
      const bad = await detail("nope");
      assert.equal(bad.status, 422);
      assert.deepEqual(fields(bad), ["id"]);
    });
  });

  describe("PATCH /admin/delivery-partner-accounts/:id", () => {
    const patch = (id, body, token = admin.token) => request(app).patch(`${BASE}/${id}`).set(auth(token)).send(body);

    it("edits account and profile details, drops the rest, and audits the changes", async () => {
      const id = await rider({ name: "Old Name", phone: "9000033333" });
      const res = await patch(id, {
        name: "  Juno Calder ",
        gender: "female",
        birthDate: "1995-04-02",
        address: { ...ADDRESS, area: "Mill End", extra: "dropped" },
        emergencyContact: { name: "Rhea Calder", phone: "+919000044444", relation: "Mother", other: "x" },
        vehicleType: "motorbike",
        zone: "  East Yard ",
        email: "new@example.test",
        phone: "9111111111",
        password: "Whatever-123",
        status: "suspended",
        role: "admin",
        verificationStatus: "rejected",
      });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.equal(res.body.message, "Delivery partner updated");
      const { user, rider: profile } = res.body.data;
      assert.equal(user.name, "Juno Calder");
      assert.equal(user.gender, "female");
      assert.equal(user.phone, "9000033333");
      assert.equal(user.status, "active");
      assert.equal(user.role, "delivery");
      assert.notEqual(user.email, "new@example.test");
      assert.deepEqual(profile.address, { ...ADDRESS, area: "Mill End" });
      assert.deepEqual(profile.emergencyContact, { name: "Rhea Calder", phone: "+919000044444", relation: "Mother" });
      assert.equal(profile.vehicleType, "motorbike");
      assert.equal(profile.zone, "East Yard");
      assert.equal(profile.verification.status, "approved");

      await flushAudits();
      const row = await AuditLog.findOne({ action: "rider.update" });
      assert.equal(row.resourceType, "user");
      assert.equal(String(row.resourceId), id);
      assert.equal(row.accountType, "delivery");
      assert.equal(row.description, "Updated delivery partner details");
      assert.deepEqual(row.changes.name, { from: "Old Name", to: "Juno Calder" });
      assert.deepEqual(row.changes["address.city"], { from: null, to: "Westford" });
      assert.deepEqual(row.changes["address.area"], { from: null, to: "Mill End" });
      assert.deepEqual(row.changes.emergencyContact, {
        from: null,
        to: { name: "Rhea Calder", phone: "+919000044444", relation: "Mother" },
      });
      assert.deepEqual(row.changes.vehicleType, { from: "scooter", to: "motorbike" });
      assert.deepEqual(row.changes.zone, { from: null, to: "East Yard" });
      assert.equal(row.changes.vehicleNumber, undefined);
    });

    it("clears the emergency contact and zone with null", async () => {
      const id = await rider({}, { zone: "Harbour", emergencyContact: { name: "Ida Ashby", phone: "9000022222" } });
      const res = await patch(id, { emergencyContact: null, zone: null });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.equal(res.body.data.rider.emergencyContact, null);
      assert.equal(res.body.data.rider.zone, null);
      await flushAudits();
      const row = await AuditLog.findOne({ action: "rider.update" });
      assert.deepEqual(row.changes.zone, { from: "Harbour", to: null });
      assert.deepEqual(row.changes.emergencyContact.to, null);
    });

    it("applies the reused rules", async () => {
      const id = await rider();
      const bad = async (body, field) => {
        const res = await patch(id, body);
        assert.equal(res.status, 422, JSON.stringify(body));
        assert.ok(fields(res).includes(field), `${field} in ${fields(res)}`);
      };
      await bad({ name: "x" }, "name");
      await bad({ birthDate: "02-04-1995" }, "birthDate");
      await bad({ gender: "robot" }, "gender");
      await bad({ address: { line1: "7 Quill Street" } }, "address.city");
      await bad({ address: { ...ADDRESS, postalCode: "!!" } }, "address.postalCode");
      await bad({ emergencyContact: { name: "Ida" } }, "emergencyContact.phone");
      await bad({ emergencyContact: { name: "I", phone: "9000022222" } }, "emergencyContact.name");
      await bad({ emergencyContact: { name: "Ida", phone: "12345" } }, "emergencyContact.phone");
      await bad({ emergencyContact: { name: "Ida", phone: "9000022222", relation: "x".repeat(41) } }, "emergencyContact.relation");
      await bad({ emergencyContact: "Ida" }, "emergencyContact");
      await bad({ vehicleType: "boat" }, "vehicleType");
      await bad({ vehicleNumber: "!!" }, "vehicleNumber");
      await bad({ zone: "z".repeat(61) }, "zone");
      const photo = await patch(id, { avatarUrl: "https://elsewhere.example.test/a.jpg" });
      assert.equal(photo.status, 400);
    });

    it("sends an approved vehicle RC back for review when the vehicle number changes", async () => {
      const id = await rider();
      await kyc(id);
      const res = await patch(id, { vehicleNumber: "ka 02 cd 5678" });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.equal(res.body.data.rider.vehicleNumber, "KA 02 CD 5678");
      assert.equal(res.body.data.rider.verification.status, "approved");
      assert.equal(res.body.data.kyc.status, "pending");
      assert.equal((await KycDocument.findOne({ user: id, kind: "vehicle_rc" })).status, "pending");
      assert.equal((await KycDocument.findOne({ user: id, kind: "driving_licence" })).status, "approved");
      await flushAudits();
      const row = await AuditLog.findOne({ action: "rider.update" });
      assert.deepEqual(row.changes.vehicleNumber, { from: "KA01AB1234", to: "KA 02 CD 5678" });
      assert.deepEqual(row.changes.reverified, ["vehicle_rc"]);
    });

    it("changes nothing without an audit row when the values are the same", async () => {
      const id = await rider({ name: "Same Rider" }, { zone: "Harbour" });
      const res = await patch(id, { name: "Same Rider", zone: "Harbour", vehicleNumber: "KA01AB1234", status: "blocked" });
      assert.equal(res.status, 200);
      assert.equal(res.body.data.user.status, "active");
      await flushAudits();
      assert.equal(await AuditLog.countDocuments({ action: "rider.update" }), 0);
    });

    it("needs riders:edit and a rider id", async () => {
      const id = await rider();
      const viewer = await operatorWith([P.RIDERS_VIEW]);
      assert.equal((await patch(id, { zone: "Harbour" }, viewer.token)).status, 403);
      const editor = await operatorWith([P.RIDERS_VIEW, P.RIDERS_EDIT]);
      assert.equal((await patch(id, { zone: "Harbour" }, editor.token)).status, 200);
      const customer = await rider({ role: "customer" }, false);
      assert.equal((await patch(customer, { zone: "Harbour" })).status, 404);
    });
  });

  describe("PATCH /admin/delivery-partner-accounts/:id/verification", () => {
    const verify = (id, body, token = admin.token) =>
      request(app).patch(`${BASE}/${id}/verification`).set(auth(token)).send(body);

    it("approves, rejects and asks for documents with the rider verification rules", async () => {
      const id = await rider({}, { verificationStatus: "pending" });
      const approved = await verify(id, { status: "approved" });
      assert.equal(approved.status, 200, JSON.stringify(approved.body));
      assert.equal(approved.body.message, "Delivery partner approved");
      assert.equal(approved.body.data.rider.verification.status, "approved");
      assert.ok(await Notification.exists({ user: id, type: "rider.verified" }));

      const asked = await verify(id, { status: "resubmission_requested", reason: "Licence photo is blurred" });
      assert.equal(asked.status, 200);
      assert.equal(asked.body.message, "Asked for documents");
      assert.equal(asked.body.data.rider.verification.reason, "Licence photo is blurred");

      const rejected = await verify(id, { status: "rejected", reason: "Documents do not match" });
      assert.equal(rejected.body.message, "Delivery partner rejected");
      // rejected -> resubmission_requested is not an allowed move.
      assert.equal((await verify(id, { status: "resubmission_requested", reason: "Try again" })).status, 409);

      await flushAudits();
      const rows = await AuditLog.find({ action: "rider.verification" }).sort({ createdAt: 1 });
      assert.equal(rows.length, 3);
      assert.deepEqual(rows[0].changes, { verificationStatus: { from: "pending", to: "approved" } });
      assert.equal(rows[2].reason, "Documents do not match");
      assert.equal(rows[2].accountType, "delivery");
    });

    it("keeps the KYC check, and the same status is a no-op", async () => {
      useRiderKyc(true);
      const id = await rider({}, { verificationStatus: "pending" });
      const blocked = await verify(id, { status: "approved" });
      assert.equal(blocked.status, 409);
      assert.equal(blocked.body.error.code, "KYC_INCOMPLETE");

      const same = await verify(id, { status: "pending" });
      assert.equal(same.status, 422); // pending is not a decision
      const approvedId = await rider();
      const again = await verify(approvedId, { status: "approved" });
      assert.equal(again.status, 200);
      await flushAudits();
      assert.equal(await AuditLog.countDocuments({ action: "rider.verification" }), 0);
    });

    it("needs a 3-500 character reason to reject or ask for documents", async () => {
      const id = await rider({}, { verificationStatus: "pending" });
      for (const body of [
        { status: "rejected" },
        { status: "resubmission_requested", reason: "no" },
        { status: "rejected", reason: "x".repeat(501) },
      ]) {
        const res = await verify(id, body);
        assert.equal(res.status, 422, JSON.stringify(body));
        assert.deepEqual(fields(res), ["reason"]);
      }
    });

    it("needs riders:approve", async () => {
      const id = await rider({}, { verificationStatus: "pending" });
      const editor = await operatorWith([P.RIDERS_VIEW, P.RIDERS_EDIT, P.RIDERS_STATUS]);
      assert.equal((await verify(id, { status: "approved" }, editor.token)).status, 403);
      const approver = await operatorWith([P.RIDERS_VIEW, P.RIDERS_APPROVE]);
      assert.equal((await verify(id, { status: "approved" }, approver.token)).status, 200);
    });
  });

  describe("availability", () => {
    const offline = (id, body, token = admin.token) =>
      request(app).patch(`${BASE}/${id}/availability`).set(auth(token)).send(body);
    const historyOf = (id, query = {}) =>
      request(app).get(`${BASE}/${id}/availability`).query(query).set(auth(admin.token));

    it("takes an online rider offline with a reason, records it and audits it", async () => {
      const id = await rider({}, { isOnline: true });
      const res = await offline(id, { isOnline: false, reason: "Reported unsafe riding" });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.equal(res.body.message, "Delivery partner taken offline");
      assert.equal(res.body.data.rider.isOnline, false);
      const rows = (await historyOf(id)).body.data.items;
      assert.equal(rows.length, 1);
      assert.deepEqual({ ...rows[0], at: undefined }, {
        isOnline: false, at: undefined, source: "admin", reason: "Reported unsafe riding",
      });
      await flushAudits();
      const row = await AuditLog.findOne({ action: "rider.availability" });
      assert.deepEqual(row.changes, { isOnline: { from: true, to: false } });
      assert.equal(row.reason, "Reported unsafe riding");
      assert.equal(row.accountType, "delivery");

      // Already offline: nothing happens.
      const again = await offline(id, { isOnline: false, reason: "Reported unsafe riding" });
      assert.equal(again.status, 200);
      assert.equal(await RiderAvailabilityLog.countDocuments({ rider: id }), 1);
      await flushAudits();
      assert.equal(await AuditLog.countDocuments({ action: "rider.availability" }), 1);
    });

    it("only takes riders offline, with a reason", async () => {
      const id = await rider({}, { isOnline: true });
      const on = await offline(id, { isOnline: true });
      assert.equal(on.status, 422);
      assert.deepEqual(fields(on), ["isOnline"]);
      assert.equal(on.body.error.details[0].message, "Only the rider can go online");
      for (const body of [{ isOnline: false }, { isOnline: false, reason: "no" }]) {
        const res = await offline(id, body);
        assert.equal(res.status, 422);
        assert.deepEqual(fields(res), ["reason"]);
      }
      assert.deepEqual(fields(await offline(id, { reason: "Some reason" })), ["isOnline"]);
    });

    it("refuses while the rider carries an order", async () => {
      const id = await rider({}, { isOnline: true, activeOrder: oid() });
      const res = await offline(id, { isOnline: false, reason: "Reported unsafe riding" });
      assert.equal(res.status, 409);
      assert.equal(res.body.message, "The rider is on a delivery");
      assert.equal((await DeliveryPartner.findOne({ user: id })).isOnline, true);
      assert.equal(await RiderAvailabilityLog.countDocuments(), 0);
    });

    it("passes an open offer on", async () => {
      const id = await rider({}, { isOnline: true });
      const orderId = oid();
      await Order.collection.insertOne({
        _id: orderId, orderNumber: "BB-T-OFFER", customer: oid(), restaurant: oid(), restaurantSnapshot: { name: "Fictional" },
        status: "ready_for_pickup", pricing: { totalPaise: 1 },
        offer: { partner: new mongoose.Types.ObjectId(id), expiresAt: new Date(Date.now() + 60_000) },
        createdAt: new Date(), updatedAt: new Date(),
      });
      await DeliveryPartner.updateOne({ user: id }, { currentOffer: orderId });
      const res = await offline(id, { isOnline: false, reason: "Reported unsafe riding" });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      const profile = await DeliveryPartner.findOne({ user: id });
      assert.equal(profile.currentOffer, null);
      const order = await Order.findById(orderId);
      assert.equal(order.offer?.partner, undefined);
      assert.ok(order.declinedBy.map(String).includes(id));
    });

    it("records the rider's own toggle, admin actions and system changes, newest first", async () => {
      const { token, res } = await registerUser(app, { role: "delivery" });
      const id = res.body.data.user.id;
      const me = (body) => request(app).patch("/api/v1/delivery/me/availability").set(auth(token)).send(body);
      await request(app).put("/api/v1/delivery/me/vehicle").set(auth(token)).send({ vehicleType: "bicycle" });
      assert.equal((await me({ isOnline: true, ...NEAR })).status, 200);
      assert.equal((await me({ isOnline: true, ...NEAR })).status, 200); // no change, no row
      assert.equal((await me({ isOnline: false })).status, 200);
      await me({ isOnline: true, ...NEAR });
      await offline(id, { isOnline: false, reason: "Reported unsafe riding" });
      await me({ isOnline: true, ...NEAR });
      const suspended = await request(app)
        .patch(`/api/v1/admin/users/${id}/status`)
        .set(auth(admin.token))
        .send({ status: "suspended", reason: "Fictional investigation" });
      assert.equal(suspended.status, 200, JSON.stringify(suspended.body));

      const page = await historyOf(id, { limit: 3 });
      assert.equal(page.status, 200);
      assert.deepEqual(page.body.data.pagination, { page: 1, limit: 3, total: 6, totalPages: 2 });
      const all = (await historyOf(id)).body.data.items;
      assert.deepEqual(
        all.map((r) => [r.isOnline, r.source, r.reason]),
        [
          [false, "system", "Account suspended"],
          [true, "rider", null],
          [false, "admin", "Reported unsafe riding"],
          [true, "rider", null],
          [false, "rider", null],
          [true, "rider", null],
        ],
      );
      assert.deepEqual(Object.keys(all[0]).sort(), ["at", "isOnline", "reason", "source"]);
    });

    it("records the system taking riders offline after withdrawn verification and missed offers", async () => {
      const id = await rider({}, { isOnline: true });
      await request(app)
        .patch(`${BASE}/${id}/verification`)
        .set(auth(admin.token))
        .send({ status: "resubmission_requested", reason: "Licence expired" });
      assert.equal((await DeliveryPartner.findOne({ user: id })).isOnline, false);

      const other = await rider({}, { isOnline: true });
      const orderId = oid();
      await Order.collection.insertOne({
        _id: orderId, orderNumber: "BB-T-MISSED", customer: oid(), restaurant: oid(), restaurantSnapshot: { name: "Fictional" },
        status: "ready_for_pickup", pricing: { totalPaise: 1 },
        offer: { partner: new mongoose.Types.ObjectId(other), expiresAt: new Date(Date.now() - 1000) },
        createdAt: new Date(), updatedAt: new Date(),
      });
      await DeliveryPartner.updateOne({ user: other }, { currentOffer: orderId });
      await sweep(new Date());

      const rows = await RiderAvailabilityLog.find().sort({ at: 1 }).lean();
      assert.deepEqual(
        rows.map((r) => [String(r.rider), r.isOnline, r.source, r.reason]),
        [
          [id, false, "system", "Documents requested again"],
          [other, false, "system", "Did not answer a delivery offer"],
        ],
      );
    });

    it("keeps history rows append-only", async () => {
      const id = await rider();
      await RiderAvailabilityLog.create({ rider: id, isOnline: true, source: "rider" });
      await assert.rejects(RiderAvailabilityLog.updateOne({ rider: id }, { isOnline: false }));
      await assert.rejects(RiderAvailabilityLog.deleteMany({ rider: id }));
    });

    it("needs riders:status to take offline and riders:view for the history", async () => {
      const id = await rider({}, { isOnline: true });
      const viewer = await operatorWith([P.RIDERS_VIEW, P.RIDERS_EDIT]);
      assert.equal((await offline(id, { isOnline: false, reason: "Reported unsafe riding" }, viewer.token)).status, 403);
      assert.equal((await request(app).get(`${BASE}/${id}/availability`).set(auth(viewer.token))).status, 200);
      const nobody = await operatorWith([P.RIDERS_STATUS]);
      assert.equal((await request(app).get(`${BASE}/${id}/availability`).set(auth(nobody.token))).status, 403);
      const status = await operatorWith([P.RIDERS_VIEW, P.RIDERS_STATUS]);
      assert.equal((await offline(id, { isOnline: false, reason: "Reported unsafe riding" }, status.token)).status, 200);
      assert.equal((await historyOf(String(oid()))).status, 404);
    });
  });

  describe("rider filters on other admin lists", () => {
    const get = (path, query) => request(app).get(`/api/v1/admin${path}`).query(query).set(auth(admin.token));

    it("orders", async () => {
      const a = await rider();
      const b = await rider();
      await orders(a, [["delivered", 1], ["on_the_way", 0]]);
      await orders(b, [["delivered", 1]]);
      const res = await get("/orders", { rider: a });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.equal(res.body.data.items.length, 2);
      assert.deepEqual(res.body.data.counts, { delivered: 1, on_the_way: 1 });
      assert.deepEqual(fields(await get("/orders", { rider: "1" })), ["rider"]);
    });

    it("payouts", async () => {
      const a = await rider();
      const b = await rider();
      const payout = (r) => Payout.create({ type: "rider", payee: r, payeeName: "Fictional", createdBy: admin.user.id });
      const mine = await payout(a);
      await payout(b);
      const res = await get("/finance/payouts", { rider: a });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.deepEqual(res.body.data.items.map((p) => p.id), [String(mine._id)]);
      assert.deepEqual(fields(await get("/finance/payouts", { rider: "x" })), ["rider"]);
    });

    it("reviewed orders", async () => {
      const a = await rider();
      const b = await rider();
      const review = async (r) => {
        const order = oid();
        await Review.collection.insertOne({
          target: "rider", customer: oid(), customerName: "Nell Varga", order, orderNumber: `BB-R-${order}`,
          restaurant: oid(), deliveryPartner: new mongoose.Types.ObjectId(r), rating: 5, comment: "",
          status: "published", openReports: 0, createdAt: new Date(), updatedAt: new Date(),
        });
        return String(order);
      };
      const reviewed = await review(a);
      await review(b);
      const res = await get("/reviews/orders", { rider: a });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.deepEqual(res.body.data.items.map((o) => o.order), [reviewed]);
      assert.deepEqual(fields(await get("/reviews/orders", { rider: "x" })), ["rider"]);
    });
  });
});
