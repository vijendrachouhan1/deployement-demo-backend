import type { IAuditStorageProvider } from "@/providers/audit-logs/utils/audit-provider.types";

// IoC seam: the db-layer engine can't import the adapter up in providers/, so
// providers/ registers it here and the engine reads it back. Avoids a cycle.
let activeProvider: IAuditStorageProvider | null = null;

export function setActiveAuditStorageProvider(
  provider: IAuditStorageProvider,
): void {
  activeProvider = provider;
}

export function getActiveAuditStorageProvider(): IAuditStorageProvider {
  if (!activeProvider) {
    throw new Error(
      "[audit-logs] storage provider not registered — ensure the audit storage " +
        "provider (providers/audit-logs) is imported during boot before any audit " +
        "event is emitted",
    );
  }
  return activeProvider;
}
