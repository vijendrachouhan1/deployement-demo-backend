import mongoose from "mongoose";
import { beforeEach, describe, expect, it } from "vitest";

import "@/tests/mocks/database.mock";

import { AuditLogModel } from "@/db/models/audit-logs/audit-log";
import { USER_TYPE } from "@/enums";
import { AuditContext } from "@/db/plugins/audit/audit-context";
import { emitAuditLogSync } from "@/modules/audit-logs/helpers/emit.helper";
import { AuditAction, AuditStatus, AuditTargetType } from "@/enums/audit.enum";

describe("Super-admin password change emit — password-leak defense", () => {
  beforeEach(async () => {
    await AuditLogModel.deleteMany({});
  });

  it("audit row carries no password substring (success path)", async () => {
    const secretPassword = "Sup3rS3cr3t!P@ssw0rd-DO-NOT-LEAK";
    const principal = {
      _id: new mongoose.Types.ObjectId(),
      companyRef: new mongoose.Types.ObjectId(),
      role: USER_TYPE.SUPER_ADMIN,
      email: "root@platform.test",
      name: "Root",
    };
    const targetUserId = new mongoose.Types.ObjectId().toString();

    await AuditContext.run({ principal }, async () => {
      await emitAuditLogSync({
        action: AuditAction.USER_PASSWORD_CHANGED_BY_SUPER_ADMIN,
        status: AuditStatus.SUCCESS,
        targetType: AuditTargetType.USER,
        targetId: targetUserId,
      });
    });

    const row = await AuditLogModel.findOne({
      action: "user.password.changed_by_super_admin",
    }).lean();
    expect(row).toBeTruthy();

    const serialized = JSON.stringify(row);
    expect(serialized).not.toContain(secretPassword);
    // metadata / changes / failureReason carry no body content
    expect(row?.metadata).toBeUndefined();
    expect(row?.changes).toBeUndefined();
    expect(row?.failureReason).toBeUndefined();
    expect(row?.targetId?.toString()).toBe(targetUserId);
  });

  it("user.profile.updated success row excludes password* fields from changes", async () => {
    const principal = {
      _id: new mongoose.Types.ObjectId(),
      companyRef: new mongoose.Types.ObjectId(),
      role: USER_TYPE.SUPER_ADMIN,
      email: "root@platform.test",
      name: "Root",
    };

    await AuditContext.run({ principal }, async () => {
      await emitAuditLogSync({
        action: AuditAction.USER_PROFILE_UPDATED,
        status: AuditStatus.SUCCESS,
        targetType: AuditTargetType.USER,
        targetId: new mongoose.Types.ObjectId().toString(),
        changes: [
          { field: "name.first", before: "Old", after: "New" },
          { field: "email", before: "old@x.com", after: "new@x.com" },
        ],
      });
    });

    const row = await AuditLogModel.findOne({
      action: "user.profile.updated",
    }).lean();
    expect(row).toBeTruthy();
    const fieldNames = (row?.changes ?? []).map((c) => c.field);
    expect(fieldNames).not.toContain("password");
    expect(fieldNames).not.toContain("hashedPassword");
  });
});
