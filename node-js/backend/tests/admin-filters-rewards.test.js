// Global filters on the admin Coins & rewards lists: multi-value filters (OR within one, AND
// across) and facet counts (`facets=1`) on campaigns, the reward history (claims), coin
// transactions and referrals. Same cases as backend/apps/coins/tests/test_admin_list_filters.py.
// Fictional data only.
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { Referral } from "../models/referral.model.js";
import { RewardCampaign, RewardClaim } from "../models/reward-campaign.model.js";
import * as wallet from "../services/coin-wallet.service.js";
import { buildApp, createAndLogin, request, resetDb, setupTestDb, teardownTestDb } from "./helpers.js";
import { at, auth, counts, fieldErrors as errors, insertUser as customer, listed, ok, oid } from "./list-filter-fixtures.js";

const ids = (res) => listed(res, "id");
const sorted = (...list) => list.map(String).sort();
const total = (res) => ok(res).pagination.total;

describe("admin rewards list filters and facets", () => {
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

  const get = (path, query = {}) =>
    request(app).get(`/api/v1/admin/rewards/${path}`).query(query).set(auth(admin.token));

  const campaign = (name, start, end, fields = {}) =>
    RewardCampaign.create({
      name,
      type: "FESTIVAL",
      rewardCoins: 50,
      startAt: at(start, 10),
      endAt: at(end, 18),
      ...fields,
    });

  describe("GET /admin/rewards/campaigns", () => {
    it("combines filters and counts each facet without its own selection", async () => {
      const lamp = await campaign("Lantern Night", "2026-10-01", "2026-10-05", { status: "ACTIVE" });
      const harvest = await campaign("Harvest Moon", "2026-10-10", "2026-10-12", { status: "PAUSED", trigger: "ORDER" });
      const promo = await campaign("Spring Hello", "2026-11-01", "2026-11-30", {
        type: "PROMOTIONAL",
        status: "ACTIVE",
        conditions: { customerGroup: "NEW" },
      });
      await campaign("Old Draft", "2026-09-01", "2026-09-02");

      assert.deepEqual(ids(await get("campaigns", { status: "ACTIVE,PAUSED" })), sorted(lamp.id, harvest.id, promo.id));
      assert.deepEqual(ids(await get("campaigns", { status: "ACTIVE", type: "FESTIVAL" })), [lamp.id]);
      assert.deepEqual(ids(await get("campaigns", { trigger: "ORDER" })), [harvest.id]);
      assert.deepEqual(ids(await get("campaigns", { customerGroup: "NEW" })), [promo.id]);
      assert.deepEqual(ids(await get("campaigns", { search: "moon" })), [harvest.id]);
      // Running on any day of the range: Lantern (ends 5 Oct) and Harvest (starts 10 Oct).
      assert.deepEqual(ids(await get("campaigns", { runsFrom: "2026-10-05", runsTo: "2026-10-10" })), sorted(lamp.id, harvest.id));
      assert.deepEqual(ids(await get("campaigns", { runsFrom: "2026-10-06", runsTo: "2026-10-09" })), []);

      const res = await get("campaigns", { status: "ACTIVE", type: "FESTIVAL", facets: "1" });
      assert.equal(total(res), 1);
      assert.deepEqual(counts(res, "status"), { DRAFT: 1, SCHEDULED: 0, ACTIVE: 1, PAUSED: 1, EXPIRED: 0, COMPLETED: 0 });
      assert.deepEqual(counts(res, "type"), { FESTIVAL: 1, PROMOTIONAL: 1 });
      assert.deepEqual(counts(res, "trigger"), { CLAIM: 1, ORDER: 0 });
      assert.deepEqual(counts(res, "customerGroup"), { ALL: 1, NEW: 0, EXISTING: 0, INACTIVE: 0 });
      assert.equal((await get("campaigns")).body.data.facets, undefined);
    });

    it("rejects invalid values", async () => {
      assert.deepEqual(errors(await get("campaigns", { status: "ACTIVE,LIVE", trigger: "x" })), {
        status: "Invalid value",
        trigger: "Invalid value",
      });
      assert.deepEqual(errors(await get("campaigns", { runsFrom: "2026-10-09", runsTo: "2026-10-01" })), {
        runsTo: "Must be on or after runsFrom",
      });
    });
  });

  describe("GET /admin/rewards/claims", () => {
    it("filters, searches and counts", async () => {
      const lamp = await campaign("Lantern Night", "2026-10-01", "2026-10-05", { status: "ACTIVE" });
      const harvest = await campaign("Harvest Moon", "2026-10-10", "2026-10-12", { status: "ACTIVE" });
      const asha = await customer("Asha Fictional");
      const ravi = await customer("Ravi Imaginary");
      const claim = async (user, rewardType, day, fields = {}) => {
        seq += 1;
        const _id = oid();
        await RewardClaim.collection.insertOne({
          _id,
          user,
          campaign: null,
          rewardType,
          coins: 50,
          status: "PENDING",
          claimKey: `test:${seq}`,
          claimedAt: at(day, 12),
          updatedAt: at(day, 12),
          ...fields,
        });
        return String(_id);
      };
      const welcome = await claim(asha, "WELCOME", "2026-10-01", { status: "ISSUED" });
      const lampClaim = await claim(asha, "FESTIVAL", "2026-10-03", { campaign: lamp._id, status: "ISSUED" });
      const harvestClaim = await claim(ravi, "FESTIVAL", "2026-10-11", { campaign: harvest._id });

      assert.deepEqual(ids(await get("claims", { rewardType: "WELCOME,FESTIVAL", status: "ISSUED" })), sorted(welcome, lampClaim));
      assert.deepEqual(ids(await get("claims", { campaign: `${lamp.id},${harvest.id}` })), sorted(lampClaim, harvestClaim));
      // The old single-value link still works.
      assert.deepEqual(ids(await get("claims", { campaign: harvest.id })), [harvestClaim]);
      assert.deepEqual(ids(await get("claims", { search: "ravi" })), [harvestClaim]);
      assert.deepEqual(ids(await get("claims", { search: "lantern" })), [lampClaim]);
      assert.deepEqual(ids(await get("claims", { claimedFrom: "2026-10-02", claimedTo: "2026-10-03" })), [lampClaim]);

      const res = await get("claims", { rewardType: "FESTIVAL", facets: "1" });
      assert.deepEqual(counts(res, "rewardType"), { WELCOME: 1, BIRTHDAY: 0, FESTIVAL: 2, PROMOTIONAL: 0 });
      assert.deepEqual(counts(res, "status"), { PENDING: 1, ISSUED: 1 });
      // Most rows first, then by name.
      assert.deepEqual(
        res.body.data.facets.campaign.map((f) => [f.value, f.label, f.count]),
        [
          [harvest.id, "Harvest Moon", 1],
          [lamp.id, "Lantern Night", 1],
        ],
      );
    });

    it("rejects invalid values", async () => {
      assert.deepEqual(errors(await get("claims", { rewardType: "GIFT", campaign: "nope" })), {
        rewardType: "Invalid value",
        campaign: "Invalid value",
      });
    });
  });

  describe("GET /admin/rewards/transactions", () => {
    it("filters, keeps the one-customer link and counts", async () => {
      const lamp = await campaign("Lantern Night", "2026-10-01", "2026-10-05", { status: "ACTIVE" });
      const asha = await customer("Asha Fictional");
      const ravi = await customer("Ravi Imaginary");
      await wallet.credit(asha, { coins: 40, source: "FESTIVAL_REWARD", key: "t:1", campaign: lamp._id });
      await wallet.credit(asha, { coins: 30, source: "PROMOTIONAL_REWARD", key: "t:2" });
      await wallet.credit(ravi, { coins: 20, source: "FESTIVAL_REWARD", key: "t:3", campaign: lamp._id });
      await wallet.reverseCredit(asha, { creditKey: "t:2", key: "t:2:back", coins: 10 });

      assert.equal(total(await get("transactions", { source: "FESTIVAL_REWARD,PROMOTIONAL_REWARD" })), 3);
      assert.equal(total(await get("transactions", { type: "CREDIT", userId: String(asha) })), 2);
      assert.equal(total(await get("transactions", { campaign: lamp.id })), 2);
      // A search and a customer link combine.
      assert.equal(total(await get("transactions", { search: "ravi", userId: String(asha) })), 0);
      assert.equal(total(await get("transactions", { from: new Date(Date.now() + 3_600_000).toISOString() })), 0);

      const res = await get("transactions", { type: "CREDIT", userId: String(asha), facets: "1" });
      assert.deepEqual(counts(res, "type"), { CREDIT: 2, DEBIT: 0, RESERVE: 0, RELEASE: 0, EXPIRE: 0, REVERSAL: 1 });
      assert.equal(counts(res, "source").FESTIVAL_REWARD, 1);
      assert.equal(counts(res, "source").PROMOTIONAL_REWARD, 1);
      assert.deepEqual(res.body.data.facets.campaign, [{ value: lamp.id, label: "Lantern Night", count: 1 }]);
    });

    it("rejects invalid values", async () => {
      assert.deepEqual(errors(await get("transactions", { type: "CREDIT,GIFT", source: "x" })), {
        type: "Invalid value",
        source: "Invalid value",
      });
    });
  });

  describe("GET /admin/rewards/referrals", () => {
    it("filters by risk signal and counts", async () => {
      const asha = await customer("Asha Fictional");
      const referral = async (name, day, fields = {}) => {
        const _id = oid();
        await Referral.collection.insertOne({
          _id,
          referrer: asha,
          referred: await customer(name),
          code: "ASHA2026",
          status: "REGISTERED",
          rewardStatus: "NONE",
          riskFlags: [],
          history: [],
          attributionExpiresAt: new Date(Date.now() + 30 * 86_400_000),
          createdAt: at(day, 9),
          updatedAt: at(day, 9),
          ...fields,
        });
        return String(_id);
      };
      const held = await referral("Ravi Imaginary", "2026-10-01", {
        status: "ORDER_DELIVERED",
        rewardStatus: "HELD",
        riskFlags: ["SAME_SIGNUP_IP", "REFERRER_VELOCITY"],
      });
      const paid = await referral("Meera Madeup", "2026-10-05", {
        status: "REWARD_CREDITED",
        rewardStatus: "CREDITED",
        riskFlags: ["ADDRESS_MATCHES_REFERRER"],
      });
      const fresh = await referral("Kiran Pretend", "2026-10-09");

      assert.deepEqual(ids(await get("referrals", { rewardStatus: "HELD,CREDITED" })), sorted(held, paid));
      assert.deepEqual(ids(await get("referrals", { risk: "SAME_SIGNUP_IP,ADDRESS_MATCHES_REFERRER" })), sorted(held, paid));
      assert.deepEqual(ids(await get("referrals", { risk: "REFERRER_VELOCITY", status: "REGISTERED" })), []);
      assert.deepEqual(ids(await get("referrals", { flagged: "true", status: "REWARD_CREDITED" })), [paid]);
      assert.deepEqual(ids(await get("referrals", { createdFrom: "2026-10-05" })), sorted(paid, fresh));
      assert.deepEqual(ids(await get("referrals", { search: "kiran" })), [fresh]);

      const res = await get("referrals", { rewardStatus: "HELD", facets: "1" });
      assert.deepEqual(res.body.data.counts, { HELD: 1, CREDITED: 1, NONE: 1 });
      assert.deepEqual(counts(res, "rewardStatus"), { NONE: 1, HELD: 1, CREDITING: 0, CREDITED: 1, PARTIAL: 0, REJECTED: 0 });
      assert.deepEqual(counts(res, "status"), {
        REGISTERED: 0,
        FIRST_ORDER_PLACED: 0,
        ORDER_DELIVERED: 1,
        REWARD_CREDITED: 0,
        REJECTED: 0,
        EXPIRED: 0,
      });
      assert.deepEqual(counts(res, "risk"), {
        SAME_SIGNUP_IP: 1,
        ADDRESS_MATCHES_REFERRER: 0,
        ADDRESS_SHARED_WITH_OTHER_REFERRAL: 0,
        REFERRER_VELOCITY: 1,
      });
    });

    it("rejects invalid values", async () => {
      assert.deepEqual(errors(await get("referrals", { risk: "SHADY", rewardStatus: "PAID" })), {
        risk: "Invalid value",
        rewardStatus: "Invalid value",
      });
    });
  });
});
