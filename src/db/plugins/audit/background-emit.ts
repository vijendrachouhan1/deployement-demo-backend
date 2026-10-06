import { appendAuditLog } from "@/db/plugins/audit/append-audit-log";
import type { IAuditEventSkeleton } from "@/db/plugins/audit/utils/audit.types";
import type { IAuditPrincipal } from "@/db/plugins/audit/utils/audit.types";
import type { SystemSubsystem } from "@/db/plugins/audit/utils/subsystem";

/*
 * In-flight background appends, tracked so tests can await them before asserting
 * or clearing the DB (see drainPendingEmits). Cheap in prod — one Set entry that
 * lives only for the duration of a fire-and-forget append.
 */
const pendingEmits = new Set<Promise<void>>();

/*
 * Fire an audit append on the next tick and forget it. The single place both the
 * app-level emit helper and the Mongoose plugin route their best-effort appends
 * through, so every background emit is tracked for draining.
 */
export function fireBackgroundAppend(
  skeleton: IAuditEventSkeleton,
  principal: IAuditPrincipal | null,
  subsystem: SystemSubsystem | null,
): void {
  const done = new Promise<void>((resolve) => {
    setImmediate(() => {
      appendAuditLog(skeleton, principal, subsystem, {
        throwOnFailure: false,
      })
        .catch((err) => {
          console.error("[audit-logs] background emit rejected", err);
        })
        .finally(resolve);
    });
  });

  pendingEmits.add(done);
  void done.finally(() => pendingEmits.delete(done));
}

/*
 * Await all currently in-flight background emits. Test-only: prevents a
 * fire-and-forget emit from one test committing after the next test has started
 * (the appends run in a transaction now, so they settle a beat later).
 */
export async function drainPendingEmits(): Promise<void> {
  await Promise.all([...pendingEmits]);
}
