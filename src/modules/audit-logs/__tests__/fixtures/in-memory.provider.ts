import type mongoose from "mongoose";

import type { IAuditLog } from "@/db/models/audit-logs/audit-log";
import { ROOT_SIG } from "@/db/plugins/audit/utils/chain.constant";
import type {
  IAuditLogPage,
  IAuditLogReadFilter,
  IAuditLogReadPagination,
  IAuditLogReadSort,
  IAuditLogRowInput,
  IAuditStorageProvider,
  ICasResult,
  IChainBatchCursor,
  IChainHeadSnapshot,
  IDlqRowInput,
} from "@/providers/audit-logs/utils/audit-provider.types";
import {
  parseSystemRefShortcut,
  SYSTEM_SUBSYSTEM_REFS,
  type SystemSubsystem,
} from "@/db/plugins/audit/utils/subsystem";

interface IInMemoryDlqRow extends IDlqRowInput {
  _sig: null;
  _prevSig: null;
  failureReason: string;
  dlqAt: Date;
}

interface IInMemoryChainHead {
  lastSig: string;
  subsystem: SystemSubsystem | null;
  updatedAt: Date;
}

export class InMemoryAuditProvider implements IAuditStorageProvider {
  readonly rows: IAuditLogRowInput[] = [];
  readonly heads = new Map<string, IInMemoryChainHead>();
  readonly dlq: IInMemoryDlqRow[] = [];

  appendRow = async (row: IAuditLogRowInput): Promise<void> => {
    this.rows.push(row);
  };

  getChainHead = async (
    chainId: mongoose.Types.ObjectId,
  ): Promise<IChainHeadSnapshot | null> => {
    const head = this.heads.get(chainId.toString());
    return head ? { lastSig: head.lastSig } : null;
  };

  casUpdateChainHead = async (
    chainId: mongoose.Types.ObjectId,
    prevSig: string,
    newSig: string,
    subsystem: SystemSubsystem | null,
  ): Promise<ICasResult> => {
    const key = chainId.toString();
    const existing = this.heads.get(key);
    if (!existing) {
      if (prevSig !== ROOT_SIG) {
        return { swapped: false, reason: "stale_prevsig" };
      }
      this.heads.set(key, {
        lastSig: newSig,
        subsystem,
        updatedAt: new Date(),
      });
      return { swapped: true };
    }
    if (existing.lastSig !== prevSig) {
      return { swapped: false, reason: "stale_prevsig" };
    }
    existing.lastSig = newSig;
    existing.updatedAt = new Date();
    return { swapped: true };
  };

  runInTransaction = async <T>(
    fn: (session: mongoose.ClientSession | null) => Promise<T>,
  ): Promise<T> => fn(null);

  writeDlq = async (
    row: IDlqRowInput,
    failureReason: string,
  ): Promise<void> => {
    this.dlq.push({
      ...row,
      _sig: null,
      _prevSig: null,
      failureReason,
      dlqAt: new Date(),
    });
  };

  findAuditLogs = async (
    _filter: IAuditLogReadFilter,
    pagination: IAuditLogReadPagination,
    _sort: IAuditLogReadSort,
  ): Promise<IAuditLogPage> => {
    return {
      items: this.rows as unknown as IAuditLog[],
      total: this.rows.length,
      page: pagination.page,
      pageSize: pagination.pageSize,
    };
  };

  findAuditLogsForExport = async (
    _filter: IAuditLogReadFilter,
    _sort: IAuditLogReadSort,
    limit: number,
  ): Promise<IAuditLog[]> => {
    return (this.rows as unknown as IAuditLog[]).slice(0, limit);
  };

  countAuditLogs = async (
    _filter: IAuditLogReadFilter,
    options?: { limit?: number },
  ): Promise<number> => {
    const total = this.rows.length;
    return options?.limit ? Math.min(total, options.limit) : total;
  };

  findChainBatch = async (
    companyRef: string,
    after: IChainBatchCursor | null,
    limit: number,
  ): Promise<IAuditLog[]> => {
    // Tenant-scope like the real provider's buildAuditLogMatch — returning all
    // rows would silently hand cross-tenant data to any test relying on this.
    const subsystem = parseSystemRefShortcut(companyRef);
    const resolvedRef = subsystem
      ? SYSTEM_SUBSYSTEM_REFS[subsystem].toString()
      : companyRef;
    const rows = (this.rows as unknown as IAuditLog[]).filter(
      (r) => String(r.companyRef) === resolvedRef,
    );
    const sorted = [...rows].sort(
      (a, b) =>
        a.timestamp.getTime() - b.timestamp.getTime() ||
        String(a._id).localeCompare(String(b._id)),
    );
    const fromIndex = after
      ? sorted.findIndex(
          (r) =>
            r.timestamp.getTime() > after.timestamp.getTime() ||
            (r.timestamp.getTime() === after.timestamp.getTime() &&
              String(r._id) > String(after._id)),
        )
      : 0;
    if (fromIndex === -1) return [];
    return sorted.slice(fromIndex, fromIndex + limit);
  };

  findAuditLogById = async (
    _id: mongoose.Types.ObjectId | string,
    _companyRefScope: mongoose.Types.ObjectId | string | null,
  ): Promise<IAuditLog | null> => {
    return null;
  };
}
