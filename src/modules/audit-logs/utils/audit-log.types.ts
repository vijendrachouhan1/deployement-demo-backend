import type mongoose from "mongoose";

import { auditLogValidators } from "@/modules/audit-logs/utils/audit-log.validation";
import type { AuditStatus } from "@/enums/audit.enum";

export type TAuditLogsAdminController = {
  getAuditLogs: typeof auditLogValidators.getAuditLogsAdmin;
  exportAuditLogs: typeof auditLogValidators.exportAuditLogsAdmin;
  getAuditLogById: typeof auditLogValidators.getAuditLogById;
};

export type TAuditLogsSuperAdminController = {
  getAuditLogs: typeof auditLogValidators.getAuditLogsSuperAdmin;
  exportAuditLogs: typeof auditLogValidators.exportAuditLogsSuperAdmin;
  getAuditLogById: typeof auditLogValidators.getAuditLogById;
  verifyChain: typeof auditLogValidators.verifyChain;
};

export type AuditExportFormat = "csv" | "json";

export interface ISerializedAuditLogs {
  body: Buffer;
  mimeType: string;
  ext: string;
}

export interface IAuditExportResult {
  url: string;
  key: string;
  format: AuditExportFormat;
  rowCount: number;
  truncated: boolean;
}

export interface IGetAuditLogsInput {
  page?: number;
  pageSize?: number;
  category?: string;
  action?: string;
  actorId?: string;
  actorEmail?: string;
  actorEmailSearch?: string;
  status?: AuditStatus;
  targetType?: string;
  targetId?: string;
  companyRef?: string | mongoose.Types.ObjectId;
  from?: string;
  to?: string;
  sortBy?: string;
  sortDir?: "asc" | "desc";
  hideInternalChanges?: boolean;
}
