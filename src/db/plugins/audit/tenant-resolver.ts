import mongoose from "mongoose";

import type { IUserDocument } from "@/db/models/user";
import { AuditTargetType } from "@/enums/audit.enum";

export class TenantResolver {
  resolveOwningTenant = async (
    targetType: string | null,
    targetId: mongoose.Types.ObjectId | string | null,
  ): Promise<mongoose.Types.ObjectId | null> => {
    if (!targetType || !targetId) return null;

    switch (targetType) {
      case AuditTargetType.USER: {
        // Looked up here, not imported: importing the model would recreate the
        // audit.plugin -> tenant-resolver -> user circular import.
        const User = mongoose.model<IUserDocument>("User");
        const user = await User.findById(targetId).select("companyRef").lean();
        return user?.companyRef ?? null;
      }
      case AuditTargetType.COMPANY: {
        return mongoose.isValidObjectId(targetId)
          ? new mongoose.Types.ObjectId(String(targetId))
          : null;
      }
      case AuditTargetType.ROLE:
        return null;
      default:
        return null;
    }
  };
}

export const tenantResolver = new TenantResolver();
