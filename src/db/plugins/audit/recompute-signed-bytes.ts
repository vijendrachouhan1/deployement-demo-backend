import type { IAuditLog } from "@/db/models/audit-logs/audit-log";
import { deterministicJson } from "@/db/plugins/audit/utils/deterministic-json";
import type { IAuditEventBase } from "@/db/plugins/audit/utils/audit-event.types";

/*
 * Lockstep contract with buildBaseEvent (append-audit-log.ts): this explicit
 * projection must reproduce the emit-time signed bytes exactly. A field emitted
 * into the signed bytes but missing here makes chain verification report false
 * signature breaks on every row emitted after the change.
 */
export function recomputeSignedBytes(row: IAuditLog): string {
  const baseEvent: IAuditEventBase = {
    timestamp: row.timestamp,
    category: row.category,
    action: row.action,
    status: row.status,
    companyRef: row.companyRef,
    actorId: row.actorId,
    actorEmail: row.actorEmail,
    actorRole: row.actorRole,
    targetType: row.targetType,
    targetId: row.targetId,
    requestId: row.requestId,
    subsystemMappingVersion: row.subsystemMappingVersion,
    actor: { name: row.actor.name },
    target: row.target,
    context: row.context,
    changes: row.changes,
    metadata: row.metadata,
    failureReason: row.failureReason,
    retentionDays: row.retentionDays,
  };
  return deterministicJson(baseEvent);
}
