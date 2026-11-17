import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import mongoose from "mongoose";
import { Address } from "../models/address.model.js";
import { AuditLog } from "../models/audit-log.model.js";
import { Order } from "../models/order.model.js";
import { Restaurant } from "../models/restaurant.model.js";
import { User } from "../models/user.model.js";
import { flushAudits } from "../services/audit.service.js";
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
const ADDRESS = {
  recipientName: "Mira Kestrel",
  phone: "9000000002",
  line1: "12 Lantern Lane",
  city: "Elmsford",
  state: "Westmarch",
  postalCode: "560001",
  location: { latitude: 12.9352, longitude: 77.6271 },
};
const day = 86_400_000;
const isoYearsAgo = (years) => {
  const d = new Date(Date.now() - years * 365.25 * day);
  return d.toISOString().slice(0, 10);
};

describe("admin user view and edit", () => {
  let app;
  let admin;
  let customer;
  let partner;
  let rider;

  before(async () => {
    await setupTestDb();
    app = buildApp();
  });
  after(teardownTestDb);

  beforeEach(async () => {
    await resetDb();
    partner = await seedCatalogFor(app);
    admin = await createAndLogin(app, "admin");
    customer = await createAndLogin(app, "customer");
    rider = await createAndLogin(app, "delivery");
  });

  const api = (method, path) =>
    request(app)[method](`/api/v1/admin/users${path}`).set(auth(admin.token));
  const auditRows = async (action) => {
    await flushAudits();
    return AuditLog.find({ action }).lean();
  };

  /** Raw orders with just what the figures and the admin list read. */
  async function insertOrders(customerId, rows) {
    const restaurant = await Restaurant.findOne().select("_id");
    await Order.collection.insertMany(
      rows.map(([status, totalPaise, createdAt], i) => ({
        orderNumber: `BB-TEST-${i}-${Math.random().toString(36).slice(2, 7)}`,
        customer: new mongoose.Types.ObjectId(String(customerId)),
        restaurant: restaurant._id,
        restaurantSnapshot: { name: "Copper Kettle" },
        status,
        pricing: { totalPaise },
        createdAt,
        updatedAt: createdAt,
      })),
    );
  }

  describe("GET /admin/users/:id", () => {
    it("returns the account, addresses and order figures of a customer", async () => {
      await request(app).post("/api/v1/addresses").set(auth(customer.token)).send(ADDRESS);
      const last = new Date(Date.now() - day);
      await insertOrders(customer.user.id, [
        ["delivered", 45000, new Date(Date.now() - 3 * day)],
        ["delivered", 30000, last],
        ["cancelled", 20000, new Date(Date.now() - 2 * day)],
        ["rejected", 10000, new Date(Date.now() - 4 * day)],
        ["preparing", 15000, new Date(Date.now() - 5 * day)],
      ]);

      const res = await api("get", `/${customer.user.id}`);
      assert.equal(res.status, 200, res.body.message);
      const { user, addresses, stats, restaurant } = res.body.data;
      assert.equal(user.id, customer.user.id);
      assert.equal(user.passwordHash, undefined);
      assert.equal(addresses.length, 1);
      assert.equal(addresses[0].line1, ADDRESS.line1);
      assert.equal(addresses[0].isDefault, true);
      assert.deepEqual(stats, {
        orders: 5,
        delivered: 2,
        cancelled: 2,
        spentPaise: 75000,
        lastOrderAt: last.toISOString(),
      });
      assert.equal(restaurant, null);
    });

    it("gives empty figures to a new account and links a partner's restaurant", async () => {
      const riderView = (await api("get", `/${rider.user.id}`)).body.data;
      assert.deepEqual(riderView.stats, {
        orders: 0,
        delivered: 0,
        cancelled: 0,
        spentPaise: 0,
        lastOrderAt: null,
      });
      assert.deepEqual(riderView.addresses, []);
      assert.equal(riderView.restaurant, null);

      const owned = await Restaurant.findOne({ owner: partner.user.id }).lean();
      const res = await api("get", `/${partner.user.id}`);
      assert.equal(res.status, 200);
      assert.deepEqual(res.body.data.restaurant, {
        id: String(owned._id),
        name: owned.name,
        slug: owned.slug,
        status: owned.status,
      });
    });

    it("answers 404 for admins and unknown ids, 422 for a bad id", async () => {
      const ops = await createAndLogin(app, "operations_admin");
      for (const id of [admin.user.id, ops.user.id, String(new mongoose.Types.ObjectId())]) {
        const res = await api("get", `/${id}`);
        assert.equal(res.status, 404);
        assert.equal(res.body.message, "User not found");
      }
      assert.equal((await api("get", "/not-an-id")).status, 422);
    });

    it("needs customers:view for a customer", async () => {
      const ops = await createAndLogin(app, "operations_admin");
      const res = await request(app)
        .get(`/api/v1/admin/users/${customer.user.id}`)
        .set(auth(ops.token));
      assert.equal(res.status, 403);
      assert.equal(
        (await request(app).get(`/api/v1/admin/users/${customer.user.id}`)).status,
        401,
      );
    });
  });

  describe("PATCH /admin/users/:id", () => {
    it("updates the name only: email, phone, role and status are not editable here", async () => {
      const before = await User.findById(customer.user.id).lean();
      assert.ok(before.emailVerifiedAt && before.phoneVerifiedAt, "seeded as verified");

      const res = await api("patch", `/${customer.user.id}`).send({
        name: "  Mira Kestrel ",
        email: "other.person@example.com",
        phone: "9123456780",
        role: "admin",
        status: "suspended",
      });
      assert.equal(res.status, 200, res.body.message);
      assert.equal(res.body.message, "User updated");
      const { user } = res.body.data;
      assert.equal(user.name, "Mira Kestrel");
      assert.equal(user.email, before.email, "only the person changes their email");
      assert.equal(user.phone, before.phone, "only the person changes their phone");
      assert.equal(user.emailVerified, true);
      assert.equal(user.phoneVerified, true);
      assert.equal(user.role, "customer", "role is not editable here");
      assert.equal(user.status, "active", "status is not editable here");

      // The customer's session still works (sessions are untouched).
      const me = await request(app).get("/api/v1/auth/me").set(auth(customer.token));
      assert.equal(me.status, 200);

      const rows = await auditRows("user.update");
      assert.equal(rows.length, 1);
      assert.equal(rows[0].resourceType, "user");
      assert.equal(rows[0].resourceId, customer.user.id);
      assert.equal(rows[0].description, "Updated user details");
    });

    it("validates the name like sign-up", async () => {
      const res = await api("patch", `/${customer.user.id}`).send({ name: "M" });
      assert.equal(res.status, 422);
      assert.equal(res.body.error.details[0].field, "name");
    });

    it("sets, changes and clears the date of birth with the 13-120 age rule", async () => {
      const first = isoYearsAgo(30);
      let res = await api("patch", `/${customer.user.id}`).send({ birthDate: first });
      assert.equal(res.status, 200, res.body.message);
      assert.equal(res.body.data.user.birthDate.slice(0, 10), first);

      // Unlike the customer's own endpoint, an admin may change a date already set.
      const second = isoYearsAgo(40);
      res = await api("patch", `/${customer.user.id}`).send({ birthDate: second });
      assert.equal(res.status, 200);
      assert.equal(res.body.data.user.birthDate.slice(0, 10), second);

      for (const bad of [isoYearsAgo(5), isoYearsAgo(130), "2001-02-30", "15/08/1990"]) {
        res = await api("patch", `/${customer.user.id}`).send({ birthDate: bad });
        assert.equal(res.status, 422, bad);
        assert.equal(res.body.error.details[0].field, "birthDate");
      }

      res = await api("patch", `/${customer.user.id}`).send({ birthDate: null });
      assert.equal(res.status, 200);
      assert.equal(res.body.data.user.birthDate, undefined);
      assert.equal((await User.findById(customer.user.id).lean()).birthDate, undefined);
    });

    it("answers 404 for admin accounts", async () => {
      const res = await api("patch", `/${admin.user.id}`).send({ name: "Somebody Else" });
      assert.equal(res.status, 404);
      assert.equal(res.body.message, "User not found");
    });
  });

  describe("a customer's addresses", () => {
    it("creates, updates, switches the default and deletes, like the customer's own endpoints", async () => {
      let res = await api("post", `/${customer.user.id}/addresses`).send(ADDRESS);
      assert.equal(res.status, 201, res.body.message);
      assert.equal(res.body.message, "Address saved");
      const home = res.body.data.address;
      assert.equal(home.isDefault, true, "the first address becomes the default");

      res = await api("post", `/${customer.user.id}/addresses`).send({
        ...ADDRESS,
        label: "work",
        line1: "7 Foundry Row",
      });
      const work = res.body.data.address;
      assert.equal(work.isDefault, false);

      res = await api("patch", `/${customer.user.id}/addresses/${work.id}`).send({ landmark: "Opposite the clock tower" });
      assert.equal(res.status, 200);
      assert.equal(res.body.message, "Address updated");
      assert.equal(res.body.data.address.landmark, "Opposite the clock tower");

      res = await api("patch", `/${customer.user.id}/addresses/${work.id}/default`);
      assert.equal(res.status, 200);
      assert.equal(res.body.message, "Default address updated");
      assert.equal(res.body.data.address.isDefault, true);
      assert.equal((await Address.findById(home.id)).isDefault, false);

      res = await api("delete", `/${customer.user.id}/addresses/${work.id}`);
      assert.equal(res.status, 200);
      assert.equal(res.body.message, "Address deleted");
      assert.equal((await Address.findById(home.id)).isDefault, true, "the remaining one is promoted");

      // The customer sees the admin's changes.
      const own = await request(app).get("/api/v1/addresses").set(auth(customer.token));
      assert.deepEqual(own.body.data.addresses.map((a) => a.id), [home.id]);

      for (const action of ["user.address.create", "user.address.update", "user.address.default", "user.address.delete"]) {
        const rows = await auditRows(action);
        assert.ok(rows.length >= 1, action);
        assert.ok(rows.every((r) => r.resourceType === "user" && r.resourceId === customer.user.id), action);
      }
    });

    it("validates the body like POST /addresses", async () => {
      const res = await api("post", `/${customer.user.id}/addresses`).send({ ...ADDRESS, line1: undefined });
      assert.equal(res.status, 422);
    });

    it("answers 404 for another person's address", async () => {
      const other = await request(app)
        .post("/api/v1/addresses")
        .set(auth(customer.token))
        .send(ADDRESS);
      const theirs = other.body.data.address.id;
      // A second customer, made directly.
      const second = await User.create({
        name: "Tobin Ashgrove",
        email: "tobin.ashgrove@example.com",
        role: "customer",
        passwordHash: "x".repeat(60),
      });
      for (const [method, path, body] of [
        ["patch", `/${second.id}/addresses/${theirs}`, { landmark: "Nowhere" }],
        ["patch", `/${second.id}/addresses/${theirs}/default`],
        ["delete", `/${second.id}/addresses/${theirs}`],
      ]) {
        const res = await api(method, path).send(body);
        assert.equal(res.status, 404, `${method} ${path}`);
      }
      assert.ok(await Address.findById(theirs), "untouched");
    });

    it("answers 400 for partners and riders, 404 for admins", async () => {
      for (const who of [partner, rider]) {
        const res = await api("post", `/${who.user.id}/addresses`).send(ADDRESS);
        assert.equal(res.status, 400);
        assert.equal(res.body.message, "Only customers have saved addresses");
      }
      const someId = String(new mongoose.Types.ObjectId());
      const res = await api("delete", `/${rider.user.id}/addresses/${someId}`);
      assert.equal(res.status, 400);
      assert.equal((await api("post", `/${admin.user.id}/addresses`).send(ADDRESS)).status, 404);
      assert.equal((await auditRows("user.address.create")).length, 0);
    });
  });

  describe("GET /admin/orders?customer=", () => {
    it("lists only that customer's orders, with matching counts", async () => {
      const second = await User.create({
        name: "Tobin Ashgrove",
        email: "tobin.ashgrove@example.com",
        role: "customer",
        passwordHash: "x".repeat(60),
      });
      await insertOrders(customer.user.id, [
        ["delivered", 45000, new Date(Date.now() - 2 * day)],
        ["cancelled", 20000, new Date(Date.now() - day)],
      ]);
      await insertOrders(second.id, [["delivered", 30000, new Date()]]);

      const res = await request(app)
        .get(`/api/v1/admin/orders?customer=${customer.user.id}`)
        .set(auth(admin.token));
      assert.equal(res.status, 200, res.body.message);
      assert.equal(res.body.data.items.length, 2);
      assert.equal(res.body.data.pagination.total, 2);
      assert.deepEqual(res.body.data.counts, { delivered: 1, cancelled: 1 });

      const both = await request(app).get("/api/v1/admin/orders").set(auth(admin.token));
      assert.equal(both.body.data.items.length, 3);
      assert.deepEqual(both.body.data.counts, { delivered: 2, cancelled: 1 });

      const filtered = await request(app)
        .get(`/api/v1/admin/orders?customer=${customer.user.id}&status=delivered`)
        .set(auth(admin.token));
      assert.equal(filtered.body.data.items.length, 1);

      const bad = await request(app).get("/api/v1/admin/orders?customer=nope").set(auth(admin.token));
      assert.equal(bad.status, 422);
    });
  });
});
