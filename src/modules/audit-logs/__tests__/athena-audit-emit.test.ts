import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

import "@/tests/mocks/database.mock";
import { athenaProvider as mockAthenaProvider } from "@/tests/mocks/athena-provider.mock";

import { createApp } from "@/app";
import { AuditLogModel } from "@/db/models/audit-logs/audit-log";
import { AthenaRunningModel } from "@/db/models/audit-logs/athena-running";
import { createSuperAdminSession } from "@/tests/utils/auth";
import { AuditAction, AuditCategory, AuditStatus } from "@/enums/audit.enum";

const ATHENA_ROUTE = "/api/super-admin/audit-logs/athena";

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

describe("Athena audit-the-auditor — athena.query_executed emit", () => {
  const app = createApp();

  beforeEach(async () => {
    await AuditLogModel.deleteMany({});
    await AthenaRunningModel.deleteMany({});
  });

  it("emits one athena.query_executed row for a raw query (AC#1,2)", async () => {
    const session = await createSuperAdminSession();
    mockAthenaProvider.runQuery.mockResolvedValue({
      rows: [{ a: 1 }],
      truncated: false,
    });

    const res = await request(app)
      .post(ATHENA_ROUTE)
      .set("Cookie", session.cookie)
      .send({ query: "SELECT * FROM audit_archive" });

    expect(res.status).toBe(200);

    const row = await waitFor(() =>
      AuditLogModel.findOne({
        action: AuditAction.ATHENA_QUERY_EXECUTED,
      }).lean(),
    );

    expect(row?.category).toBe(AuditCategory.AUDIT_META);
    expect(row?.status).toBe(AuditStatus.SUCCESS);
    expect(row?.actorId.toString()).toBe(session.user._id.toString());

    const metadata = row?.metadata as {
      query: string | null;
      filters: unknown;
      targetTable: string;
    };
    expect(metadata.query).toBe("SELECT * FROM audit_archive");
    expect(metadata.filters).toBeNull();
    expect(metadata.targetTable).toBe("audit_archive");

    const count = await AuditLogModel.countDocuments({
      action: AuditAction.ATHENA_QUERY_EXECUTED,
    });
    expect(count).toBe(1);
  });

  it("records the filters object when filters are supplied (AC#2)", async () => {
    const session = await createSuperAdminSession();
    mockAthenaProvider.runQuery.mockResolvedValue({
      rows: [],
      truncated: false,
    });

    const res = await request(app)
      .post(ATHENA_ROUTE)
      .set("Cookie", session.cookie)
      .send({ filters: { action: "user.login.success" } });

    expect(res.status).toBe(200);

    const row = await waitFor(() =>
      AuditLogModel.findOne({
        action: AuditAction.ATHENA_QUERY_EXECUTED,
      }).lean(),
    );
    const metadata = row?.metadata as { query: unknown; filters: any };
    expect(metadata.query).toBeNull();
    expect(metadata.filters).toEqual({ action: "user.login.success" });
  });

  it("emits status=failure when the query errors (AC#1)", async () => {
    const session = await createSuperAdminSession();
    mockAthenaProvider.runQuery.mockRejectedValue(new Error("athena boom"));

    const res = await request(app)
      .post(ATHENA_ROUTE)
      .set("Cookie", session.cookie)
      .send({ query: "SELECT bad" });

    expect(res.status).toBe(500);

    const row = await waitFor(() =>
      AuditLogModel.findOne({
        action: AuditAction.ATHENA_QUERY_EXECUTED,
      }).lean(),
    );
    expect(row?.status).toBe(AuditStatus.FAILURE);
    expect((row?.metadata as { query: string }).query).toBe("SELECT bad");
  });

  it("does NOT emit when the request is rejected over-cap (AC#4)", async () => {
    const session = await createSuperAdminSession();
    const userId = String(session.user._id);
    const future = new Date(Date.now() + 60_000);
    for (let i = 0; i < 3; i++) {
      await AthenaRunningModel.create({
        _id: `seed-${i}`,
        userId,
        queryId: `seed-${i}`,
        expiresAt: future,
      });
    }

    const res = await request(app)
      .post(ATHENA_ROUTE)
      .set("Cookie", session.cookie)
      .send({ query: "SELECT 1" });

    expect(res.status).toBe(429);

    await new Promise((r) => setTimeout(r, 50));
    const count = await AuditLogModel.countDocuments({
      action: AuditAction.ATHENA_QUERY_EXECUTED,
    });
    expect(count).toBe(0);
  });

  it("query still returns 200 when the audit emit fails (AC#3)", async () => {
    const session = await createSuperAdminSession();
    mockAthenaProvider.runQuery.mockResolvedValue({
      rows: [{ a: 1 }],
      truncated: false,
    });
    vi.spyOn(AuditLogModel, "create").mockRejectedValue(
      new Error("db down") as never,
    );

    const res = await request(app)
      .post(ATHENA_ROUTE)
      .set("Cookie", session.cookie)
      .send({ query: "SELECT 1" });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    // Allow the deferred emit + its rejection to settle without surfacing.
    await new Promise((r) => setTimeout(r, 50));
  });
});
