import type { IAuditPrincipal } from "@/db/plugins/audit/utils/audit.types";

export interface IAuditContext {
  requestId?: string;
  ip?: string;
  path?: string;
  userAgent?: string;
  userId?: string;
  principal?: IAuditPrincipal | null;
}
