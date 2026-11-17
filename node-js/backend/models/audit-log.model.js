import mongoose from "mongoose";

/** Kinds of account an entry can be about (the target user's kind; "" when not a user). */
export const AUDIT_ACCOUNT_TYPES = Object.freeze(["customer", "restaurant", "delivery", "admin", ""]);

/** One important admin action: who did what to which record, and when. Append-only. */
const auditLogSchema = new mongoose.Schema(
  {
    admin: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    adminRole: { type: String, required: true },
    action: { type: String, required: true, maxlength: 60 }, // e.g. "order.cancel"
    description: { type: String, required: true, maxlength: 500 },
    resourceType: { type: String, maxlength: 40 },
    resourceId: { type: String, maxlength: 64 },
    ip: { type: String, maxlength: 64 },
    // The target user's kind when the resource is a user account.
    accountType: { type: String, enum: AUDIT_ACCOUNT_TYPES, default: "" },
    // What changed: { field: { from, to } } (never secrets: passwords, tokens, full bank/ID numbers).
    changes: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
    reason: { type: String, maxlength: 500, default: "" },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    minimize: false, // keep `changes: {}`
    toJSON: {
      versionKey: false,
      transform: (_doc, ret) => {
        ret.id = String(ret._id);
        delete ret._id;
        return ret;
      },
    },
  },
);

auditLogSchema.index({ createdAt: -1 });
auditLogSchema.index({ admin: 1, createdAt: -1 });
auditLogSchema.index({ action: 1, createdAt: -1 });
auditLogSchema.index({ resourceId: 1, createdAt: -1 });
auditLogSchema.index({ accountType: 1, createdAt: -1 });

// Append-only: rows made through Mongoose can never be changed or removed.
const immutable = function () {
  throw new Error("AUDIT_IMMUTABLE: audit rows cannot be changed");
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
  auditLogSchema.pre(op, immutable);
auditLogSchema.pre("save", function () {
  if (!this.isNew) immutable();
});

export const AuditLog = mongoose.model("AuditLog", auditLogSchema);
