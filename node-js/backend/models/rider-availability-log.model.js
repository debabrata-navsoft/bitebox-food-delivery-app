import mongoose from "mongoose";

/** Who changed a rider's availability: the rider, an admin, or the system (automatic paths). */
export const AVAILABILITY_SOURCES = Object.freeze({
  RIDER: "rider",
  ADMIN: "admin",
  SYSTEM: "system",
});

/**
 * One row per online/offline change of a rider (Django delivery.RiderAvailabilityLog).
 * Append-only: written by services/rider-availability.service.js#logAvailability only.
 */
const riderAvailabilityLogSchema = new mongoose.Schema(
  {
    // The rider's User id.
    rider: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    isOnline: { type: Boolean, required: true },
    at: { type: Date, required: true, default: Date.now },
    source: { type: String, enum: Object.values(AVAILABILITY_SOURCES), required: true },
    reason: { type: String, trim: true, maxlength: 500, default: null },
  },
  { versionKey: false },
);

riderAvailabilityLogSchema.index({ rider: 1, at: -1, _id: -1 });

const appendOnly = function () {
  throw new Error("Availability history rows cannot be changed");
};
for (const op of [
  "updateOne",
  "updateMany",
  "findOneAndUpdate",
  "replaceOne",
  "deleteOne",
  "deleteMany",
  "findOneAndDelete",
])
  riderAvailabilityLogSchema.pre(op, appendOnly);
riderAvailabilityLogSchema.pre("save", function () {
  if (!this.isNew) appendOnly();
});

export const RiderAvailabilityLog = mongoose.model("RiderAvailabilityLog", riderAvailabilityLogSchema);
