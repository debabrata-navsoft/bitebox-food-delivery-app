import { AVAILABILITY_SOURCES, RiderAvailabilityLog } from "../models/rider-availability-log.model.js";
import { logger } from "../config/logger.js";
import { DeliveryPartner } from "../models/delivery-partner.model.js";
import { paginationMeta } from "../utils/pagination.js";

export { AVAILABILITY_SOURCES };

/**
 * Rider availability history (Django delivery/availability.py): one append-only row per
 * online/offline change. Every path that changes `DeliveryPartner.isOnline` goes through
 * setOnline() (or logs the change itself with logAvailability) so no change goes unrecorded.
 */

/** Records one change. Best-effort: a failed write is logged and never fails the caller. */
export async function logAvailability(riderId, isOnline, source, reason = null, at = new Date()) {
  try {
    await RiderAvailabilityLog.create({ rider: riderId, isOnline, source, reason: reason || null, at });
  } catch (error) {
    logger.error({ err: error, riderId: String(riderId) }, "Could not record rider availability");
  }
}

/**
 * Sets the rider's `isOnline` along with `set` (other fields) on the profile matching
 * `{ user: riderId, ...where }`, and records the change when the value actually changed.
 * Returns the profile as it was before (null when none matched).
 */
export async function setOnline(riderId, isOnline, { source, reason = null, set = {}, where = {} }) {
  const before = await DeliveryPartner.findOneAndUpdate(
    { user: riderId, ...where },
    { $set: { ...set, isOnline } },
    { returnDocument: "before" },
  );
  if (before && Boolean(before.isOnline) !== isOnline)
    await logAvailability(riderId, isOnline, source, reason);
  return before;
}

/** GET /admin/delivery-partner-accounts/:id/availability: newest first. */
export async function history(riderId, pagination) {
  const filter = { rider: riderId };
  const [rows, total] = await Promise.all([
    RiderAvailabilityLog.find(filter)
      .sort({ at: -1, _id: -1 })
      .skip(pagination.skip)
      .limit(pagination.limit)
      .lean(),
    RiderAvailabilityLog.countDocuments(filter),
  ]);
  return {
    items: rows.map((r) => ({ isOnline: r.isOnline, at: r.at, source: r.source, reason: r.reason ?? null })),
    pagination: paginationMeta(pagination, total),
  };
}
