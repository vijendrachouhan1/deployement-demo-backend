import type { AuditStatus } from "@/enums/audit.enum";

export interface IAthenaFilters {
  action?: string;
  resource?: string;
  resourceId?: string;
  actor?: string;
  status?: AuditStatus;
  startDate?: string;
  endDate?: string;
}
