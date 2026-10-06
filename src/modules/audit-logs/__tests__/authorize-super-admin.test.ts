import { Request, Response } from "express";
import mongoose from "mongoose";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

import "@/tests/mocks/database.mock";

import { createApp } from "@/app";
import { AuditLogModel } from "@/db/models/audit-logs/audit-log";
import { PERMISSIONS, USER_TYPE } from "@/enums";
import { AuditAction, AuditCategory, AuditStatus } from "@/enums/audit.enum";
import { authorize } from "@/middleware/authorize";
import { createSuperAdminSession, createTestSession } from "@/tests/utils/auth";

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

const ROUTE = "/api/super-admin/audit-logs/chain/verify";

function buildRes(): Response {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;
}

function buildReq(roles: USER_TYPE, permissions: string[]): Request {
  return {
    user: { _id: new mongoose.Types.ObjectId(), roles, permissions },
    originalUrl: ROUTE,
    method: "GET",
  } as unknown as Request;
}

describe("authorize — super-admin", () => {
  beforeEach(async () => {
    await AuditLogModel.deleteMany({});
  });

  it("passes a super-admin through on its own permissions, with no audit row", async () => {
    const req = buildReq(USER_TYPE.SUPER_ADMIN, Object.values(PERMISSIONS));
    const res = buildRes();
    const next = vi.fn();

    authorize(PERMISSIONS.AUDIT_LOGS_MANAGE)(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();

    await new Promise((r) => setTimeout(r, 50));
    expect(await AuditLogModel.countDocuments({})).toBe(0);
  });

  it("denies a super-admin missing the permission, with no role shortcut", async () => {
    const req = buildReq(USER_TYPE.SUPER_ADMIN, [PERMISSIONS.AUDIT_LOGS_VIEW]);
    const res = buildRes();
    const next = vi.fn();

    authorize(PERMISSIONS.AUDIT_LOGS_MANAGE)(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);

    const row = await waitFor(() =>
      AuditLogModel.findOne({ action: AuditAction.PERMISSION_DENIED }).lean(),
    );
    expect(row?.category).toBe(AuditCategory.RBAC);
    expect(row?.status).toBe(AuditStatus.FAILURE);

    const metadata = row?.metadata as {
      requiredPermission: string[];
      userPermissions: string[];
    };
    expect(metadata.requiredPermission).toEqual([
      PERMISSIONS.AUDIT_LOGS_MANAGE,
    ]);
    expect(metadata.userPermissions).toEqual([PERMISSIONS.AUDIT_LOGS_VIEW]);
  });

  it("treats a super-admin with no permissions like any other principal", async () => {
    const req = buildReq(USER_TYPE.SUPER_ADMIN, []);
    const res = buildRes();
    const next = vi.fn();

    authorize(PERMISSIONS.AUDIT_LOGS_VIEW)(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });
});

// The unit cases above drive the guard directly. These drive it over HTTP,
// through superAdminMiddleware and the real router stack, because the evidence
// that matters for this control is that a super-admin reaches a guarded route
// on its own permissions rather than on a role shortcut.
describe("authorize — super-admin over HTTP", () => {
  const app = createApp();

  beforeEach(async () => {
    await AuditLogModel.deleteMany({});
  });

  it("reaches an audit-logs:manage route on its own permissions", async () => {
    const session = await createSuperAdminSession();

    const res = await request(app).get(ROUTE).set("Cookie", session.cookie);

    expect(res.status).not.toBe(403);

    await new Promise((r) => setTimeout(r, 50));
    expect(
      await AuditLogModel.countDocuments({
        action: AuditAction.PERMISSION_DENIED,
      }),
    ).toBe(0);
  });

  it("is denied that route when its permissions lack audit-logs:manage", async () => {
    // Same role, same upstream superAdminMiddleware — only the permission set
    // differs. Under the old role shortcut this returned 200.
    const session = await createTestSession(USER_TYPE.SUPER_ADMIN, {}, [
      PERMISSIONS.AUDIT_LOGS_VIEW,
    ]);

    const res = await request(app).get(ROUTE).set("Cookie", session.cookie);

    expect(res.status).toBe(403);

    const row = await waitFor(() =>
      AuditLogModel.findOne({ action: AuditAction.PERMISSION_DENIED }).lean(),
    );
    expect(row?.actorId.toString()).toBe(session.user._id.toString());
    expect(row?.actorRole).toBe(USER_TYPE.SUPER_ADMIN);
  });
});
