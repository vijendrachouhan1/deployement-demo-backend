import mongoose from "mongoose";

import { USER_TYPE } from "@/enums";
import { AuditCategory, AuditStatus } from "@/enums/audit.enum";
import type {
  IAuditLogActor,
  IAuditLogChange,
  IAuditLogContext,
  IAuditLogTarget,
} from "@/db/models/audit-logs/audit-log";

const ObjectId = mongoose.Schema.Types.ObjectId;

/*
 * Sub-schemas re-declared (not imported from auditLog.ts) because a
 * single Mongoose subschema instance cannot be attached to two parent
 * schemas. Mirror auditLog.ts when adding fields here.
 */
export interface IAuditLogDlq {
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

  _sig: string | null;
  _prevSig: string | null;
  subsystemMappingVersion: number;

  actor: IAuditLogActor;
  target: IAuditLogTarget;
  context: IAuditLogContext;

  changes?: IAuditLogChange[];
  metadata?: Record<string, unknown>;
  failureReason: string;
  dlqAt: Date;

  retentionDays: number | null;
}

export interface IAuditLogDlqDocument extends IAuditLogDlq {
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

const AuditLogDlqSchema = new mongoose.Schema<IAuditLogDlqDocument>(
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
      default: null,
    },
    _prevSig: {
      type: String,
      default: null,
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
    failureReason: {
      type: String,
      required: true,
    },
    dlqAt: {
      type: Date,
      required: true,
    },

    retentionDays: {
      type: Number,
      default: null,
    },
  },
  {
    timestamps: true,
    collection: "audit_logs_dlq",
  },
);

AuditLogDlqSchema.index({ dlqAt: -1 });
AuditLogDlqSchema.index({ companyRef: 1, dlqAt: -1 });

export { AuditLogDlqSchema };

export const AuditLogDlqModel = mongoose.model<IAuditLogDlqDocument>(
  "AuditLogDlq",
  AuditLogDlqSchema,
);
