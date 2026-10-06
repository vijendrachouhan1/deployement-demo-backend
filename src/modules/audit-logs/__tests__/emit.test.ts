import mongoose from "mongoose";
import { describe, expect, it, vi } from "vitest";

const waitFor = async <T>(check: () => Promise<T> | T, timeoutMs = 2000) => {
  const start = Date.now();
  let lastErr: unknown;
  while (Date.now() - start < timeoutMs) {
    try {
      const value = await check();
      if (value) return value;
    } catch (err) {
      lastErr = err;
    }
    await new Promise((r) => setTimeout(r, 20));
  }
  if (lastErr) throw lastErr;
  throw new Error("waitFor timed out");
};

import "@/tests/mocks/database.mock";

import { AuditLogModel } from "@/db/models/audit-logs/audit-log";
import { USER_TYPE } from "@/enums";
import { AuditContext } from "@/db/plugins/audit/audit-context";
import {
  emitAuditLog,
  emitAuditLogSync,
} from "@/modules/audit-logs/helpers/emit.helper";
import { AuditAction, AuditCategory, AuditStatus } from "@/enums/audit.enum";

function makePrincipal() {
  return {
    _id: new mongoose.Types.ObjectId(),
    companyRef: new mongoose.Types.ObjectId(),
    role: USER_TYPE.ADMIN,
    email: "admin@acme.test",
    name: "Admin Alice",
  };
}

describe("emitAuditLog (best-effort)", () => {
  it("strips caller-supplied companyRef and uses server-derived value (C5)", async () => {
    const principal = makePrincipal();
    const evilId = new mongoose.Types.ObjectId();

    AuditContext.run({ principal }, () => {
      emitAuditLog({
        action: AuditAction.USER_PROFILE_UPDATED,
        status: AuditStatus.SUCCESS,
        category: AuditCategory.ADMIN_ACTION,
        // Caller tries to inject companyRef. Type system blocks the
        // field; if bypassed via `as any` it is still ignored because
        // emitAuditLog never reads companyRef from the input.
        ...({ companyRef: evilId } as unknown as Record<string, never>),
      });
    });

    const row = await waitFor(() =>
      AuditLogModel.findOne({
        action: AuditAction.USER_PROFILE_UPDATED,
      }).lean(),
    );
    expect(row?.companyRef.equals(principal.companyRef!)).toBe(true);
    expect(row?.companyRef.equals(evilId)).toBe(false);
    expect(typeof row?.signedSnapshot).toBe("string");
    expect(row?.signedSnapshot!.length).toBeGreaterThan(0);
  });

  it("swallows errors and does not throw to caller", async () => {
    const principal = makePrincipal();
    vi.spyOn(AuditLogModel, "create").mockRejectedValue(
      new Error("db down") as never,
    );

    AuditContext.run({ principal }, () => {
      expect(() =>
        emitAuditLog({
          action: AuditAction.USER_LOGOUT,
          status: AuditStatus.FAILURE,
        }),
      ).not.toThrow();
    });
    // Allow setImmediate callback + its async rejection to settle.
    await new Promise((r) => setTimeout(r, 50));
  });
});

describe("emitAuditLogSync (durable)", () => {
  it("persists signedSnapshot on the durable row (D.1)", async () => {
    const principal = makePrincipal();

    await AuditContext.run({ principal }, async () => {
      await emitAuditLogSync({
        action: AuditAction.USER_PROFILE_UPDATED,
        status: AuditStatus.SUCCESS,
        category: AuditCategory.ADMIN_ACTION,
      });
    });

    const row = await AuditLogModel.findOne({
      companyRef: principal.companyRef,
    }).lean();
    expect(typeof row?.signedSnapshot).toBe("string");
    expect(row?.signedSnapshot!.length).toBeGreaterThan(0);
  });

  it("awaits row durability and rethrows on DB error", async () => {
    const principal = makePrincipal();
    vi.spyOn(AuditLogModel, "create").mockRejectedValue(
      new Error("db down") as never,
    );

    await AuditContext.run({ principal }, async () => {
      await expect(
        emitAuditLogSync({
          action: AuditAction.USER_LOGOUT,
          status: AuditStatus.FAILURE,
        }),
      ).rejects.toThrow(/db down/);
    });
  });
});
