import { Types, isValidObjectId } from "mongoose";

import { USER_TYPE } from "@/enums";
import { AuditTargetType } from "@/enums/audit.enum";
import {
  SYSTEM_SUBSYSTEM_REFS,
  SystemSubsystem,
} from "@/db/plugins/audit/utils/subsystem";
import { tenantResolver } from "@/db/plugins/audit/tenant-resolver";
import type {
  IAuditPrincipal,
  IResolveInput,
} from "@/db/plugins/audit/utils/audit.types";

export async function resolveCompanyRefForEmit(
  input: IResolveInput,
  principal: IAuditPrincipal | null,
  subsystem: SystemSubsystem | null,
): Promise<Types.ObjectId> {
  const OTHER_REF = SYSTEM_SUBSYSTEM_REFS[SystemSubsystem.OTHER];

  if (!principal) {
    return SYSTEM_SUBSYSTEM_REFS[subsystem ?? SystemSubsystem.OTHER];
  }

  if (principal.role === USER_TYPE.SUPER_ADMIN) {
    if (
      input.targetType === AuditTargetType.COMPANY &&
      input.targetId &&
      isValidObjectId(input.targetId)
    ) {
      return new Types.ObjectId(String(input.targetId));
    }
    const owning = await tenantResolver.resolveOwningTenant(
      input.targetType,
      input.targetId,
    );
    return owning ?? OTHER_REF;
  }

  if (principal.companyRef) return principal.companyRef;

  /*
   * An admin/user principal with no companyRef shouldn't happen — likely
   * corrupt data or a middleware ordering bug. File the event under OTHER so
   * it isn't lost, and warn so the bad principal can be investigated.
   */
  console.warn("[audit-logs] principal missing companyRef", {
    principalId: principal._id?.toString(),
    role: principal.role,
  });
  return OTHER_REF;
}
