import mongoose from "mongoose";

const ObjectId = mongoose.Schema.Types.ObjectId;

export interface IAuditVerifyQuota {
  _id: string;
  userId: mongoose.Types.ObjectId;
  count: number;
  expiresAt: Date;
}

export interface IAuditVerifyQuotaDocument extends IAuditVerifyQuota {
  updatedAt: Date;
}

const AuditVerifyQuotaSchema = new mongoose.Schema<IAuditVerifyQuotaDocument>(
  {
    _id: {
      type: String,
      required: true,
    },
    userId: {
      type: ObjectId,
      ref: "User",
      required: true,
    },
    count: {
      type: Number,
      required: true,
      default: 0,
    },
    expiresAt: {
      type: Date,
      required: true,
    },
  },
  {
    timestamps: {
      createdAt: false,
      updatedAt: true,
    },
    collection: "audit_verify_quota",
    _id: false,
  },
);

AuditVerifyQuotaSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export { AuditVerifyQuotaSchema };

export const AuditVerifyQuotaModel = mongoose.model<IAuditVerifyQuotaDocument>(
  "AuditVerifyQuota",
  AuditVerifyQuotaSchema,
);
