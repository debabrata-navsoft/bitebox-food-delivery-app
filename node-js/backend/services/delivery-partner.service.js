import {
  DeliveryPartner,
  VERIFICATION_STATUS as V,
  VERIFICATION_TRANSITIONS,
  verificationOf,
} from "../models/delivery-partner.model.js";
import { env } from "../config/env.js";
import { PERMISSIONS } from "../config/permissions.js";
import * as kyc from "./kyc.service.js";
import { DOCUMENT_STATUS, KycDocument, PayoutAccount } from "../models/kyc-document.model.js";
import { notify, notifyAdmins } from "./notification.service.js";
import { ORDER_STATUS, Order } from "../models/order.model.js";
import { ROLES, User, USER_STATUS } from "../models/user.model.js";
import { ApiError } from "../utils/api-error.js";
import { toPoint } from "../utils/geo.js";
import { escapeRegex, paginationMeta } from "../utils/pagination.js";
import {
  declineOffer,
  dispatchSafely,
  findWaitingOrders,
} from "./dispatch.service.js";
import { applyStatus } from "./auth.service.js";
import { onPosition, trackedOrderId } from "./tracking.service.js";
import { AVAILABILITY_SOURCES, setOnline } from "./rider-availability.service.js";
import {
  pickupDistanceMeters,
  presentForRider,
} from "./order-management.service.js";

/** List filter: riders still waiting on themselves (pending, something not sent yet). */
export const NOT_SUBMITTED = "not_submitted";

/**
 * Riders who have sent everything an admin checks (each required document, not rejected; a bank
 * account; the home address; the vehicle), so a pending rider is really waiting for review. Until
 * then they are "not submitted", not "in review". Django: delivery/services.py#with_submitted.
 */
export async function submittedRiderIds(userIds) {
  const kinds = kyc.KINDS_FOR[ROLES.DELIVERY];
  const scope = userIds ? { user: { $in: userIds } } : {};
  const [withDocuments, withAccount, withDetails] = await Promise.all([
    KycDocument.aggregate([
      { $match: { ...scope, kind: { $in: kinds }, status: { $ne: DOCUMENT_STATUS.REJECTED } } },
      { $group: { _id: "$user", kinds: { $addToSet: "$kind" } } },
      { $match: { kinds: { $size: kinds.length } } },
    ]).then((rows) => rows.map((r) => String(r._id))),
    PayoutAccount.find(scope).distinct("user"),
    DeliveryPartner.find({ ...scope, vehicleType: { $ne: null }, address: { $ne: null } }).distinct("user"),
  ]);
  const [account, details] = [withAccount, withDetails].map((list) => new Set(list.map(String)));
  return new Set(withDocuments.filter((id) => account.has(id) && details.has(id)));
}

/** A profile as JSON, with `verification.submitted`. */
export async function profileJson(profile) {
  const json = profile.toJSON();
  json.verification.submitted = (await submittedRiderIds([profile.user])).has(String(profile.user));
  return json;
}

/** The rider's profile, created on first use (a plain read on every later call). */
export async function getOrCreateProfile(userId) {
  return (
    (await DeliveryPartner.findOne({ user: userId })) ??
    DeliveryPartner.findOneAndUpdate(
      { user: userId },
      { $setOnInsert: { user: userId, verificationStatus: V.PENDING } },
      { upsert: true, returnDocument: "after" },
    )
  );
}

/** Profile + the offer waiting for them + the order they are carrying: everything the dashboard needs. */
export async function dashboard(userId) {
  const profile = await getOrCreateProfile(userId);
  const [offer, active] = await Promise.all([
    profile.currentOffer
      ? Order.findOne({
          _id: profile.currentOffer,
          status: ORDER_STATUS.READY_FOR_PICKUP,
          "offer.partner": userId,
        })
      : null,
    profile.activeOrder
      ? Order.findOne({ _id: profile.activeOrder, deliveryPartner: userId })
      : null,
  ]);
  return {
    profile: await profileJson(profile),
    offer: offer
      ? {
          ...presentForRider(offer, userId),
          pickupDistanceMeters: pickupDistanceMeters(profile, offer),
        }
      : null,
    activeOrder: active ? presentForRider(active, userId) : null,
  };
}

export async function updateVehicle(userId, { vehicleType, vehicleNumber }) {
  return profileJson(
    await DeliveryPartner.findOneAndUpdate(
      { user: userId },
      { $set: { vehicleType, vehicleNumber }, $setOnInsert: { verificationStatus: V.PENDING } },
      { upsert: true, returnDocument: "after", runValidators: true },
    ),
  );
}

export async function setAvailability(
  userId,
  { isOnline, latitude, longitude },
) {
  const profile = await getOrCreateProfile(userId);
  if (isOnline) {
    if (riderKycRequired() && verificationOf(profile) !== V.APPROVED)
      throw new ApiError(403, "BiteBox is still verifying your documents. You can go online once approved.", {
        code: "RIDER_NOT_VERIFIED",
      });
    if (!profile.vehicleType)
      throw ApiError.badRequest("Add your vehicle details before going online");
    if (latitude === undefined || longitude === undefined)
      throw ApiError.badRequest("Share your location to go online");
    await setOnline(userId, true, {
      source: AVAILABILITY_SOURCES.RIDER,
      set: { location: toPoint({ latitude, longitude }), locationUpdatedAt: new Date() },
    });
    await offerWaitingOrders();
    return dashboard(userId);
  }

  await takeOffline(
    userId,
    profile,
    "Finish your current delivery before going offline",
    { source: AVAILABILITY_SOURCES.RIDER },
  );
  return dashboard(userId);
}

/**
 * Offline rules shared by the rider and admins: never mid-delivery; a pending offer is passed on.
 * `log` ({ source, reason }) is what the availability history records when the rider was online.
 */
export async function takeOffline(userId, profile, busyMessage, log) {
  if (profile?.activeOrder)
    throw new ApiError(409, busyMessage, { code: "DELIVERY_IN_PROGRESS" });
  if (profile?.currentOffer)
    await declineOffer(userId, profile.currentOffer).catch(() => undefined);
  await setOnline(userId, false, log);
}

/** Position report from the rider's device (rate limited at the route). */
export async function updateLocation(userId, { latitude, longitude }) {
  const updated = await DeliveryPartner.findOneAndUpdate(
    { user: userId, isOnline: true },
    {
      $set: {
        location: toPoint({ latitude, longitude }),
        locationUpdatedAt: new Date(),
      },
    },
    { returnDocument: "after" },
  );
  if (!updated)
    throw new ApiError(409, "Go online to share your location", {
      code: "OFFLINE",
    });
  const orderId = await trackedOrderId(userId);
  if (orderId)
    await onPosition(userId, orderId, { latitude, longitude }, updated.locationUpdatedAt);
  return { locationUpdatedAt: updated.locationUpdatedAt };
}

/** A rider just became available: give waiting orders a chance straight away. */
async function offerWaitingOrders() {
  for (const order of await findWaitingOrders(5)) {
    if (await dispatchSafely(order._id)) break; // one offer per rider at a time
  }
}

// Admin
export async function adminList({ search, online, verification }, pagination) {
  const userFilter = { role: ROLES.DELIVERY };
  if (search) {
    const pattern = new RegExp(escapeRegex(search), "i");
    userFilter.$or = [
      { name: pattern },
      { email: pattern },
      { phone: pattern },
    ];
  }
  if (online === true) {
    const onlineIds = await DeliveryPartner.find({ isOnline: true }).distinct(
      "user",
    );
    userFilter._id = { $in: onlineIds };
  }
  // Pending: sent everything and waiting for review. Not submitted: pending (or no profile yet)
  // with something still to send. Only these filters need every rider's state.
  let submitted = null;
  if (verification === V.PENDING || verification === NOT_SUBMITTED) {
    const [ids, decided] = await Promise.all([
      submittedRiderIds(),
      DeliveryPartner.find({ verificationStatus: { $ne: V.PENDING } }).distinct("user"),
    ]);
    submitted = ids;
    // $and keeps the online filter on _id above.
    userFilter.$and =
      verification === V.PENDING
        ? [{ _id: { $in: [...submitted] } }, { _id: { $nin: decided } }]
        : [{ _id: { $nin: [...submitted, ...decided] } }];
  } else if (verification) {
    // No status (older profiles) counts as approved.
    const statuses = verification === V.APPROVED ? [V.APPROVED, null] : [verification];
    const ids = await DeliveryPartner.find({ verificationStatus: { $in: statuses } }).distinct("user");
    userFilter.$and = [{ _id: { $in: ids } }];
  }
  const [users, total] = await Promise.all([
    User.find(userFilter)
      .sort({ createdAt: -1 })
      .skip(pagination.skip)
      .limit(pagination.limit),
    User.countDocuments(userFilter),
  ]);
  const [profiles, submittedOnPage] = await Promise.all([
    DeliveryPartner.find({ user: { $in: users.map((u) => u._id) } }),
    submitted ?? submittedRiderIds(users.map((u) => u._id)),
  ]);
  const byUser = new Map(profiles.map((p) => [String(p.user), p]));
  const activeOrders = await Order.find({
    _id: { $in: profiles.map((p) => p.activeOrder).filter(Boolean) },
  }).select("orderNumber status");
  const orderById = new Map(activeOrders.map((o) => [String(o._id), o]));

  const items = users.map((u) => {
    const p = byUser.get(String(u._id));
    const active = p?.activeOrder ? orderById.get(String(p.activeOrder)) : null;
    return {
      ...u.toJSON(),
      vehicleType: p?.vehicleType ?? null,
      vehicleNumber: p?.vehicleNumber ?? null,
      isOnline: p?.isOnline ?? false,
      verificationStatus: p ? verificationOf(p) : V.PENDING,
      submitted: submittedOnPage.has(String(u._id)),
      locationUpdatedAt: p?.locationUpdatedAt ?? null,
      completedDeliveries: p?.completedDeliveries ?? 0,
      rating: p?.rating ?? null,
      activeOrder: active
        ? {
            id: String(active._id),
            orderNumber: active.orderNumber,
            status: active.status,
          }
        : null,
    };
  });
  return { items, pagination: paginationMeta(pagination, total) };
}

// What the availability history says when the system takes a rider offline.
const ACCOUNT_OFFLINE_REASON = {
  [USER_STATUS.INACTIVE]: "Account deactivated",
  [USER_STATUS.SUSPENDED]: "Account suspended",
  [USER_STATUS.BLOCKED]: "Account blocked",
};
const VERIFICATION_OFFLINE_REASON = {
  [V.REJECTED]: "Verification rejected",
  [V.RESUBMISSION_REQUESTED]: "Documents requested again",
};

export async function findRider(userId) {
  const user = await User.findOne({ _id: userId, role: ROLES.DELIVERY });
  if (!user) throw ApiError.notFound("Delivery partner not found");
  return user;
}

/**
 * Any non-active status (inactive, suspended, blocked) takes the rider offline and passes on their
 * pending offer; not allowed mid-delivery. Asking for the current status changes nothing.
 * Returns { user, from, changed } for the audit log.
 */
export async function adminSetStatus(userId, status, reason) {
  const user = await findRider(userId);
  const from = user.status;
  if (from === status) return { user: user.toJSON(), from, changed: false };
  if (status !== USER_STATUS.ACTIVE) {
    const profile = await DeliveryPartner.findOne({ user: userId });
    await takeOffline(
      userId,
      profile,
      "This rider is carrying an order. Unassign or finish it first.",
      { source: AVAILABILITY_SOURCES.SYSTEM, reason: ACCOUNT_OFFLINE_REASON[status] },
    );
  }
  await applyStatus(user, status, reason);
  return { user: user.toJSON(), from, changed: true };
}

// Verification

let riderKycOverride = null;
/** Tests: require verification before going online (true/false), or null for the configured behaviour. */
export const useRiderKyc = (value) => (riderKycOverride = value);
const riderKycRequired = () => riderKycOverride ?? env.riderKycRequired;

// [notification type, title, body] per decision.
const VERIFICATION_NOTICE = {
  [V.APPROVED]: ["rider.verified", "You are verified", "You can go online and start delivering."],
  [V.REJECTED]: ["rider.rejected", "Your verification was not approved", "See the reason on the Verification page."],
  [V.RESUBMISSION_REQUESTED]: [
    "rider.documents_needed",
    "Please update your documents",
    "Fix what is asked on the Verification page, then send it for review again.",
  ],
};

export async function updateDetails(userId, address) {
  await getOrCreateProfile(userId);
  return profileJson(
    await DeliveryPartner.findOneAndUpdate({ user: userId }, { $set: { address } }, { returnDocument: "after" }),
  );
}

/** The rider fixed what was asked: back to the review queue. */
export async function resubmit(user) {
  const profile = await getOrCreateProfile(user._id);
  if (![V.REJECTED, V.RESUBMISSION_REQUESTED].includes(verificationOf(profile)))
    throw ApiError.conflict("Your verification is not waiting for changes");
  profile.verificationStatus = V.PENDING;
  profile.verificationReason = undefined;
  await profile.save();
  await notifyAdmins(
    {
      type: "rider.review",
      title: `Rider resubmitted: ${user.name}`,
      body: "Their documents are ready for another look.",
      link: `/admin/delivery-partners/${user._id}`,
    },
    PERMISSIONS.RIDERS_MANAGE,
  );
  return profileJson(profile);
}

/** What stops approval: documents, bank account, address (when required). */
async function verificationGaps(user, profile) {
  if (!riderKycRequired()) return [];
  return [...(await kyc.missing(user)), ...(profile.address ? [] : ["Address"])];
}

export async function adminGet(userId) {
  const user = await findRider(userId);
  return { user: user.toJSON(), profile: await profileJson(await getOrCreateProfile(user._id)) };
}

export async function adminSetVerification(userId, status, reason, adminId) {
  const user = await findRider(userId);
  const profile = await getOrCreateProfile(user._id);
  const current = verificationOf(profile);
  if (!(VERIFICATION_TRANSITIONS[current] ?? []).includes(status))
    throw ApiError.conflict(`Cannot change a ${current} rider to ${status}`);
  if (status !== V.APPROVED && !reason) throw ApiError.badRequest("A reason is required");
  if (status === V.APPROVED) {
    const gaps = await verificationGaps(user, profile);
    if (gaps.length) throw ApiError.conflict(`Finish the verification first: ${gaps.join(", ")}`, "KYC_INCOMPLETE");
  }
  const decided = { verificationStatus: status, verifiedAt: new Date(), verifiedBy: adminId };
  const updated = await DeliveryPartner.findOneAndUpdate(
    { _id: profile._id, verificationStatus: profile.verificationStatus ?? null }, // unchanged meanwhile
    status === V.APPROVED
      ? { $set: decided, $unset: { verificationReason: 1 } }
      : { $set: { ...decided, verificationReason: reason } },
    { returnDocument: "after" },
  );
  if (!updated) throw ApiError.conflict("This rider was updated by someone else. Refresh and try again.");
  // Mid-delivery: they finish it.
  if (status !== V.APPROVED)
    await takeOffline(user._id, updated, "", {
      source: AVAILABILITY_SOURCES.SYSTEM,
      reason: VERIFICATION_OFFLINE_REASON[status],
    }).catch(() => undefined);
  const [type, title, body] = VERIFICATION_NOTICE[status];
  await notify(user._id, {
    type,
    title,
    body: reason && status !== V.APPROVED ? `${body} Reason: ${reason}` : body,
    link: "/delivery/verification",
  });
  return adminGet(userId);
}
