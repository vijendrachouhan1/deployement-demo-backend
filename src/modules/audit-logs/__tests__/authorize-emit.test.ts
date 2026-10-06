import { Request, Response } from "express";
import mongoose from "mongoose";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

import "@/tests/mocks/database.mock";

import { createApp } from "@/app";
import { AuditLogModel } from "@/db/models/audit-logs/audit-log";
import { PERMISSIONS, USER_TYPE } from "@/enums";
import { authorize } from "@/middleware/authorize";
import { createAdminSession, createTestSession } from "@/tests/utils/auth";
import { AuditAction, AuditCategory, AuditStatus } from "@/enums/audit.enum";

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

// PUT /api/admin/help/:id is guarded by authorize(USER_QUERY_MANAGE) behind
// authMiddleware (any valid principal). A USER session authenticates but lacks
// user-query:manage, so it is denied by `authorize` itself — the exact path
// under test, not an upstream role gate.
const GUARDED_ROUTE = `/api/admin/help/${new mongoose.Types.ObjectId().toString()}`;

describe("authorize → permission.denied emit", () => {
  const app = createApp();

  beforeEach(async () => {
    await AuditLogModel.deleteMany({});
  });

  it("emits one permission.denied row on a denied request (AC#1,2,3,6)", async () => {
    // USER with user-query:view but not :manage — denied by authorize itself,
    // and the emitted row must capture the principal's actual permissions.
    const session = await createTestSession(USER_TYPE.USER, {}, [
      PERMISSIONS.USER_QUERY_VIEW,
    ]);

    const res = await request(app)
      .put(GUARDED_ROUTE)
      .set("Cookie", session.cookie)
      .send({});

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);

    const row = await waitFor(() =>
      AuditLogModel.findOne({ action: AuditAction.PERMISSION_DENIED }).lean(),
    );

    expect(row?.category).toBe(AuditCategory.RBAC);
    expect(row?.status).toBe(AuditStatus.FAILURE);
    expect(row?.context.path).toBe(GUARDED_ROUTE);
    expect(row?.context.method).toBe("PUT");

    const metadata = row?.metadata as {
      requiredPermission: string[];
      userPermissions: string[];
    };
    expect(metadata.requiredPermission).toEqual([
      PERMISSIONS.USER_QUERY_MANAGE,
    ]);
    expect(metadata.userPermissions).toContain(PERMISSIONS.USER_QUERY_VIEW);
    expect(metadata.userPermissions).not.toContain(
      PERMISSIONS.USER_QUERY_MANAGE,
    );

    // actorId is server-derived from the principal, not supplied by middleware.
    expect(row?.actorId.toString()).toBe(session.user._id.toString());

    const count = await AuditLogModel.countDocuments({
      action: AuditAction.PERMISSION_DENIED,
    });
    expect(count).toBe(1);
  });

  it("emits nothing when the request is authorized (AC#4)", async () => {
    const session = await createAdminSession();

    const res = await request(app)
      .get("/api/admin/audit-logs")
      .set("Cookie", session.cookie);

    expect(res.status).toBe(200);

    // Let any deferred emit settle, then confirm none fired.
    await new Promise((r) => setTimeout(r, 50));
    const count = await AuditLogModel.countDocuments({
      action: AuditAction.PERMISSION_DENIED,
    });
    expect(count).toBe(0);
  });

  it("emits nothing for an unauthenticated denial (no principal) (AC#6)", async () => {
    // Every authorize()-guarded route sits behind an auth gate, so an anonymous
    // caller is stopped upstream (401) and never reaches this branch over HTTP.
    // Exercise the guard directly: with req.user undefined it must deny (403)
    // without emitting a permission.denied row — there is no principal to attribute.
    const req = {
      user: undefined,
      originalUrl: `/api/products/${new mongoose.Types.ObjectId().toString()}`,
      method: "GET",
    } as unknown as Request;
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    } as unknown as Response;
    const next = vi.fn();

    authorize(PERMISSIONS.PRODUCTS_VIEW)(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false }),
    );
    expect(next).not.toHaveBeenCalled();

    await new Promise((r) => setTimeout(r, 50));
    const count = await AuditLogModel.countDocuments({
      action: AuditAction.PERMISSION_DENIED,
    });
    expect(count).toBe(0);
  });
});
