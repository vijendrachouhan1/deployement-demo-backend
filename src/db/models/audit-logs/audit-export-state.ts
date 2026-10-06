import mongoose from "mongoose";

const ObjectId = mongoose.Schema.Types.ObjectId;

export interface IAuditExportState {
  _id: string;
  lastExportedAt: Date | null;
  lastExportedId: mongoose.Types.ObjectId | null;
  status: string;
}

export interface IAuditExportStateDocument extends IAuditExportState {
  createdAt: Date;
  updatedAt: Date;
}

const AuditExportStateSchema = new mongoose.Schema<IAuditExportStateDocument>(
  {
    _id: {
      type: String,
      required: true,
    },
    lastExportedAt: {
      type: Date,
      default: null,
    },
    lastExportedId: {
      type: ObjectId,
      default: null,
    },
    status: {
      type: String,
      required: true,
    },
  },
  {
    timestamps: true,
    collection: "audit_export_state",
    _id: false,
  },
);

export { AuditExportStateSchema };

export const AuditExportStateModel = mongoose.model<IAuditExportStateDocument>(
  "AuditExportState",
  AuditExportStateSchema,
);
