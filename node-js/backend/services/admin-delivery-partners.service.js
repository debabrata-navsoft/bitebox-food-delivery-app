import {
  DeliveryPartner,
  VERIFICATION_STATUS as V,
  verificationOf,
} from "../models/delivery-partner.model.js";
import { DOCUMENT_KINDS } from "../models/kyc-document.model.js";
import { ORDER_STATUS, Order } from "../models/order.model.js";
import { ROLES, User } from "../models/user.model.js";
import { escapeRegex } from "../utils/pagination.js";
import {
  ADDRESS_FIELDS,
  ADDRESS_LINES,
  addressLines,
  aggregatePage,
  blank,
  distinctNames,
  idSearch,
  joinedRange,
  kycSummary,
  listSorts,
  NEWEST,
  personSearch,
  ratingOf,
  sameName,
  toId,
} from "./admin-accounts.js";
import { updateMember } from "./admin-users.service.js";
import { diff } from "./audit.service.js";
import {
  adminGet,
  adminSetVerification,
  findRider,
  getOrCreateProfile,
  takeOffline,
} from "./delivery-partner.service.js";
import { reverify, riderKycStages } from "./kyc.service.js";
import { AVAILABILITY_SOURCES, history } from "./rider-availability.service.js";

/**
 * The admin Delivery partner accounts page (`riders:view`): the list, one rider's account view,
 * and the admin edit, verification and "take offline" actions. Rider (user) ids throughout;
 * any id that is not a delivery partner answers 404.
 */

/** Riders whose vehicle number contains `search`, ignoring letter case and spaces. */
function vehicleSearch(search) {
  const wanted = search.replace(/\s+/g, "");
  if (!wanted) return null;
  return DeliveryPartner.distinct("user", {
    $expr: {
      $regexMatch: {
        input: { $replaceAll: { input: { $ifNull: ["$vehicleNumber", ""] }, find: " ", replacement: "" } },
        regex: escapeRegex(wanted),
        options: "i",
      },
    },
  });
}

/** Account-level conditions (on users). */
async function userFilter({ search, accountStatus, joinedFrom, joinedTo }) {
  const filter = { role: ROLES.DELIVERY };
  if (accountStatus) filter.status = accountStatus;
  const joined = joinedRange(joinedFrom, joinedTo);
  if (joined) filter.createdAt = joined;
  if (search) {
    const vehicles = await vehicleSearch(search);
    filter.$or = [
      ...personSearch(search),
      idSearch(search),
      vehicles && { _id: { $in: vehicles } },
    ].filter(Boolean);
  }
  return filter;
}

/**
 * Joins each rider's profile as `rider` and adds the list's derived fields. A rider with no
 * profile yet is pending and offline; a profile without a verification status counts as approved.
 */
const profileStages = [
  {
    $lookup: {
      from: DeliveryPartner.collection.name,
      localField: "_id",
      foreignField: "user",
      as: "rider",
    },
  },
  { $addFields: { rider: { $first: "$rider" } } },
  {
    $addFields: {
      verificationStatus: {
        $cond: [{ $ifNull: ["$rider", false] }, { $ifNull: ["$rider.verificationStatus", V.APPROVED] }, V.PENDING],
      },
      isOnline: { $eq: ["$rider.isOnline", true] },
      busy: {
        $and: [{ $eq: ["$rider.isOnline", true] }, { $ne: [{ $ifNull: ["$rider.activeOrder", null] }, null] }],
      },
      completedDeliveries: { $ifNull: ["$rider.completedDeliveries", 0] },
      ratingAverage: { $ifNull: ["$rider.rating.average", 0] },
      ratingCount: { $ifNull: ["$rider.rating.count", 0] },
    },
  },
];

/** Profile-level conditions (after profileStages). */
function riderFilter({ verification, availability, zone, vehicleType }) {
  const filter = {};
  if (verification) filter.verificationStatus = verification;
  if (availability === "online") Object.assign(filter, { isOnline: true, busy: false });
  else if (availability === "offline") filter.isOnline = false;
  else if (availability === "busy") filter.busy = true;
  if (zone) filter["rider.zone"] = sameName(zone);
  if (vehicleType) filter["rider.vehicleType"] = vehicleType;
  return filter;
}

const SORTS = listSorts({
  deliveries: { completedDeliveries: -1, ...NEWEST },
  rating: { ratingAverage: -1, ratingCount: -1, ...NEWEST },
});

const listItem = (row) => ({
  id: String(row._id),
  name: row.name ?? null,
  email: row.email ?? null,
  phone: row.phone || null,
  avatarUrl: row.avatarUrl || null,
  status: row.status,
  statusReason: row.statusReason || null,
  createdAt: row.createdAt,
  verificationStatus: row.verificationStatus,
  isOnline: row.isOnline,
  busy: row.busy,
  vehicleType: row.rider?.vehicleType ?? null,
  vehicleNumber: row.rider?.vehicleNumber || null,
  zone: row.rider?.zone || null,
  completedDeliveries: row.completedDeliveries,
  rating: { average: row.ratingAverage, count: row.ratingCount },
  kycStatus: row.kycStatus,
});

/**
 * GET /admin/delivery-partner-accounts. Filtering and sorting run in the database; the KYC state
 * is computed for every matching rider when filtering by it, otherwise for the page only.
 */
export async function listRiders(query, pagination) {
  const sort = query.sort ?? "newest";
  const kycFirst = Boolean(query.kyc);
  const pipeline = [{ $match: await userFilter(query) }, ...profileStages, { $match: riderFilter(query) }];
  if (kycFirst) pipeline.push(...riderKycStages(), { $match: { kycStatus: query.kyc } });
  const { rows, pagination: meta } = await aggregatePage(
    User,
    pipeline,
    { sort, sorts: SORTS, rowStages: kycFirst ? [] : riderKycStages() },
    pagination,
  );
  return { items: rows.map(listItem), pagination: meta };
}

/** GET /admin/delivery-partner-accounts/zones: distinct zones, A to Z, case-insensitively unique. */
export async function listZones() {
  return distinctNames(await DeliveryPartner.distinct("zone"));
}

/**
 * Delivered orders, orders cancelled after this rider took them, the rider's earnings (the
 * settlement's rider share, as on their own earnings screen) and the last delivery.
 */
async function deliveryStats(userId) {
  const delivered = { $eq: ["$status", ORDER_STATUS.DELIVERED] };
  const [row] = await Order.aggregate([
    { $match: { deliveryPartner: toId(userId) } },
    {
      $group: {
        _id: null,
        deliveries: { $sum: { $cond: [delivered, 1, 0] } },
        cancelled: { $sum: { $cond: [{ $eq: ["$status", ORDER_STATUS.CANCELLED] }, 1, 0] } },
        earningsPaise: { $sum: { $cond: [delivered, { $ifNull: ["$settlement.riderPaise", 0] }, 0] } },
        lastDeliveryAt: {
          $max: { $cond: [delivered, { $ifNull: ["$settlement.at", "$updatedAt"] }, null] },
        },
      },
    },
  ]);
  return {
    deliveries: row?.deliveries ?? 0,
    cancelled: row?.cancelled ?? 0,
    earningsPaise: row?.earningsPaise ?? 0,
    lastDeliveryAt: row?.lastDeliveryAt ?? null,
  };
}

/** GET /admin/delivery-partner-accounts/:id: the account, the rider profile, figures and KYC. */
export async function riderDetail(id) {
  const { user, profile } = await adminGet(id);
  const [stats, kyc] = await Promise.all([
    deliveryStats(id),
    kycSummary(User, id, riderKycStages()),
  ]);
  return {
    user,
    rider: profile,
    stats: { ...stats, rating: ratingOf(profile) },
    kyc,
  };
}

// What an admin edit records: the rider-profile fields in plain form, the address per line.
const PROFILE_FIELDS = [
  ...ADDRESS_LINES,
  "emergencyContact",
  "vehicleType",
  "vehicleNumber",
  "zone",
];
const contactOf = (c) =>
  c?.name ? { name: c.name, phone: c.phone, relation: blank(c.relation) } : null;
const auditable = (p) => ({
  ...addressLines(p.address),
  emergencyContact: contactOf(p.emergencyContact),
  vehicleType: blank(p.vehicleType),
  vehicleNumber: blank(p.vehicleNumber),
  zone: blank(p.zone),
});

/**
 * PATCH /admin/delivery-partner-accounts/:id: the rider's name, gender, date of birth and photo
 * (the admin member edit), home address and vehicle (the rider's own rules), emergency contact
 * and zone. A new vehicle number sends an approved RC back for review; the rider's verification
 * status never changes. Returns { changes, detail }.
 */
export async function updateRider(actor, id, input) {
  await findRider(id);
  const { name, gender, birthDate, avatarUrl } = input;
  const member = await updateMember(actor, id, { name, gender, birthDate, avatarUrl });
  const changes = { ...member.changes };

  const profile = await getOrCreateProfile(id);
  const before = auditable(profile);
  const { address, emergencyContact, vehicleType, vehicleNumber, zone } = input;
  if (address !== undefined)
    profile.address = Object.fromEntries(
      ADDRESS_FIELDS.filter((f) => address[f] !== undefined).map((f) => [f, address[f]]),
    );
  if (emergencyContact !== undefined)
    profile.emergencyContact = emergencyContact
      ? {
          name: emergencyContact.name,
          phone: emergencyContact.phone,
          relation: emergencyContact.relation || null,
        }
      : null;
  if (vehicleType !== undefined) profile.vehicleType = vehicleType;
  if (vehicleNumber !== undefined) profile.vehicleNumber = vehicleNumber;
  if (zone !== undefined) profile.zone = zone || undefined;
  const profileChanges = diff(before, auditable(profile), PROFILE_FIELDS);
  if (Object.keys(profileChanges).length) {
    profile.markModified("address");
    await profile.save();
    Object.assign(changes, profileChanges);
    if (profileChanges.vehicleNumber) {
      const reverified = await reverify(profile.user, [DOCUMENT_KINDS.VEHICLE_RC]);
      if (reverified.length) changes.reverified = reverified;
    }
  }
  return { changes, detail: await riderDetail(id) };
}

const VERIFICATION_MESSAGES = {
  [V.APPROVED]: "Delivery partner approved",
  [V.REJECTED]: "Delivery partner rejected",
  [V.RESUBMISSION_REQUESTED]: "Asked for documents",
};

/**
 * PATCH /admin/delivery-partner-accounts/:id/verification: the rider verification service
 * (transitions, KYC check, notice, offline when withdrawn). The same status changes nothing.
 * Returns { changes, detail, message }.
 */
export async function setVerification(actor, id, status, reason) {
  const user = await findRider(id);
  const from = verificationOf(await getOrCreateProfile(user._id));
  const changed = from !== status;
  if (changed) await adminSetVerification(id, status, reason ?? "", actor._id);
  return {
    changes: changed ? { verificationStatus: { from, to: status } } : {},
    detail: await riderDetail(id),
    message: VERIFICATION_MESSAGES[status],
  };
}

/**
 * PATCH /admin/delivery-partner-accounts/:id/availability: takes an online rider offline (the
 * rider's own offline path: refused mid-delivery, an open offer is passed on), recorded in the
 * availability history. Already offline changes nothing. Returns { changes, detail }.
 */
export async function takeRiderOffline(id, reason) {
  await findRider(id);
  const profile = await DeliveryPartner.findOne({ user: id });
  if (!profile?.isOnline) return { changes: {}, detail: await riderDetail(id) };
  await takeOffline(id, profile, "The rider is on a delivery", {
    source: AVAILABILITY_SOURCES.ADMIN,
    reason,
  });
  return { changes: { isOnline: { from: true, to: false } }, detail: await riderDetail(id) };
}

/** GET /admin/delivery-partner-accounts/:id/availability */
export async function availabilityHistory(id, pagination) {
  await findRider(id);
  return history(id, pagination);
}
