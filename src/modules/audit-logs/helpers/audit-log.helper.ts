import crypto from "crypto";
import mongoose from "mongoose";

import { AUDIT_CONSTANTS } from "@/providers/audit-logs/utils/audit.constant";
import { buildPaginatedResponse } from "@/helpers/pagination";
import { extractLimitAndOffset } from "@/helpers/pagination";
import { serializeAuditLogs } from "@/modules/audit-logs/utils/audit-log-serializer.util";
import type {
  AuditExportFormat,
  IAuditExportResult,
  IGetAuditLogsInput,
} from "@/modules/audit-logs/utils/audit-log.types";
import { AuditExportQuotaModel } from "@/db/models/audit-logs/audit-export-quota";
import { AuditVerifyQuotaModel } from "@/db/models/audit-logs/audit-verify-quota";
import { MigrationLockModel } from "@/db/models/audit-logs/migration-lock";
import { mongoAuditProvider } from "@/providers/audit-logs";
import { emitAuditLogSync } from "@/modules/audit-logs/helpers/emit.helper";
import { athenaChainReader } from "@/providers/audit-logs/athena-chain-reader";
import { RETENTION_SWEEP_ID } from "@/modules/audit-logs/helpers/retention/sweep.helper";
import { verifyChain as walkChain } from "@/modules/audit-logs/helpers/verify/verify-chain.helper";
import type { IChainVerifyReport } from "@/modules/audit-logs/utils/verify.types";
import { fileStorageService } from "@/providers/file-storage";
import type {
  IAuditLogReadFilter,
  IAuditLogReadSort,
} from "@/providers/audit-logs/utils/audit-provider.types";
import type { IAuditLog } from "@/db/models/audit-logs/audit-log";
import { AuditAction, AuditCategory, AuditStatus } from "@/enums/audit.enum";

/*
 * Hard cap on rows returned by a single export. Beyond this the slice is
 * truncated (newest-first by sort order) and flagged, never silently dropped.
 */
export const EXPORT_ROW_CAP = 5000;
export const EXPORT_QUOTA_WINDOW_MS = 48 * 60 * 60 * 1000; // 48h
export const VERIFY_QUOTA_WINDOW_MS = 48 * 60 * 60 * 1000;

function pickExportFilters(input: IGetAuditLogsInput): Record<string, unknown> {
  const candidates: Record<string, unknown> = {
    category: input.category,
    action: input.action,
    actorId: input.actorId,
    actorEmail: input.actorEmail,
    actorEmailSearch: input.actorEmailSearch,
    status: input.status,
    targetType: input.targetType,
    targetId: input.targetId,
    from: input.from ? new Date(input.from).toISOString() : undefined,
    to: input.to ? new Date(input.to).toISOString() : undefined,
    sortBy: input.sortBy,
    sortDir: input.sortDir,
  };

  const filters: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(candidates)) {
    if (value !== undefined) filters[key] = value;
  }
  return filters;
}

export class AuditLogsHelper {
  getAuditLogs = async (input: IGetAuditLogsInput) => {
    const { page, pageSize, skips } = extractLimitAndOffset(
      input.page,
      input.pageSize,
    );

    const filter: IAuditLogReadFilter = {
      companyRef: input.companyRef,
      category: input.category,
      action: input.action,
      actorId: input.actorId,
      actorEmail: input.actorEmail,
      actorEmailSearch: input.actorEmailSearch,
      status: input.status,
      targetType: input.targetType,
      targetId: input.targetId,
      from: input.from ? new Date(input.from) : undefined,
      to: input.to ? new Date(input.to) : undefined,
      hideInternalChanges: input.hideInternalChanges,
    };

    const sort: IAuditLogReadSort = {
      field: input.sortBy ?? "timestamp",
      direction: input.sortDir === "asc" ? 1 : -1,
    };

    const { items, total } = await mongoAuditProvider.findAuditLogs(
      filter,
      { page, pageSize, skips },
      sort,
    );

    return buildPaginatedResponse<IAuditLog>(items, {
      page,
      pageSize,
      totalCount: total,
    });
  };

  getAuditLogsForExport = async (
    input: IGetAuditLogsInput,
  ): Promise<{ rows: IAuditLog[]; rowCount: number; truncated: boolean }> => {
    const filter: IAuditLogReadFilter = {
      companyRef: input.companyRef,
      category: input.category,
      action: input.action,
      actorId: input.actorId,
      actorEmail: input.actorEmail,
      actorEmailSearch: input.actorEmailSearch,
      status: input.status,
      targetType: input.targetType,
      targetId: input.targetId,
      from: input.from ? new Date(input.from) : undefined,
      to: input.to ? new Date(input.to) : undefined,
    };

    const sort: IAuditLogReadSort = {
      field: input.sortBy ?? "timestamp",
      direction: input.sortDir === "asc" ? 1 : -1,
    };

    // Fetch one extra row to detect overflow, then slice to the cap.
    const fetched = await mongoAuditProvider.findAuditLogsForExport(
      filter,
      sort,
      EXPORT_ROW_CAP + 1,
    );

    const truncated = fetched.length > EXPORT_ROW_CAP;
    const rows = truncated ? fetched.slice(0, EXPORT_ROW_CAP) : fetched;

    return { rows, rowCount: rows.length, truncated };
  };

  /*
   * Serialize the full filtered slice, upload it to the export S3 prefix, and
   * return a short-lived presigned GET URL — never the bytes. Shared by the
   * admin and super-admin export controllers (each owns its own scoping).
   */
  runExport = async (
    input: IGetAuditLogsInput,
    format: AuditExportFormat,
    scopeLabel: string,
  ): Promise<IAuditExportResult> => {
    const { rows, rowCount, truncated } =
      await this.getAuditLogsForExport(input);

    const { body, mimeType, ext } = serializeAuditLogs(rows, format);

    /*
     * scopeLabel may be a system-ref shortcut (e.g. "system:auth"); keep the S3
     * key segment to a safe charset so colons/odd chars don't leak into the key.
     */
    const safeScope = scopeLabel.replace(/[^A-Za-z0-9_-]/g, "-");
    const key = `${AUDIT_CONSTANTS.exportS3Prefix}/${safeScope}/${Date.now()}-${crypto.randomUUID()}.${ext}`;

    // Throws on failure → propagates to controller's next(error) → 5xx, no link.
    await fileStorageService.upload({ key, buffer: body, mimeType });

    const { url } = await fileStorageService.getPreSignedUrl(key, mimeType, {
      operation: "get",
      expiresIn: AUDIT_CONSTANTS.exportUrlTtlSeconds,
      downloadFilename: `audit-logs-${safeScope}.${ext}`,
    });

    return { url, key, format, rowCount, truncated };
  };

  /*
   * Atomically increment and read the caller's export counter for the current
   * 48h window, then report whether they're still under the cap. Single
   * findOneAndUpdate ($inc + upsert) so concurrent exports from one user can't
   * both pass on a stale count. Rejected attempts are NOT decremented — they
   * still count toward the window (cost/DoS guard intent).
   */
  checkAndIncrementExportQuota = async (
    userId: string,
  ): Promise<{ allowed: boolean; count: number; windowStart: number }> => {
    const windowStart =
      Math.floor(Date.now() / EXPORT_QUOTA_WINDOW_MS) * EXPORT_QUOTA_WINDOW_MS;
    const _id = `${userId}:${windowStart}`;

    const doc = await AuditExportQuotaModel.findOneAndUpdate(
      { _id },
      {
        $inc: { count: 1 },
        $setOnInsert: {
          userId: new mongoose.Types.ObjectId(userId),
          expiresAt: new Date(windowStart + EXPORT_QUOTA_WINDOW_MS),
        },
      },
      { upsert: true, new: true },
    );

    return {
      allowed: doc.count <= AUDIT_CONSTANTS.exportMaxPerWindow,
      count: doc.count,
      windowStart,
    };
  };

  /*
   * Refund one slot in the window the charge landed in. The caller passes the
   * windowStart captured at increment time — recomputing it here would target
   * the wrong bucket (and no-op the refund) when a slow request crosses the
   * window boundary before it fails. Best-effort: floored at 0, no-op if the
   * window doc was already TTL-reaped.
   */
  decrementExportQuota = async (
    userId: string,
    windowStart: number,
  ): Promise<void> => {
    const _id = `${userId}:${windowStart}`;

    await AuditExportQuotaModel.updateOne(
      { _id, count: { $gt: 0 } },
      { $inc: { count: -1 } },
    );
  };

  checkAndIncrementVerifyQuota = async (
    userId: string,
  ): Promise<{ allowed: boolean; count: number; windowStart: number }> => {
    const windowStart =
      Math.floor(Date.now() / VERIFY_QUOTA_WINDOW_MS) * VERIFY_QUOTA_WINDOW_MS;
    const _id = `${userId}:${windowStart}`;

    const doc = await AuditVerifyQuotaModel.findOneAndUpdate(
      { _id },
      {
        $inc: { count: 1 },
        $setOnInsert: {
          userId: new mongoose.Types.ObjectId(userId),
          expiresAt: new Date(windowStart + VERIFY_QUOTA_WINDOW_MS),
        },
      },
      { upsert: true, new: true },
    );

    return {
      allowed: doc.count <= AUDIT_CONSTANTS.verifyMaxPerWindow,
      count: doc.count,
      windowStart,
    };
  };

  decrementVerifyQuota = async (
    userId: string,
    windowStart: number,
  ): Promise<void> => {
    const _id = `${userId}:${windowStart}`;

    await AuditVerifyQuotaModel.updateOne(
      { _id, count: { $gt: 0 } },
      { $inc: { count: -1 } },
    );
  };

  estimateChainRows = async (companyRef: string): Promise<number> => {
    const hot = await mongoAuditProvider.countAuditLogs(
      { companyRef },
      { limit: AUDIT_CONSTANTS.verifyMaxRows + 1 },
    );
    if (!athenaChainReader.isColdTierConfigured()) return hot;
    return hot + (await athenaChainReader.countColdChain(companyRef));
  };

  isRetentionSweepActive = async (): Promise<boolean> => {
    const lock = await MigrationLockModel.findOne({
      _id: RETENTION_SWEEP_ID,
      expiresAt: { $gte: new Date() },
    })
      .select("_id")
      .lean();
    return lock !== null;
  };

  verifyChain = async (companyRef: string): Promise<IChainVerifyReport> => {
    return walkChain(companyRef);
  };

  emitExportRun = async (args: {
    scopeLabel: string;
    format: AuditExportFormat;
    filters: IGetAuditLogsInput;
    rowCount: number;
    truncated: boolean;
  }): Promise<void> => {
    await emitAuditLogSync({
      action: AuditAction.ADMIN_EXPORT_RUN,
      status: AuditStatus.SUCCESS,
      category: AuditCategory.ADMIN_ACTION,
      metadata: {
        companyRef: args.scopeLabel,
        format: args.format,
        rowCount: args.rowCount,
        truncated: args.truncated,
        filters: pickExportFilters(args.filters),
      },
    });
  };

  getAuditLogById = async (
    id: string,
    companyRefScope: mongoose.Types.ObjectId | null,
  ): Promise<IAuditLog | null> => {
    return mongoAuditProvider.findAuditLogById(id, companyRefScope);
  };
}

export const auditLogsHelper = new AuditLogsHelper();
