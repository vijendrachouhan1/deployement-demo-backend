import { AsyncLocalStorage } from "async_hooks";

import type { SystemSubsystem } from "@/db/plugins/audit/utils/subsystem";
import type { IAuditContext } from "@/db/plugins/audit/utils/audit-context.types";

const auditStorage = new AsyncLocalStorage<IAuditContext>();
const subsystemStorage = new AsyncLocalStorage<SystemSubsystem>();

export class AuditContext {
  static run<T>(context: IAuditContext, fn: () => T): T {
    return auditStorage.run(context, fn);
  }

  static get(): IAuditContext {
    return auditStorage.getStore() ?? {};
  }
}

export function runWithSubsystem<T>(
  subsystem: SystemSubsystem,
  fn: () => T,
): T {
  return subsystemStorage.run(subsystem, fn);
}

export function currentSubsystem(): SystemSubsystem | null {
  return subsystemStorage.getStore() ?? null;
}
