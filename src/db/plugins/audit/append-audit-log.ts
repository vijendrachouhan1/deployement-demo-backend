import type mongoose from "mongoose";

import { USER_TYPE } from "@/enums";
import {
  HASH_INPUT_SEPARATOR,
  ROOT_SIG,
} from "@/db/plugins/audit/utils/chain.constant";
import { deterministicJson } from "@/db/plugins/audit/utils/deterministic-json";
import { sha256 } from "@/db/plugins/audit/utils/sha256";
import { getActiveAuditStorageProvider } from "@/db/plugins/audit/provider-registry";
import { resolveCompanyRefForEmit } from "@/db/plugins/audit/resolve-company-ref";
import {
  assertWithinBsonLimit,
  truncateOversized,
} from "@/db/plugins/audit/utils/truncate";
import type { IAuditStorageProvider } from "@/providers/audit-logs/utils/audit-provider.types";
import type { IAuditEventBase } from "@/db/plugins/audit/utils/audit-event.types";
import type {
  IAuditEventSkeleton,
  IAppendOptions,
  IAuditPrincipal,
} from "@/db/plugins/audit/utils/audit.types";
import {
  SUBSYSTEM_MAPPING_VERSION,
  SYSTEM_SUBSYSTEM_REFS,
  SystemSubsystem,
} from "@/db/plugins/audit/utils/subsystem";

const MAX_ATTEMPTS = 5;

/*
 * If the chain id is one of the fixed system sentinels, return its subsystem
 * name (auth/cron/…); otherwise it's a real company, so use the given fallback.
 * The result is stamped onto the chain head via $setOnInsert (first write only).
 */
function subsystemForChain(
  chainId: mongoose.Types.ObjectId,
  fallback: SystemSubsystem | null,
): SystemSubsystem | null {
  for (const [name, ref] of Object.entries(SYSTEM_SUBSYSTEM_REFS)) {
    if (ref.equals(chainId)) return name as SystemSubsystem;
  }
  return fallback;
}

/*
 * Lockstep contract: every field this event carries (the skeleton spread
 * included) enters the signed bytes. recompute-signed-bytes.ts rebuilds those
 * bytes from a stored row via an explicit field list — add a field here without
 * adding it there and chain verification false-flags every row emitted after
 * the change as a signature break.
 */
function buildBaseEvent(
  skeleton: IAuditEventSkeleton,
  principal: IAuditPrincipal | null,
  companyRef: mongoose.Types.ObjectId,
): IAuditEventBase {
  return {
    ...skeleton,
    timestamp: new Date(),
    companyRef,
    actorId: principal?._id ?? SYSTEM_SUBSYSTEM_REFS[SystemSubsystem.OTHER],
    actorEmail: principal?.email ?? null,
    actorRole: principal?.role ?? USER_TYPE.SYSTEM,
    subsystemMappingVersion: SUBSYSTEM_MAPPING_VERSION,
    actor: { name: principal?.name ?? null },
  };
}

export async function appendAuditLog(
  skeleton: IAuditEventSkeleton,
  principal: IAuditPrincipal | null,
  subsystem: SystemSubsystem | null,
  opts: IAppendOptions = {},
  provider: IAuditStorageProvider = getActiveAuditStorageProvider(),
): Promise<void> {
  let baseEvent: IAuditEventBase | null = null;
  try {
    truncateOversized(skeleton);
    const companyRef = await resolveCompanyRefForEmit(
      { targetType: skeleton.targetType, targetId: skeleton.targetId },
      principal,
      subsystem,
    );
    const event = buildBaseEvent(skeleton, principal, companyRef);
    baseEvent = event;

    const chainId = companyRef;
    const setOnInsertSubsystem = subsystemForChain(chainId, subsystem);
    const signedBytes = deterministicJson(event);

    assertWithinBsonLimit({
      ...event,
      signedSnapshot: signedBytes,
    } as unknown as Record<string, unknown>);

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const appended = await provider.runInTransaction(async (session) => {
        const head = await provider.getChainHead(chainId, session);
        const prevSig = head?.lastSig ?? ROOT_SIG;
        const newSig = sha256(prevSig + HASH_INPUT_SEPARATOR + signedBytes);

        const result = await provider.casUpdateChainHead(
          chainId,
          prevSig,
          newSig,
          setOnInsertSubsystem,
          session,
        );
        if (!result.swapped) return false;

        await provider.appendRow(
          {
            ...event,
            _sig: newSig,
            _prevSig: prevSig,
            signedSnapshot: signedBytes,
          },
          session,
        );
        return true;
      });

      if (appended) return;
    }

    await provider.writeDlq(event, "cas_exhausted");
  } catch (err) {
    console.error("[audit-logs] emit failed", err);

    if (baseEvent) {
      try {
        await provider.writeDlq(baseEvent, "append_failed");
      } catch (dlqErr) {
        console.error(
          "[audit-logs] DLQ write after emit failure also failed",
          dlqErr,
        );
      }
    }
    if (opts.throwOnFailure) throw err;
  }
}
