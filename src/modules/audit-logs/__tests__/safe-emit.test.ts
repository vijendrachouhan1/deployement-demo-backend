import mongoose from "mongoose";
import { describe, expect, it, vi } from "vitest";

import "@/tests/mocks/database.mock";

import { AuditLogModel } from "@/db/models/audit-logs/audit-log";
import { USER_TYPE } from "@/enums";
import { AuditContext } from "@/db/plugins/audit/audit-context";
import {
  safeEmit,
  summarizeFailureReason,
} from "@/modules/audit-logs/helpers/emit.helper";
import { AuditAction, AuditStatus, AuditTargetType } from "@/enums/audit.enum";

describe("safeEmit wrapper", () => {
  it("normalizes an un-castable targetId to null and still emits the entry", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const principal = {
      _id: new mongoose.Types.ObjectId(),
      companyRef: new mongoose.Types.ObjectId(),
      role: USER_TYPE.ADMIN,
      email: "admin@acme.test",
      name: "Admin Alice",
    };

    await AuditContext.run({ principal }, async () => {
      expect(() =>
        safeEmit({
          action: AuditAction.USER_STATUS_CHANGED,
          status: AuditStatus.SUCCESS,
          targetType: AuditTargetType.USER,
          targetId: "not-an-objectid",
        }),
      ).not.toThrow();

      const start = Date.now();
      while (Date.now() - start < 3000) {
        const found = await AuditLogModel.findOne({
          action: AuditAction.USER_STATUS_CHANGED,
        }).lean();
        if (found) break;
        await new Promise((r) => setTimeout(r, 50));
      }
    });

    const row = await AuditLogModel.findOne({
      action: AuditAction.USER_STATUS_CHANGED,
    }).lean();
    expect(row).not.toBeNull();
    expect(row?.targetId).toBeNull();
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("does not throw when called without an AuditContext", () => {
    expect(() =>
      safeEmit({
        action: AuditAction.USER_LOGOUT,
        status: AuditStatus.SUCCESS,
      }),
    ).not.toThrow();
  });

  it("emits a row when input is valid and principal is set", async () => {
    const principal = {
      _id: new mongoose.Types.ObjectId(),
      companyRef: new mongoose.Types.ObjectId(),
      role: USER_TYPE.ADMIN,
      email: "admin@acme.test",
      name: "Admin Alice",
    };

    await AuditContext.run(
      { principal, requestId: "safe-emit-req" },
      async () => {
        safeEmit({
          action: AuditAction.USER_PROFILE_UPDATED,
          status: AuditStatus.SUCCESS,
          targetType: AuditTargetType.USER,
          targetId: new mongoose.Types.ObjectId().toString(),
        });
        const start = Date.now();
        while (Date.now() - start < 3000) {
          const found = await AuditLogModel.findOne({
            action: AuditAction.USER_PROFILE_UPDATED,
          }).lean();
          if (found) break;
          await new Promise((r) => setTimeout(r, 50));
        }
      },
    );

    const rows = await AuditLogModel.find({
      action: AuditAction.USER_PROFILE_UPDATED,
    }).lean();
    expect(rows.length).toBe(1);
    expect(rows[0].actorId.toString()).toBe(principal._id.toString());
  });
});

describe("summarizeFailureReason", () => {
  it("returns Error.message when given an Error", () => {
    expect(summarizeFailureReason(new Error("boom"))).toBe("boom");
  });

  it("returns the string as-is when given a string", () => {
    expect(summarizeFailureReason("explicit reason")).toBe("explicit reason");
  });

  it("returns 'unknown' when given null/undefined", () => {
    expect(summarizeFailureReason(undefined)).toBe("unknown");
    expect(summarizeFailureReason(null)).toBe("unknown");
  });

  it("caps oversized strings to 4000 chars", () => {
    const huge = "x".repeat(10_000);
    expect(summarizeFailureReason(huge).length).toBe(4000);
  });
});
