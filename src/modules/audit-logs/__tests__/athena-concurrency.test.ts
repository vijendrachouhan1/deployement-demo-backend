import mongoose from "mongoose";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

import "@/tests/mocks/database.mock";
import { athenaProvider as mockAthenaProvider } from "@/tests/mocks/athena-provider.mock";

import { createApp } from "@/app";
import { ERROR_CODES } from "@/constants/error-codes";
import { AUDIT_CONSTANTS } from "@/providers/audit-logs/utils/audit.constant";
import { athenaController } from "@/modules/audit-logs/athena.controller";
import { AthenaRunningModel } from "@/db/models/audit-logs/athena-running";
import { createSuperAdminSession } from "@/tests/utils/auth";

const ATHENA_ROUTE = "/api/super-admin/audit-logs/athena";
const CAP = 3; // AUDIT_CONSTANTS.athenaMaxConcurrentPerUser default

async function seedSlots(userId: string, count: number, expiresAt: Date) {
  for (let i = 0; i < count; i++) {
    await AthenaRunningModel.create({
      _id: `seed-${userId}-${i}`,
      userId,
      queryId: `seed-${i}`,
      expiresAt,
    });
  }
}

describe("Athena per-user concurrency cap", () => {
  const app = createApp();

  beforeEach(async () => {
    await AthenaRunningModel.deleteMany({});
  });

  it("runs an in-cap query and releases the slot (AC#5)", async () => {
    const session = await createSuperAdminSession();
    mockAthenaProvider.runQuery.mockResolvedValue({
      rows: [{ a: 1 }],
      truncated: false,
    });

    const res = await request(app)
      .post(ATHENA_ROUTE)
      .set("Cookie", session.cookie)
      .send({ query: "SELECT 1" });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual({ rows: [{ a: 1 }], truncated: false });

    // Slot released in finally.
    const remaining = await AthenaRunningModel.countDocuments({});
    expect(remaining).toBe(0);
  });

  it("rejects with 429 when at the cap and makes no Athena call (AC#2,4)", async () => {
    const session = await createSuperAdminSession();
    const userId = String(session.user._id);
    const future = new Date(Date.now() + 60_000);
    await seedSlots(userId, CAP, future);

    const res = await request(app)
      .post(ATHENA_ROUTE)
      .set("Cookie", session.cookie)
      .send({ query: "SELECT 1" });

    expect(res.status).toBe(429);
    expect(res.body.messageCode).toBe(ERROR_CODES.TOO_MANY_CONCURRENT_QUERIES);
    expect(mockAthenaProvider.runQuery).not.toHaveBeenCalled();

    // Rejected request rolled back its own slot — only the seeded ones remain.
    const remaining = await AthenaRunningModel.countDocuments({});
    expect(remaining).toBe(CAP);
  });

  it("does not count expired slots toward the cap (AC#3)", async () => {
    const session = await createSuperAdminSession();
    const userId = String(session.user._id);
    const past = new Date(Date.now() - 60_000);
    await seedSlots(userId, CAP, past);
    mockAthenaProvider.runQuery.mockResolvedValue({
      rows: [],
      truncated: false,
    });

    const res = await request(app)
      .post(ATHENA_ROUTE)
      .set("Cookie", session.cookie)
      .send({ query: "SELECT 1" });

    expect(res.status).toBe(200);
  });

  it("releases the slot when the query errors (AC#1)", async () => {
    const session = await createSuperAdminSession();
    mockAthenaProvider.runQuery.mockRejectedValue(new Error("athena boom"));

    const res = await request(app)
      .post(ATHENA_ROUTE)
      .set("Cookie", session.cookie)
      .send({ query: "SELECT 1" });

    expect(res.status).toBe(500);

    const remaining = await AthenaRunningModel.countDocuments({});
    expect(remaining).toBe(0);
  });

  it("returns 401 when no principal is resolved (defensive guard)", async () => {
    const req: any = { user: undefined, body: { query: "SELECT 1" } };
    const res: any = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };

    await athenaController.runQuery(req, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(401);
    expect(mockAthenaProvider.runQuery).not.toHaveBeenCalled();
    expect(await AthenaRunningModel.countDocuments({})).toBe(0);
  });

  it("refreshes the slot while a long query runs (heartbeat)", async () => {
    // Shrink the TTL so the heartbeat interval (ttl/3) fires within a short
    // real wait. The controller reads the constant per-call.
    const originalTtl = AUDIT_CONSTANTS.athenaSlotTtlSeconds;
    AUDIT_CONSTANTS.athenaSlotTtlSeconds = 3; // → interval 1000ms
    try {
      const userId = new mongoose.Types.ObjectId().toString();
      let resolveQuery!: (v: { rows: any[]; truncated: boolean }) => void;
      mockAthenaProvider.runQuery.mockImplementation(
        () =>
          new Promise<{ rows: any[]; truncated: boolean }>(
            (r) => (resolveQuery = r),
          ),
      );

      const req: any = { user: { _id: userId }, body: { query: "SELECT 1" } };
      const res: any = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis(),
      };

      const done = athenaController.runQuery(req, res, vi.fn());

      // Capture the slot's expiry, wait past one heartbeat tick, re-read.
      await new Promise((r) => setTimeout(r, 100));
      const before = await AthenaRunningModel.findOne({ userId }).lean();
      await new Promise((r) => setTimeout(r, 1200));
      const after = await AthenaRunningModel.findOne({ userId }).lean();

      expect(before).toBeTruthy();
      expect(after!.expiresAt.getTime()).toBeGreaterThan(
        before!.expiresAt.getTime(),
      );

      resolveQuery({ rows: [{ ok: 1 }], truncated: false });
      await done;

      expect(res.status).toHaveBeenCalledWith(200);
      expect(await AthenaRunningModel.countDocuments({})).toBe(0);
    } finally {
      AUDIT_CONSTANTS.athenaSlotTtlSeconds = originalTtl;
    }
  });
});
