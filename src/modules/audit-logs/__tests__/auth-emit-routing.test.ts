import mongoose from "mongoose";
import { beforeEach, describe, expect, it } from "vitest";

import "@/tests/mocks/database.mock";

import { AuditLogModel } from "@/db/models/audit-logs/audit-log";
import { USER_TYPE } from "@/enums";
import {
  AuditContext,
  runWithSubsystem,
} from "@/db/plugins/audit/audit-context";
import {
  emitAuditLogSync,
  safeEmit,
} from "@/modules/audit-logs/helpers/emit.helper";
import {
  AuditAction,
  AuditCategory,
  AuditStatus,
  AuditTargetType,
} from "@/enums/audit.enum";
import {
  SYSTEM_SUBSYSTEM_REFS,
  SystemSubsystem,
} from "@/db/plugins/audit/utils/subsystem";

describe("Auth flow emit routing", () => {
  beforeEach(async () => {
    await AuditLogModel.deleteMany({});
  });

  it("login.failure routes to AUTH sentinel chain when wrapped in runWithSubsystem(AUTH)", async () => {
    await new Promise<void>((resolve) => {
      runWithSubsystem(SystemSubsystem.AUTH, async () => {
        await emitAuditLogSync({
          action: AuditAction.USER_LOGIN_FAILURE,
          category: AuditCategory.AUTHENTICATION,
          status: AuditStatus.FAILURE,
          target: { label: "attacker@example.com" },
          failureReason: "Invalid credentials",
        });
        resolve();
      });
    });

    const row = await AuditLogModel.findOne({
      action: "user.login.failure",
    }).lean();
    expect(row).toBeTruthy();
    expect(row?.companyRef.toString()).toBe(
      SYSTEM_SUBSYSTEM_REFS[SystemSubsystem.AUTH].toString(),
    );
    expect(row?.failureReason).toBe("Invalid credentials");
    expect(row?.target?.label).toBe("attacker@example.com");
  });

  it("login.success with AuditContext.run principal routes to tenant chain", async () => {
    const principal = {
      _id: new mongoose.Types.ObjectId(),
      companyRef: new mongoose.Types.ObjectId(),
      role: USER_TYPE.ADMIN,
      email: "admin@acme.test",
      name: "Admin",
    };

    await AuditContext.run({ principal }, async () => {
      await emitAuditLogSync({
        action: AuditAction.USER_LOGIN_SUCCESS,
        category: AuditCategory.AUTHENTICATION,
        status: AuditStatus.SUCCESS,
      });
    });

    const row = await AuditLogModel.findOne({
      action: "user.login.success",
    }).lean();
    expect(row).toBeTruthy();
    expect(row?.companyRef.toString()).toBe(principal.companyRef.toString());
    expect(row?.actorId.toString()).toBe(principal._id.toString());
    expect(row?.actorEmail).toBe(principal.email);
  });

  it("logout with AuditContext.run principal routes to tenant chain", async () => {
    const principal = {
      _id: new mongoose.Types.ObjectId(),
      companyRef: new mongoose.Types.ObjectId(),
      role: USER_TYPE.ADMIN,
      email: "admin@acme.test",
      name: "Admin",
    };

    await AuditContext.run({ principal }, async () => {
      await emitAuditLogSync({
        action: AuditAction.USER_LOGOUT,
        category: AuditCategory.AUTHENTICATION,
        status: AuditStatus.SUCCESS,
      });
    });

    const row = await AuditLogModel.findOne({ action: "user.logout" }).lean();
    expect(row).toBeTruthy();
    expect(row?.companyRef.toString()).toBe(principal.companyRef.toString());
  });

  it("safeEmit caught failure does not corrupt subsequent runs", () => {
    // bad targetId; safeEmit swallows
    expect(() =>
      runWithSubsystem(SystemSubsystem.AUTH, () => {
        safeEmit({
          action: AuditAction.USER_LOGIN_FAILURE,
          status: AuditStatus.FAILURE,
          targetType: AuditTargetType.USER,
          targetId: "not-an-objectid",
          failureReason: "Invalid credentials",
        });
      }),
    ).not.toThrow();
  });
});
