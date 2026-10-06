import mongoose from "mongoose";

const ObjectId = mongoose.Schema.Types.ObjectId;

export interface IAuditExportQuota {
  _id: string;
  userId: mongoose.Types.ObjectId;
  count: number;
  expiresAt: Date;
}

export interface IAuditExportQuotaDocument extends IAuditExportQuota {
  updatedAt: Date;
}

const AuditExportQuotaSchema = new mongoose.Schema<IAuditExportQuotaDocument>(
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
    collection: "audit_export_quota",
    _id: false,
  },
);

AuditExportQuotaSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export { AuditExportQuotaSchema };

export const AuditExportQuotaModel = mongoose.model<IAuditExportQuotaDocument>(
  "AuditExportQuota",
  AuditExportQuotaSchema,
);
