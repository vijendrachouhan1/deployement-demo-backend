import mongoose from "mongoose";

import { USER_TYPE } from "@/enums";
import { AuditCategory, AuditStatus } from "@/enums/audit.enum";

const ObjectId = mongoose.Schema.Types.ObjectId;

export interface IAuditLogActor {
  name: string | null;
  impersonatedBy?: mongoose.Types.ObjectId;
}

export interface IAuditLogTarget {
  label: string | null;
}

export interface IAuditLogContext {
  ip: string | null;
  userAgent: string | null;
  path: string | null;
  method: string | null;
}

export interface IAuditLogChange {
  field: string;
  before: unknown;
  after: unknown;
}

export interface IAuditLog {
  _id: mongoose.Types.ObjectId;
  timestamp: Date;
  category: AuditCategory;
  action: string;
  status: AuditStatus;
  companyRef: mongoose.Types.ObjectId;
  actorId: mongoose.Types.ObjectId;
  actorEmail: string | null;
  actorRole: USER_TYPE;
  targetType: string | null;
  targetId: mongoose.Types.ObjectId | null;
  requestId: string | null;

  _sig: string;
  _prevSig: string;
  signedSnapshot?: string;
  subsystemMappingVersion: number;

  actor: IAuditLogActor;
  target: IAuditLogTarget;
  context: IAuditLogContext;

  changes?: IAuditLogChange[];
  metadata?: Record<string, unknown>;
  failureReason?: string;

  retentionDays: number | null;
}

export interface IAuditLogDocument extends IAuditLog {
  createdAt: Date;
  updatedAt: Date;
}

const ActorSchema = new mongoose.Schema<IAuditLogActor>(
  {
    name: {
      type: String,
      default: null,
    },
    impersonatedBy: {
      type: ObjectId,
      ref: "User",
    },
  },
  { _id: false },
);

const TargetSchema = new mongoose.Schema<IAuditLogTarget>(
  {
    label: {
      type: String,
      default: null,
    },
  },
  { _id: false },
);

const ContextSchema = new mongoose.Schema<IAuditLogContext>(
  {
    ip: {
      type: String,
      default: null,
    },
    userAgent: {
      type: String,
      default: null,
    },
    path: {
      type: String,
      default: null,
    },
    method: {
      type: String,
      default: null,
    },
  },
  { _id: false },
);

const ChangeSchema = new mongoose.Schema<IAuditLogChange>(
  {
    field: {
      type: String,
      required: true,
    },
    before: {
      type: mongoose.Schema.Types.Mixed,
    },
    after: {
      type: mongoose.Schema.Types.Mixed,
    },
  },
  { _id: false },
);

const AuditLogSchema = new mongoose.Schema<IAuditLogDocument>(
  {
    timestamp: {
      type: Date,
      required: true,
      default: Date.now,
    },
    category: {
      type: String,
      enum: Object.values(AuditCategory),
      required: true,
    },
    action: {
      type: String,
      required: true,
    },
    status: {
      type: String,
      enum: Object.values(AuditStatus),
      required: true,
    },
    companyRef: {
      type: ObjectId,
      ref: "Company",
      required: true,
    },
    actorId: {
      type: ObjectId,
      required: true,
    },
    actorEmail: {
      type: String,
      default: null,
    },
    actorRole: {
      type: String,
      enum: Object.values(USER_TYPE),
      required: true,
    },
    targetType: {
      type: String,
      default: null,
    },
    targetId: {
      type: ObjectId,
      default: null,
    },
    requestId: {
      type: String,
      default: null,
    },

    _sig: {
      type: String,
      required: true,
    },
    _prevSig: {
      type: String,
      required: true,
    },
    signedSnapshot: {
      type: String,
    },
    subsystemMappingVersion: {
      type: Number,
      required: true,
    },

    actor: {
      type: ActorSchema,
      required: true,
    },
    target: {
      type: TargetSchema,
      required: true,
    },
    context: {
      type: ContextSchema,
      required: true,
    },

    changes: {
      type: [ChangeSchema],
      default: undefined,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
    },
    failureReason: { type: String },

    retentionDays: {
      type: Number,
      default: null,
    },
  },
  {
    timestamps: true,
    collection: "audit_logs",
  },
);

AuditLogSchema.index({ timestamp: -1 });
AuditLogSchema.index({ companyRef: 1, timestamp: -1 });
AuditLogSchema.index({ companyRef: 1, timestamp: 1, _id: 1 });
AuditLogSchema.index({ category: 1, timestamp: -1 });
AuditLogSchema.index({ actorId: 1, timestamp: -1 });
AuditLogSchema.index({ action: 1, timestamp: -1 });
AuditLogSchema.index({ targetType: 1, targetId: 1, timestamp: -1 });
AuditLogSchema.index({ actorEmail: 1 });

export { AuditLogSchema };

export const AuditLogModel = mongoose.model<IAuditLogDocument>(
  "AuditLog",
  AuditLogSchema,
);
