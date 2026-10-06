import type mongoose from "mongoose";

import type { IAuditLog } from "@/db/models/audit-logs/audit-log";
import type { IAuditEventSkeleton } from "@/db/plugins/audit/utils/audit.types";
import type {
  AuditAction,
  AuditCategory,
  AuditStatus,
  AuditTargetType,
} from "@/enums/audit.enum";

export type IAuditEventBase = Omit<
  IAuditLog,
  "_id" | "_sig" | "_prevSig" | "signedSnapshot"
>;

export interface IAuditEventInput {
  action: AuditAction;
  status: AuditStatus;
  category?: AuditCategory;
  targetType?: AuditTargetType | null;
  targetId?: mongoose.Types.ObjectId | string | null;
  metadata?: Record<string, unknown>;
  changes?: IAuditEventSkeleton["changes"];
  failureReason?: string;
  target?: IAuditEventSkeleton["target"];
  context?: Partial<IAuditEventSkeleton["context"]>;
  retentionDays?: number | null;
}
