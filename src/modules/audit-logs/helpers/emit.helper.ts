import mongoose from "mongoose";

import { appendAuditLog } from "@/db/plugins/audit/append-audit-log";
import { fireBackgroundAppend } from "@/db/plugins/audit/background-emit";
import type { IAuditEventSkeleton } from "@/db/plugins/audit/utils/audit.types";
import {
  AuditContext,
  currentSubsystem,
} from "@/db/plugins/audit/audit-context";
import type { IAuditContext } from "@/db/plugins/audit/utils/audit-context.types";
import type { IAuditEventInput } from "@/db/plugins/audit/utils/audit-event.types";
import { AuditCategory } from "@/enums/audit.enum";

function normalizeTargetId(
  value: IAuditEventInput["targetId"],
): mongoose.Types.ObjectId | null {
  if (!value) return null;
  const raw =
    typeof value === "object" && "_id" in value
      ? (value as { _id: unknown })._id
      : value;
  return mongoose.isValidObjectId(raw)
    ? new mongoose.Types.ObjectId(String(raw))
    : null;
}

function buildSkeleton(
  input: IAuditEventInput,
  ctx: IAuditContext,
): IAuditEventSkeleton {
  return {
    category: input.category ?? AuditCategory.ADMIN_ACTION,
    action: input.action,
    status: input.status,
    targetType: input.targetType ?? null,
    targetId: normalizeTargetId(input.targetId),
    requestId: ctx.requestId ?? null,
    target: input.target ?? { label: null },
    context: {
      ip: input.context?.ip ?? ctx.ip ?? null,
      userAgent: input.context?.userAgent ?? ctx.userAgent ?? null,
      path: input.context?.path ?? ctx.path ?? null,
      method: input.context?.method ?? null,
    },
    metadata: input.metadata,
    changes: input.changes,
    failureReason: input.failureReason,
    retentionDays: input.retentionDays ?? null,
  };
}

export function emitAuditLog(input: IAuditEventInput): void {
  const ctx = AuditContext.get();
  const principal = ctx.principal ?? null;
  const subsystem = currentSubsystem();
  const skeleton = buildSkeleton(input, ctx);

  fireBackgroundAppend(skeleton, principal, subsystem);
}

export { drainPendingEmits } from "@/db/plugins/audit/background-emit";

export async function emitAuditLogSync(input: IAuditEventInput): Promise<void> {
  const ctx = AuditContext.get();
  const principal = ctx.principal ?? null;
  const subsystem = currentSubsystem();
  const skeleton = buildSkeleton(input, ctx);

  await appendAuditLog(skeleton, principal, subsystem, {
    throwOnFailure: true,
  });
}

export function safeEmit(input: IAuditEventInput): void {
  try {
    emitAuditLog(input);
  } catch (err) {
    console.error("[audit-logs] safeEmit caught synchronous throw", err);
  }
}

const FAILURE_REASON_MAX = 4000;

export function summarizeFailureReason(err: unknown): string {
  const raw =
    err instanceof Error
      ? err.message
      : typeof err === "string"
        ? err
        : "unknown";
  return raw.length > FAILURE_REASON_MAX
    ? raw.slice(0, FAILURE_REASON_MAX)
    : raw;
}
