import type mongoose from "mongoose";

import type { IAuditLog } from "@/db/models/audit-logs/audit-log";
import type { AuditStatus } from "@/enums/audit.enum";
import type { SystemSubsystem } from "@/db/plugins/audit/utils/subsystem";
import type { IAuditEventBase } from "@/db/plugins/audit/utils/audit-event.types";

export type IAuditLogRowInput = IAuditEventBase & {
  _sig: string;
  _prevSig: string;
  signedSnapshot: string;
};

export type IDlqRowInput = IAuditEventBase;

export interface IChainHeadSnapshot {
  lastSig: string;
}

export type ICasFailureReason = "stale_prevsig" | "head_missing";

export interface ICasResult {
  swapped: boolean;
  reason?: ICasFailureReason;
}

export interface IAuditLogReadFilter {
  companyRef?: mongoose.Types.ObjectId | string;
  category?: string;
  action?: string;
  actorId?: mongoose.Types.ObjectId | string;
  actorEmail?: string;
  actorEmailSearch?: string;
  status?: AuditStatus;
  targetType?: string;
  targetId?: mongoose.Types.ObjectId | string;
  from?: Date;
  to?: Date;
  hideInternalChanges?: boolean;
}

export interface IAuditLogReadPagination {
  page: number;
  pageSize: number;
  skips: number;
}

export interface IAuditLogReadSort {
  field: string;
  direction: 1 | -1;
}

export interface IAuditLogPage {
  items: IAuditLog[];
  total: number;
  page: number;
  pageSize: number;
}

export interface IChainBatchCursor {
  timestamp: Date;
  _id: mongoose.Types.ObjectId;
}

export interface IAuditStorageProvider {
  appendRow(
    row: IAuditLogRowInput,
    session?: mongoose.ClientSession | null,
  ): Promise<void>;
  getChainHead(
    chainId: mongoose.Types.ObjectId,
    session?: mongoose.ClientSession | null,
  ): Promise<IChainHeadSnapshot | null>;
  casUpdateChainHead(
    chainId: mongoose.Types.ObjectId,
    prevSig: string,
    newSig: string,
    subsystem: SystemSubsystem | null,
    session?: mongoose.ClientSession | null,
  ): Promise<ICasResult>;

  runInTransaction<T>(
    fn: (session: mongoose.ClientSession | null) => Promise<T>,
  ): Promise<T>;
  writeDlq(row: IDlqRowInput, failureReason: string): Promise<void>;
  findAuditLogs(
    filter: IAuditLogReadFilter,
    pagination: IAuditLogReadPagination,
    sort: IAuditLogReadSort,
  ): Promise<IAuditLogPage>;
  findAuditLogsForExport(
    filter: IAuditLogReadFilter,
    sort: IAuditLogReadSort,
    limit: number,
  ): Promise<IAuditLog[]>;
  countAuditLogs(
    filter: IAuditLogReadFilter,
    options?: { limit?: number },
  ): Promise<number>;
  findChainBatch(
    companyRef: string,
    after: IChainBatchCursor | null,
    limit: number,
  ): Promise<IAuditLog[]>;
  findAuditLogById(
    id: mongoose.Types.ObjectId | string,
    companyRefScope: mongoose.Types.ObjectId | string | null,
  ): Promise<IAuditLog | null>;
}

// One Athena result row: column name → cell value (undefined when the cell is null).
export type AthenaRow = Record<string, string | undefined>;

export interface IColdChainRow {
  entryId: string;
  timestamp: Date;
  sig: string;
  prevSig: string;
  signedSnapshot: string | null;
  timestampUnparseable?: true;
}

export interface DayGroup {
  year: string;
  month: string;
  day: string;
  rows: IAuditLog[];
}

export interface ArchiveUploadResult {
  archivedIds: mongoose.Types.ObjectId[];
}

export interface IParquetBatchResult {
  buffer: Buffer;
  archivedIds: mongoose.Types.ObjectId[];
}
