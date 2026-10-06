import mongoose from "mongoose";

import { ChangeType } from "@/db/plugins/audit/utils/audit-change.enum";
import {
  AuditContext,
  currentSubsystem,
} from "@/db/plugins/audit/audit-context";
import { fireBackgroundAppend } from "@/db/plugins/audit/background-emit";
import type {
  AuditChangeEvent,
  BulkSummaryEvent,
  IAuditEventSkeleton,
} from "@/db/plugins/audit/utils/audit.types";
import { scrubSensitiveKeys } from "@/db/plugins/audit/utils/sensitive-keys";
import { AuditCategory, AuditStatus } from "@/enums/audit.enum";

const ACTION_VERB: Record<ChangeType, string> = {
  [ChangeType.Create]: "created",
  [ChangeType.Update]: "updated",
  [ChangeType.Delete]: "deleted",
};

export function appendDocumentChange(event: AuditChangeEvent): void {
  const ctx = AuditContext.get();
  const principal = ctx.principal ?? null;
  const subsystem = currentSubsystem();

  const skeleton: IAuditEventSkeleton = {
    category: AuditCategory.RECORD_CHANGE,
    action: `${event.model}.${ACTION_VERB[event.changeType]}`,
    status: AuditStatus.SUCCESS,
    targetType: event.model,
    targetId: mongoose.isValidObjectId(event.recordId)
      ? new mongoose.Types.ObjectId(event.recordId)
      : null,
    requestId: ctx.requestId ?? null,
    target: { label: event.label },
    context: {
      ip: ctx.ip ?? null,
      userAgent: ctx.userAgent ?? null,
      path: ctx.path ?? null,
      method: null,
    },
    metadata: event.snapshot ? { snapshot: event.snapshot } : undefined,
    changes: event.changes,
    retentionDays: null,
  };

  fireBackgroundAppend(skeleton, principal, subsystem);
}

export function appendBulkSummary(event: BulkSummaryEvent): void {
  const ctx = AuditContext.get();
  const principal = ctx.principal ?? null;
  const subsystem = currentSubsystem();

  const skeleton: IAuditEventSkeleton = {
    category: AuditCategory.RECORD_CHANGE,
    action: `${event.model}.bulk_updated`,
    status: AuditStatus.SUCCESS,
    targetType: event.model,
    targetId: null,
    requestId: ctx.requestId ?? null,
    target: { label: `${event.matchedCount} ${event.model} records (bulk)` },
    context: {
      ip: ctx.ip ?? null,
      userAgent: ctx.userAgent ?? null,
      path: ctx.path ?? null,
      method: null,
    },
    metadata: {
      bulk: {
        op: event.op,
        matchedCount: event.matchedCount,
        filter: scrubSensitiveKeys(event.filter),
        update: scrubSensitiveKeys(event.update),
      },
    },
    retentionDays: null,
  };

  fireBackgroundAppend(skeleton, principal, subsystem);
}
