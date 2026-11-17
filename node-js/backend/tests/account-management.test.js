// Account management, phase 1 (same as the Django tests): account statuses with reasons, per-person
// effective permissions (role presets, custom lists, operators), the permission catalogue, audit
// rows with changes / reason / accountType, and the admin's gender and photo edit.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import http from "node:http";
import { after, before, beforeEach, describe, it } from "node:test";
import { io as connect } from "socket.io-client";
import { env } from "../config/env.js";
import {
  PERMISSIONS,
  effectivePermissions,
  hasPermission,
  permissionsFor,
} from "../config/permissions.js";
import { AuditLog } from "../models/audit-log.model.js";
import { DeliveryPartner } from "../models/delivery-partner.model.js";
import { Notification } from "../models/notification.model.js";
import { Session } from "../models/session.model.js";
import { User } from "../models/user.model.js";
import { flushAudits } from "../services/audit.service.js";
import { notifyAdmins } from "../services/notification.service.js";
import { staffList } from "../services/support.service.js";
import { attachRealtime } from "../sockets/index.js";
import { setRealtimeServer } from "../sockets/events.js";
import {
  PASSWORD,
  buildApp,
  createAndLogin,
  request,
  resetDb,
  setupTestDb,
  teardownTestDb,
} from "./helpers.js";

const P = PERMISSIONS;
const auth = (token) => ({ Authorization: `Bearer ${token}` });
const PDF = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");

describe("account management", () => {
  let app;
  let admin;
  let customer;
  let rider;
  let partner;

  before(async () => {
    await setupTestDb();
    app = buildApp();
  });
  after(teardownTestDb);

  beforeEach(async () => {
    await resetDb();
    admin = await createAndLogin(app, "admin");
    customer = await createAndLogin(app, "customer");
    rider = await createAndLogin(app, "delivery");
    partner = await createAndLogin(app, "restaurant");
  });

  const as = (token) => ({
    get: (url) => request(app).get(`/api/v1${url}`).set(auth(token)),
    patch: (url, body) => request(app).patch(`/api/v1${url}`).set(auth(token)).send(body),
    post: (url, body) => request(app).post(`/api/v1${url}`).set(auth(token)).send(body),
  });
  const login = (email, password = PASSWORD) =>
    request(app).post("/api/v1/auth/login").send({ email, password });

  /** Signs in the seeded operator after giving them `permissions` (null: the empty preset). */
  async function operatorWith(permissions) {
    const op = await createAndLogin(app, "operator");
    await User.updateOne({ _id: op.user.id }, { customPermissions: permissions });
    return op;
  }

  describe("account statuses", () => {
    for (const status of ["inactive", "suspended", "blocked"]) {
      it(`${status}: blocks sign-in, ends every session, stores the reason`, async () => {
        const res = await as(admin.token).patch(`/admin/users/${customer.user.id}/status`, {
          status,
          reason: "  Requested by the account holder  ",
        });
        assert.equal(res.status, 200, res.body.message);
        const { user } = res.body.data;
        assert.equal(user.status, status);
        assert.equal(user.statusReason, "Requested by the account holder");
        assert.ok(user.statusChangedAt);

        assert.equal((await as(customer.token).get("/auth/me")).status, 401, "old token refused");
        const active = await Session.countDocuments({ user: customer.user.id, revokedAt: null });
        assert.equal(active, 0, "refresh sessions revoked");
        const signIn = await login(customer.user.email);
        assert.equal(signIn.status, 403);
        assert.match(signIn.body.message, new RegExp(status));

        const back = await as(admin.token).patch(`/admin/users/${customer.user.id}/status`, {
          status: "active",
        });
        assert.equal(back.status, 200);
        assert.equal(back.body.data.user.statusReason, undefined, "reason cleared");
        assert.ok(back.body.data.user.statusChangedAt);
        assert.equal((await login(customer.user.email)).status, 200);
      });
    }

    it("needs a 3-500 character reason for every status but active", async () => {
      const set = (body) => as(admin.token).patch(`/admin/users/${customer.user.id}/status`, body);
      for (const body of [
        { status: "suspended" },
        { status: "blocked", reason: "  ab  " },
        { status: "inactive", reason: "x".repeat(501) },
        { status: "inactive", reason: 42 },
      ]) {
        const res = await set(body);
        assert.equal(res.status, 422, JSON.stringify(body));
        assert.equal(res.body.error.details[0].field, "reason");
      }
      assert.equal((await set({ status: "paused", reason: "Not a status" })).status, 422);
      assert.equal((await set({ status: "active" })).status, 200, "optional when reactivating");
    });

    it("treats the current status as a no-op", async () => {
      const set = () =>
        as(admin.token).patch(`/admin/users/${customer.user.id}/status`, {
          status: "suspended",
          reason: "Chargeback investigation",
        });
      await set();
      const first = await User.findById(customer.user.id).select("+tokenVersion").lean();
      const again = await set();
      assert.equal(again.status, 200);
      const second = await User.findById(customer.user.id).select("+tokenVersion").lean();
      assert.equal(second.tokenVersion, first.tokenVersion);
      assert.deepEqual(second.statusChangedAt, first.statusChangedAt);
      await flushAudits();
      assert.equal(await AuditLog.countDocuments({ action: "user.status" }), 1, "audited once");
    });

    it("splits <kind>:status (active, inactive) from accounts:suspend (suspended, blocked)", async () => {
      const support = await createAndLogin(app, "support_admin"); // customers:view, customers:edit
      const url = `/admin/users/${customer.user.id}/status`;
      assert.equal(
        (await as(support.token).patch(url, { status: "inactive", reason: "Closed on request" })).status,
        403,
      );

      const statusOnly = await operatorWith([P.CUSTOMERS_VIEW, P.CUSTOMERS_STATUS]);
      assert.equal(
        (await as(statusOnly.token).patch(url, { status: "suspended", reason: "Abusive messages" })).status,
        403,
      );
      assert.equal(
        (await as(statusOnly.token).patch(url, { status: "inactive", reason: "Closed on request" })).status,
        200,
      );

      const suspender = await operatorWith([P.CUSTOMERS_VIEW, P.RIDERS_VIEW, P.ACCOUNTS_SUSPEND]);
      assert.equal(
        (await as(suspender.token).patch(url, { status: "blocked", reason: "Fraudulent orders" })).status,
        200,
      );
      assert.equal(
        (await as(suspender.token).patch(url, { status: "active" })).status,
        403,
        "reactivating needs customers:status",
      );
      // accounts:suspend covers only the kinds the caller may view.
      const noPartners = await as(suspender.token).patch(`/admin/users/${partner.user.id}/status`, {
        status: "suspended",
        reason: "Hygiene complaints",
      });
      assert.equal(noPartners.status, 403);
    });

    it("takes a rider offline on any non-active status, from either endpoint", async () => {
      await DeliveryPartner.updateOne({ user: rider.user.id }, { isOnline: true }, { upsert: true });
      let res = await as(admin.token).patch(`/admin/users/${rider.user.id}/status`, {
        status: "inactive",
        reason: "Left the fleet",
      });
      assert.equal(res.status, 200, res.body.message);
      assert.equal(res.body.message, "User deactivated");
      assert.equal((await DeliveryPartner.findOne({ user: rider.user.id })).isOnline, false);

      await as(admin.token).patch(`/admin/users/${rider.user.id}/status`, { status: "active" });
      await DeliveryPartner.updateOne({ user: rider.user.id }, { isOnline: true });
      const url = `/admin/delivery-partners/${rider.user.id}/status`;
      assert.equal((await as(admin.token).patch(url, { status: "blocked" })).status, 422, "reason needed");
      res = await as(admin.token).patch(url, { status: "blocked", reason: "Identity fraud" });
      assert.equal(res.status, 200, res.body.message);
      assert.equal(res.body.message, "Rider blocked");
      assert.equal(res.body.data.user.statusReason, "Identity fraud");
      assert.equal((await DeliveryPartner.findOne({ user: rider.user.id })).isOnline, false);
      assert.equal((await login(rider.user.email)).status, 403);

      await flushAudits();
      const row = await AuditLog.findOne({ action: "rider.status" }).lean();
      assert.deepEqual(row.changes, { status: { from: "active", to: "blocked" } });
      assert.equal(row.reason, "Identity fraud");
      assert.equal(row.accountType, "delivery");
    });

    it("accepts every status on admin accounts with the same reason rule", async () => {
      const finance = await createAndLogin(app, "finance_admin");
      const url = `/admin/admins/${finance.user.id}/status`;
      assert.equal((await as(admin.token).patch(url, { status: "blocked" })).status, 422);
      const res = await as(admin.token).patch(url, { status: "blocked", reason: "Shared their password" });
      assert.equal(res.status, 200);
      assert.equal(res.body.data.user.status, "blocked");
      assert.equal((await login(finance.user.email)).status, 403);
      await flushAudits();
      const row = await AuditLog.findOne({ action: "admin.status" }).lean();
      assert.equal(row.accountType, "admin");
      assert.deepEqual(row.changes, { status: { from: "active", to: "blocked" } });
    });

    it("cannot change your own status", async () => {
      const res = await as(admin.token).patch(`/admin/admins/${admin.user.id}/status`, {
        status: "inactive",
        reason: "Going on leave",
      });
      assert.equal(res.status, 400);
    });
  });

  describe("effective permissions", () => {
    it("are the preset, the custom list, or everything for the super admin", () => {
      assert.deepEqual(
        effectivePermissions({ role: "finance_admin" }).sort(),
        [...permissionsFor("finance_admin")].sort(),
      );
      assert.deepEqual(effectivePermissions({ role: "operator" }), []);
      assert.deepEqual(
        effectivePermissions({ role: "finance_admin", customPermissions: [P.ORDERS_VIEW] }),
        [P.ORDERS_VIEW],
      );
      assert.deepEqual(effectivePermissions({ role: "support_admin", customPermissions: [] }), []);
      const superAdmin = effectivePermissions({ role: "admin", customPermissions: [] });
      assert.ok(superAdmin.includes(P.ADMINS_MANAGE) && superAdmin.includes(P.CUSTOMERS_VIEW));
      assert.ok(!hasPermission({ role: "operator", customPermissions: [P.ADMINS_MANAGE] }, P.ADMINS_MANAGE));
      assert.deepEqual(effectivePermissions({ role: "customer", customPermissions: [P.ORDERS_VIEW] }), []);
      assert.ok(permissionsFor("operations_admin").includes(P.RIDERS_KYC));
      assert.ok(permissionsFor("support_admin").includes(P.CUSTOMERS_EDIT));
      assert.ok(!Object.values(P).includes("users:manage"));
    });

    it("an operator with no permissions gets 403 everywhere", async () => {
      const op = await createAndLogin(app, "operator");
      assert.deepEqual(op.user.permissions, []);
      for (const url of [
        "/admin/users",
        `/admin/users/${customer.user.id}`,
        "/admin/orders",
        "/admin/audit-logs",
        "/admin/admins",
        "/admin/delivery-partners",
        "/admin/finance/dashboard",
      ])
        assert.equal((await as(op.token).get(url)).status, 403, url);
    });

    it("an operator with customers:view sees customers only", async () => {
      const op = await operatorWith([P.CUSTOMERS_VIEW]);
      const list = await as(op.token).get("/admin/users?limit=100");
      assert.equal(list.status, 200);
      const roles = new Set(list.body.data.items.map((u) => u.role));
      assert.deepEqual([...roles], ["customer"]);
      assert.equal((await as(op.token).get("/admin/users?role=customer")).status, 200);
      assert.equal((await as(op.token).get("/admin/users?role=delivery")).status, 403);
      assert.equal((await as(op.token).get(`/admin/users/${rider.user.id}`)).status, 403);
      assert.equal((await as(op.token).get(`/admin/users/${rider.user.id}/logins`)).status, 403);
      assert.equal((await as(op.token).get(`/admin/users/${customer.user.id}`)).status, 200);
      assert.equal((await as(op.token).get(`/admin/users/${customer.user.id}/logins`)).status, 200);
      assert.equal(
        (await as(op.token).get("/admin/users/0123456789abcdef01234567")).status,
        404,
        "unknown account: 404",
      );
      assert.equal(
        (await as(op.token).patch(`/admin/users/${customer.user.id}`, { name: "Mira Kestrel" })).status,
        403,
        "editing needs customers:edit",
      );
      assert.equal(
        (await as(op.token).post(`/admin/users/${customer.user.id}/addresses`, {})).status,
        422,
        "validation runs first",
      );
    });

    it("are set by the super admin: operators, custom lists, reset to the preset", async () => {
      const create = await as(admin.token).post("/admin/admins", {
        name: "Ivo Lantern",
        email: "ivo.lantern@example.com",
        password: "Str0ng-pass-42",
        role: "operator",
        permissions: [P.ORDERS_VIEW, P.CUSTOMERS_VIEW, P.ORDERS_VIEW],
      });
      assert.equal(create.status, 201, create.body.message);
      const created = create.body.data.user;
      assert.equal(created.role, "operator");
      assert.deepEqual(created.permissions, [P.CUSTOMERS_VIEW, P.ORDERS_VIEW]);
      // The effective list, and the person's own list for the permission editor.
      assert.deepEqual([...created.customPermissions].sort(), [P.CUSTOMERS_VIEW, P.ORDERS_VIEW].sort());

      const op = await login("ivo.lantern@example.com", "Str0ng-pass-42");
      assert.equal(op.status, 200, op.body.message);
      const token = op.body.data.accessToken;
      assert.equal((await as(token).get("/admin/orders")).status, 200);
      assert.equal((await as(token).get("/admin/delivery-partners")).status, 403);

      // A change applies on the operator's next request, without signing them out.
      const update = await as(admin.token).patch(`/admin/admins/${created.id}`, {
        permissions: [P.RIDERS_MANAGE],
      });
      assert.equal(update.status, 200, update.body.message);
      assert.deepEqual(update.body.data.user.permissions, [P.RIDERS_MANAGE]);
      assert.equal((await as(token).get("/admin/delivery-partners")).status, 200);
      assert.equal((await as(token).get("/admin/orders")).status, 403);

      await flushAudits();
      const row = await AuditLog.findOne({ action: "admin.update" }).lean();
      assert.deepEqual(row.changes, {
        permissions: { from: [P.CUSTOMERS_VIEW, P.ORDERS_VIEW], to: [P.RIDERS_MANAGE] },
      });
      assert.equal(row.accountType, "admin");
      assert.equal(row.resourceId, created.id);

      // Role change to support with null: back to the support preset.
      const reset = await as(admin.token).patch(`/admin/admins/${created.id}`, {
        role: "support_admin",
        permissions: null,
      });
      assert.equal(reset.status, 200);
      assert.deepEqual(
        [...reset.body.data.user.permissions].sort(),
        [...permissionsFor("support_admin")].sort(),
      );
      await flushAudits();
      const roleRow = await AuditLog.findOne({ action: "admin.update" }).sort({ createdAt: -1, _id: -1 }).lean();
      assert.deepEqual(roleRow.changes.role, { from: "operator", to: "support_admin" });
      assert.ok(roleRow.changes.permissions);
      const stored = await User.findById(created.id).lean();
      assert.equal(stored.customPermissions, undefined);
    });

    it("refuses admins:manage and unknown keys in a custom list", async () => {
      const support = await createAndLogin(app, "support_admin");
      for (const permissions of [[P.ADMINS_MANAGE], ["orders:view", "users:manage"], "orders:view"]) {
        const res = await as(admin.token).patch(`/admin/admins/${support.user.id}`, { permissions });
        assert.equal(res.status, 422, JSON.stringify(permissions));
        assert.equal(res.body.error.details[0].field, "permissions");
      }
      const res = await as(admin.token).post("/admin/admins", {
        name: "Ivo Lantern",
        email: "ivo.lantern@example.com",
        password: "Str0ng-pass-42",
        role: "operator",
        permissions: [P.ADMINS_MANAGE],
      });
      assert.equal(res.status, 422);
    });

    it("notifies and lists admins by effective permission", async () => {
      const op = await operatorWith([P.CUSTOMERS_VIEW, P.SUPPORT_MANAGE]);
      const support = await createAndLogin(app, "support_admin");
      await User.updateOne({ _id: support.user.id }, { customPermissions: [P.ORDERS_VIEW] });
      await notifyAdmins({ type: "user.restaurant", title: "New restaurant partner: Copper Kettle" }, P.CUSTOMERS_VIEW);
      const reached = (await Notification.find().lean()).map((n) => String(n.user)).sort();
      assert.deepEqual(reached, [admin.user.id, op.user.id].sort(), "custom list counts, preset does not");

      const staff = (await staffList()).items.map((u) => u.id);
      assert.ok(staff.includes(op.user.id), "operator with support:manage can take tickets");
      assert.ok(!staff.includes(support.user.id), "support admin whose list lacks it cannot");
    });

    it("signup notification for restaurant partners uses customers:view", async () => {
      const support = await createAndLogin(app, "support_admin"); // customers:view by preset
      const res = await request(app).post("/api/v1/auth/register").send({
        name: "Copper Kettle",
        email: "copper.kettle@example.com",
        password: PASSWORD,
        role: "restaurant",
      });
      assert.equal(res.status, 201, res.body.message);
      assert.ok(await Notification.exists({ user: support.user.id, type: "user.restaurant" }));
    });

    it("KYC review accepts restaurants:kyc as well as restaurants:manage", async () => {
      const upload = await request(app)
        .post("/api/v1/kyc/documents")
        .set(auth(partner.token))
        .field("kind", "fssai_licence")
        .field("number", "12345678901234")
        .attach("file", PDF, "doc.pdf");
      assert.equal(upload.status, 201, JSON.stringify(upload.body));
      const doc = upload.body.data.document;

      const kyc = await operatorWith([P.RESTAURANTS_VIEW, P.RESTAURANTS_KYC]);
      assert.equal((await as(kyc.token).get(`/admin/kyc/partners/${partner.user.id}`)).status, 200);
      assert.equal((await as(kyc.token).get(`/admin/kyc/partners/${rider.user.id}`)).status, 404, "riders need riders:kyc");
      const review = await as(kyc.token).patch(`/admin/kyc/documents/${doc.id}`, { status: "approved" });
      assert.equal(review.status, 200, review.body.message);

      const none = await operatorWith([P.RESTAURANTS_VIEW]);
      assert.equal((await as(none.token).get(`/admin/kyc/partners/${partner.user.id}`)).status, 403);
    });
  });

  describe("realtime admin room", () => {
    let server;
    let io;
    let url;
    const sockets = [];
    before(async () => {
      server = http.createServer(app);
      io = attachRealtime(server);
      await new Promise((resolve) => server.listen(0, resolve));
      url = `http://localhost:${server.address().port}`;
    });
    after(() => {
      sockets.forEach((s) => s.close());
      io.close();
      setRealtimeServer(null);
    });

    const join = (token) =>
      new Promise((resolve, reject) => {
        const socket = connect(url, { auth: { token }, transports: ["websocket"], reconnection: false });
        sockets.push(socket);
        socket.on("connect", () => resolve(socket));
        socket.on("connect_error", reject);
      });

    it("joins the admins room by effective permission (orders:view)", async () => {
      const watcher = await operatorWith([P.ORDERS_VIEW]);
      const watching = await join(watcher.token);
      await new Promise((r) => setTimeout(r, 100));
      let members = (await io.in("admins").fetchSockets()).map((s) => s.data.user.id);
      assert.deepEqual(members, [watcher.user.id]);
      watching.close();

      const blind = await operatorWith([P.CUSTOMERS_VIEW]);
      await join(blind.token);
      await new Promise((r) => setTimeout(r, 100));
      members = (await io.in("admins").fetchSockets()).map((s) => s.data.user.id);
      assert.ok(!members.includes(blind.user.id));
    });
  });

  describe("permission catalogue", () => {
    it("lists every key with label and group, and the editor presets", async () => {
      const res = await as(admin.token).get("/admin/admins/permissions");
      assert.equal(res.status, 200);
      const { permissions, presets } = res.body.data;
      assert.deepEqual(
        permissions.map((p) => p.key).sort(),
        Object.values(P).sort(),
      );
      for (const p of permissions) {
        assert.deepEqual(Object.keys(p).sort(), ["group", "key", "label"]);
        assert.ok(p.label.length > 3);
      }
      assert.deepEqual(
        [...new Set(permissions.map((p) => p.group))].sort(),
        [
          "Accounts",
          "Admin",
          "Catalog & marketing",
          "Customers",
          "Delivery partners",
          "Finance",
          "Orders & operations",
          "Restaurants",
          "Rewards",
          "Support",
        ].sort(),
      );
      assert.deepEqual(presets.map((p) => p.key), ["support", "restaurant", "delivery", "kyc", "finance"]);
      assert.deepEqual(presets.find((p) => p.key === "kyc").permissions, [
        P.RESTAURANTS_VIEW,
        P.RIDERS_VIEW,
        P.RESTAURANTS_KYC,
        P.RIDERS_KYC,
      ]);
      for (const p of presets) assert.deepEqual(Object.keys(p).sort(), ["key", "label", "permissions"]);

      const ops = await createAndLogin(app, "operations_admin");
      assert.equal((await as(ops.token).get("/admin/admins/permissions")).status, 403);
    });
  });

  describe("audit log", () => {
    it("records changes, reason and account type, and filters by them", async () => {
      await as(admin.token).patch(`/admin/users/${customer.user.id}/status`, {
        status: "suspended",
        reason: "Chargeback investigation",
      });
      await as(admin.token).patch(`/admin/users/${customer.user.id}`, { name: "Mira Kestrel", gender: "female" });
      await as(admin.token).patch(`/admin/users/${rider.user.id}/status`, {
        status: "inactive",
        reason: "Left the fleet",
      });
      await flushAudits();

      const status = await AuditLog.findOne({ action: "user.status", resourceId: customer.user.id }).lean();
      assert.deepEqual(status.changes, { status: { from: "active", to: "suspended" } });
      assert.equal(status.reason, "Chargeback investigation");
      assert.equal(status.accountType, "customer");

      const update = await AuditLog.findOne({ action: "user.update" }).lean();
      assert.deepEqual(update.changes, {
        name: { from: customer.user.name, to: "Mira Kestrel" },
        gender: { from: null, to: "female" },
      });
      assert.equal(update.accountType, "customer");
      assert.equal(update.reason, "");

      const byType = await as(admin.token).get("/admin/audit-logs?accountType=delivery");
      assert.equal(byType.status, 200);
      assert.deepEqual(byType.body.data.items.map((i) => i.action), ["user.status"]);
      const item = byType.body.data.items[0];
      assert.equal(item.accountType, "delivery");
      assert.equal(item.reason, "Left the fleet");
      assert.deepEqual(item.changes, { status: { from: "active", to: "inactive" } });

      const byId = await as(admin.token).get(`/admin/audit-logs?resourceId=${customer.user.id}`);
      assert.deepEqual(byId.body.data.items.map((i) => i.action).sort(), ["user.status", "user.update"]);
      assert.equal((await as(admin.token).get("/admin/audit-logs?accountType=robot")).status, 422);
    });

    it("keeps rows append-only", async () => {
      await as(admin.token).patch(`/admin/users/${customer.user.id}`, { name: "Mira Kestrel" });
      await flushAudits();
      await assert.rejects(AuditLog.updateOne({}, { reason: "edited" }), /AUDIT_IMMUTABLE/);
      await assert.rejects(AuditLog.deleteMany({}), /AUDIT_IMMUTABLE/);
    });
  });

  describe("gender and photo", () => {
    const photo = () => `${env.publicBaseUrl}/uploads/images/${crypto.randomUUID()}.png`;

    it("lets an admin set and clear gender and photo", async () => {
      const url = `/admin/users/${customer.user.id}`;
      const pic = photo();
      let res = await as(admin.token).patch(url, { gender: "prefer_not_to_say", avatarUrl: pic });
      assert.equal(res.status, 200, res.body.message);
      assert.equal(res.body.data.user.gender, "prefer_not_to_say");
      assert.equal(res.body.data.user.avatarUrl, pic);

      res = await as(admin.token).patch(url, { gender: "unknown" });
      assert.equal(res.status, 422);
      assert.equal(res.body.error.details[0].field, "gender");
      res = await as(admin.token).patch(url, { avatarUrl: "https://elsewhere.example/face.png" });
      assert.equal(res.status, 400);
      assert.equal(res.body.message, "Upload the photo first");

      res = await as(admin.token).patch(url, { gender: null, avatarUrl: null, email: "x@example.com" });
      assert.equal(res.status, 200);
      assert.equal(res.body.data.user.gender, undefined);
      assert.equal(res.body.data.user.avatarUrl, undefined);
      assert.equal(res.body.data.user.email, customer.user.email);

      await flushAudits();
      const rows = await AuditLog.find({ action: "user.update" }).sort({ createdAt: 1, _id: 1 }).lean();
      assert.deepEqual(rows.at(-1).changes, {
        gender: { from: "prefer_not_to_say", to: null },
        avatarUrl: { from: pic, to: null },
      });
    });

    it("support (customers:edit) edits customers but not partners", async () => {
      const support = await createAndLogin(app, "support_admin");
      assert.equal((await as(support.token).patch(`/admin/users/${customer.user.id}`, { gender: "male" })).status, 200);
      assert.equal((await as(support.token).patch(`/admin/users/${partner.user.id}`, { gender: "male" })).status, 403);
    });

    it("lets customers set their own gender", async () => {
      let res = await as(customer.token).patch("/auth/me", { gender: "other" });
      assert.equal(res.status, 200);
      assert.equal(res.body.data.user.gender, "other");
      res = await as(customer.token).patch("/auth/me", { gender: "robot" });
      assert.equal(res.status, 422);
      res = await as(customer.token).patch("/auth/me", { gender: null });
      assert.equal(res.body.data.user.gender, undefined);
    });
  });
});
