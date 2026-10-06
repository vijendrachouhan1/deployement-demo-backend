import type { Query, Types } from "mongoose";

import type { IAuditLog } from "@/db/models/audit-logs/audit-log";
import type { USER_TYPE } from "@/enums";
import type { ChangeType } from "@/db/plugins/audit/utils/audit-change.enum";

// --- Field-level change diff (audit-change.ts) ---
export type Doc = Record<string, unknown>;

export interface FieldChange {
  field: string;
  before: unknown;
  after: unknown;
}

export interface AuditChangeEvent {
  model: string;
  recordId: string;
  changeType: ChangeType;
  changes?: FieldChange[];
  snapshot?: Doc;
  label: string | null;
}

export interface BulkSummaryEvent {
  model: string;
  op: string;
  matchedCount: number;
  filter: unknown;
  update: unknown;
}

export type BulkReadResult =
  { overflow: false; docs: Doc[] } | { overflow: true; matchedCount: number };

// --- Write engine (append-audit-log.ts) ---
export interface IAuditEventSkeleton {
  category: IAuditLog["category"];
  action: string;
  status: IAuditLog["status"];
  targetType: string | null;
  targetId: Types.ObjectId | null;
  requestId: string | null;
  target: IAuditLog["target"];
  context: IAuditLog["context"];
  metadata?: Record<string, unknown>;
  changes?: IAuditLog["changes"];
  failureReason?: string;
  retentionDays: number | null;
}

export interface IAppendOptions {
  throwOnFailure?: boolean;
}

// --- Plugin (audit.plugin.ts) ---
export interface IAuditPluginOptions {
  model: string;
  exclude?: string[];
  labelField?: string;
}

export type AuditQuery = Query<unknown, unknown> & {
  auditBefore?: Doc;
  auditDeleted?: Doc;
  auditBulkPlan?: BulkReadResult;
  auditDeletedMany?: Doc[];
};

// --- Company/tenant resolution (resolve-company-ref.ts) ---
export interface IAuditPrincipal {
  _id: Types.ObjectId;
  companyRef: Types.ObjectId | null;
  role: USER_TYPE;
  email: string | null;
  name: string | null;
}

export interface IResolveInput {
  targetType: string | null;
  targetId: Types.ObjectId | string | null;
}

// --- Size truncation (truncate.ts) ---
export interface ITruncatable {
  metadata?: Record<string, unknown>;
  changes?: unknown;
}
