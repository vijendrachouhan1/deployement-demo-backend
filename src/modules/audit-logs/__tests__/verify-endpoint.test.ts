import mongoose from "mongoose";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

import "@/tests/mocks/database.mock";

import { createApp } from "@/app";
import { ERROR_CODES } from "@/constants/error-codes";
import { AUDIT_CONSTANTS } from "@/providers/audit-logs/utils/audit.constant";
import { AuditLogModel } from "@/db/models/audit-logs/audit-log";
import { AuditVerifyQuotaModel } from "@/db/models/audit-logs/audit-verify-quota";
import { ChainHeadModel } from "@/db/models/audit-logs/chain-head";
import { MigrationLockModel } from "@/db/models/audit-logs/migration-lock";
import { USER_TYPE } from "@/enums";
import {
  auditLogsHelper,
  VERIFY_QUOTA_WINDOW_MS,
} from "@/modules/audit-logs/helpers/audit-log.helper";
import { mongoAuditProvider } from "@/providers/audit-logs";
import { appendAuditLog } from "@/db/plugins/audit/append-audit-log";
import { athenaChainReader } from "@/providers/audit-logs/athena-chain-reader";
import { RETENTION_SWEEP_ID } from "@/modules/audit-logs/helpers/retention/sweep.helper";
import { ChainTooLargeError } from "@/modules/audit-logs/helpers/verify/chain-walker.helper";
import {
  createAdminSession,
  createSuperAdminSession,
  createUserSession,
} from "@/tests/utils/auth";
import { AuditCategory, AuditStatus } from "@/enums/audit.enum";
import { SUBSYSTEM_MAPPING_VERSION } from "@/db/plugins/audit/utils/subsystem";

const VERIFY_URL = "/api/super-admin/audit-logs/chain/verify";

async function seedAuditRow(companyRef: mongoose.Types.ObjectId) {
  return AuditLogModel.create({
    timestamp: new Date(),
    category: AuditCategory.ADMIN_ACTION,
    action: "user.status_updated",
    status: "success",
    companyRef,
    actorId: new mongoose.Types.ObjectId(),
    actorEmail: "actor@a.test",
    actorRole: USER_TYPE.ADMIN,
    targetType: "users",
    targetId: new mongoose.Types.ObjectId(),
    requestId: "test-req-id",
    subsystemMappingVersion: SUBSYSTEM_MAPPING_VERSION,
    actor: { name: "Admin" },
    target: { label: null },
    context: { ip: null, userAgent: null, path: null, method: null },
    retentionDays: null,
    _sig: `sig-${Math.random()}`,
    _prevSig: "ROOT",
  });
}

function currentWindowKey(userId: string): string {
  const windowStart =
    Math.floor(Date.now() / VERIFY_QUOTA_WINDOW_MS) * VERIFY_QUOTA_WINDOW_MS;
  return `${userId}:${windowStart}`;
}

// Seed the caller's verify counter for the CURRENT window so we hit the boundary
// without firing LIMIT real requests.
async function seedQuota(userId: string, count: number, windowKey?: string) {
  return AuditVerifyQuotaModel.create({
    _id: windowKey ?? currentWindowKey(userId),
    userId: new mongoose.Types.ObjectId(userId),
    count,
    expiresAt: new Date(Date.now() + VERIFY_QUOTA_WINDOW_MS),
  });
}

describe("Audit-log chain verify — permission/role gates (AC#1)", () => {
  const app = createApp();

  beforeEach(async () => {
    await AuditLogModel.deleteMany({});
    await AuditVerifyQuotaModel.deleteMany({});
  });

  it("allows a super-admin (has audit-logs:manage) → 200 clean report on an empty chain", async () => {
    const session = await createSuperAdminSession();
    const companyRef = new mongoose.Types.ObjectId().toString();

    const res = await request(app)
      .get(`${VERIFY_URL}?companyRef=${companyRef}`)
      .set("Cookie", session.cookie);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({
      companyRef,
      totalEntries: 0,
      breaksFound: 0,
      breaks: [],
      firstEntry: null,
      lastEntry: null,
      status: "clean",
    });
  });

  it("rejects a USER role", async () => {
    const session = await createUserSession();
    const res = await request(app)
      .get(`${VERIFY_URL}?companyRef=${new mongoose.Types.ObjectId()}`)
      .set("Cookie", session.cookie);
    expect([401, 403]).toContain(res.status);
  });

  it("rejects an ADMIN role (parent super-admin middleware blocks it)", async () => {
    const session = await createAdminSession();
    const res = await request(app)
      .get(`${VERIFY_URL}?companyRef=${new mongoose.Types.ObjectId()}`)
      .set("Cookie", session.cookie);
    expect([401, 403]).toContain(res.status);
  });

  it("rejects an unauthenticated request", async () => {
    const res = await request(app).get(
      `${VERIFY_URL}?companyRef=${new mongoose.Types.ObjectId()}`,
    );
    expect(res.status).toBe(401);
  });
});

describe("Audit-log chain verify — companyRef validation (AC#2)", () => {
  const app = createApp();

  beforeEach(async () => {
    await AuditVerifyQuotaModel.deleteMany({});
  });

  it("400s when companyRef is missing (required)", async () => {
    const session = await createSuperAdminSession();
    const res = await request(app)
      .get(VERIFY_URL)
      .set("Cookie", session.cookie);
    expect(res.status).toBe(400);
  });

  it("400s when companyRef is malformed", async () => {
    const session = await createSuperAdminSession();
    const res = await request(app)
      .get(`${VERIFY_URL}?companyRef=xyz`)
      .set("Cookie", session.cookie);
    expect(res.status).toBe(400);
  });

  it("accepts a valid 24-hex companyRef", async () => {
    const session = await createSuperAdminSession();
    const res = await request(app)
      .get(`${VERIFY_URL}?companyRef=${new mongoose.Types.ObjectId()}`)
      .set("Cookie", session.cookie);
    expect(res.status).toBe(200);
  });

  it("accepts a SYSTEM:<subsystem> ref (regex parity with list/export)", async () => {
    const session = await createSuperAdminSession();
    const res = await request(app)
      .get(`${VERIFY_URL}?companyRef=${encodeURIComponent("SYSTEM:auth")}`)
      .set("Cookie", session.cookie);
    expect(res.status).toBe(200);
    expect(res.body.data.companyRef).toBe("SYSTEM:auth");
  });
});

describe("Audit-log chain verify — verify quota (AC#3)", () => {
  const app = createApp();
  const LIMIT = AUDIT_CONSTANTS.verifyMaxPerWindow;

  beforeEach(async () => {
    await AuditLogModel.deleteMany({});
    await AuditVerifyQuotaModel.deleteMany({});
  });

  it("429s with rate_limit_exceeded once over the limit, and runs no row count", async () => {
    const session = await createSuperAdminSession();
    const userId = (session.user._id as mongoose.Types.ObjectId).toString();
    await seedQuota(userId, LIMIT); // already at cap → next increment passes it
    const countSpy = vi.spyOn(mongoAuditProvider, "countAuditLogs");

    const res = await request(app)
      .get(`${VERIFY_URL}?companyRef=${new mongoose.Types.ObjectId()}`)
      .set("Cookie", session.cookie);

    expect(res.status).toBe(429);
    expect(res.body.messageCode).toBe(ERROR_CODES.RATE_LIMIT_EXCEEDED);
    // No verification work ran — the row count was never attempted.
    expect(countSpy).not.toHaveBeenCalled();
  });

  it("counts the boundary exactly: the LIMIT-th succeeds, the next 429s", async () => {
    const session = await createSuperAdminSession();
    const userId = (session.user._id as mongoose.Types.ObjectId).toString();
    await seedQuota(userId, LIMIT - 1);
    const companyRef = new mongoose.Types.ObjectId().toString();

    const ok = await request(app)
      .get(`${VERIFY_URL}?companyRef=${companyRef}`)
      .set("Cookie", session.cookie);
    expect(ok.status).toBe(200);

    const blocked = await request(app)
      .get(`${VERIFY_URL}?companyRef=${companyRef}`)
      .set("Cookie", session.cookie);
    expect(blocked.status).toBe(429);
  });

  it("is per-user: one user's maxed window does not block another", async () => {
    const a = await createSuperAdminSession();
    const b = await createSuperAdminSession();
    const aId = (a.user._id as mongoose.Types.ObjectId).toString();
    await seedQuota(aId, LIMIT);

    const blockedA = await request(app)
      .get(`${VERIFY_URL}?companyRef=${new mongoose.Types.ObjectId()}`)
      .set("Cookie", a.cookie);
    expect(blockedA.status).toBe(429);

    const okB = await request(app)
      .get(`${VERIFY_URL}?companyRef=${new mongoose.Types.ObjectId()}`)
      .set("Cookie", b.cookie);
    expect(okB.status).toBe(200);
  });
});

describe("Audit-log chain verify — row-count safety guard (AC#4)", () => {
  const app = createApp();

  beforeEach(async () => {
    await AuditLogModel.deleteMany({});
    await AuditVerifyQuotaModel.deleteMany({});
  });

  it("413s with verify_row_limit_exceeded when the chain exceeds the cap", async () => {
    const session = await createSuperAdminSession();
    // Mock the count (seeding 100k+ rows is infeasible; env cap is boot-frozen).
    vi.spyOn(mongoAuditProvider, "countAuditLogs").mockResolvedValue(
      AUDIT_CONSTANTS.verifyMaxRows + 1,
    );

    const res = await request(app)
      .get(`${VERIFY_URL}?companyRef=${new mongoose.Types.ObjectId()}`)
      .set("Cookie", session.cookie);

    expect(res.status).toBe(413);
    expect(res.body.messageCode).toBe(ERROR_CODES.VERIFY_ROW_LIMIT_EXCEEDED);
  });

  it("proceeds to the 200 verification report when under the cap", async () => {
    const session = await createSuperAdminSession();
    vi.spyOn(mongoAuditProvider, "countAuditLogs").mockResolvedValue(
      AUDIT_CONSTANTS.verifyMaxRows,
    );
    const companyRef = new mongoose.Types.ObjectId().toString();

    const res = await request(app)
      .get(`${VERIFY_URL}?companyRef=${companyRef}`)
      .set("Cookie", session.cookie);

    expect(res.status).toBe(200);
    // The count is mocked; the walk itself sees no rows for this ref.
    expect(res.body.data).toMatchObject({
      companyRef,
      totalEntries: 0,
      status: "clean",
    });
  });

  it("walks only the hot rows matching companyRef (tenant scoping)", async () => {
    const session = await createSuperAdminSession();
    const target = new mongoose.Types.ObjectId();
    const other = new mongoose.Types.ObjectId();
    await seedAuditRow(target);
    await seedAuditRow(target);
    await seedAuditRow(other);

    const res = await request(app)
      .get(`${VERIFY_URL}?companyRef=${target.toString()}`)
      .set("Cookie", session.cookie);

    expect(res.status).toBe(200);
    expect(res.body.data.totalEntries).toBe(2);
  });
});

describe("Audit-log chain verify — review patches", () => {
  const app = createApp();

  beforeEach(async () => {
    await AuditLogModel.deleteMany({});
    await AuditVerifyQuotaModel.deleteMany({});
  });

  it("refunds the quota slot when the row-count estimate fails (no burn on infra error)", async () => {
    const session = await createSuperAdminSession();
    const userId = (session.user._id as mongoose.Types.ObjectId).toString();
    vi.spyOn(mongoAuditProvider, "countAuditLogs").mockRejectedValueOnce(
      new Error("db unavailable"),
    );

    const res = await request(app)
      .get(`${VERIFY_URL}?companyRef=${new mongoose.Types.ObjectId()}`)
      .set("Cookie", session.cookie);

    expect(res.status).toBeGreaterThanOrEqual(500);
    // Incremented to 1 then refunded back to 0 — the infra failure did not burn
    // the user's verify window.
    const doc = await AuditVerifyQuotaModel.findById(currentWindowKey(userId));
    expect(doc?.count).toBe(0);
  });

  it("does NOT refund the quota slot on a 413 row-cap refusal (Q3: over-cap burns a slot)", async () => {
    const session = await createSuperAdminSession();
    const userId = (session.user._id as mongoose.Types.ObjectId).toString();
    vi.spyOn(mongoAuditProvider, "countAuditLogs").mockResolvedValue(
      AUDIT_CONSTANTS.verifyMaxRows + 1,
    );

    const res = await request(app)
      .get(`${VERIFY_URL}?companyRef=${new mongoose.Types.ObjectId()}`)
      .set("Cookie", session.cookie);

    expect(res.status).toBe(413);
    const doc = await AuditVerifyQuotaModel.findById(currentWindowKey(userId));
    expect(doc?.count).toBe(1);
  });

  it("countAuditLogs bounds the scan when a limit is passed", async () => {
    const companyRef = new mongoose.Types.ObjectId();
    await seedAuditRow(companyRef);
    await seedAuditRow(companyRef);
    await seedAuditRow(companyRef);

    const unbounded = await mongoAuditProvider.countAuditLogs({
      companyRef: companyRef.toString(),
    });
    expect(unbounded).toBe(3);

    const bounded = await mongoAuditProvider.countAuditLogs(
      { companyRef: companyRef.toString() },
      { limit: 2 },
    );
    expect(bounded).toBe(2);
  });
});

describe("Audit-log chain verify — hot-tier walk + report (E.2, AC#1-#5)", () => {
  const app = createApp();

  beforeEach(async () => {
    await AuditLogModel.deleteMany({});
    await ChainHeadModel.deleteMany({});
    await AuditVerifyQuotaModel.deleteMany({});
  });

  // Genuine signed chain through the real emit pipeline.
  async function seedChain(companyRef: mongoose.Types.ObjectId, n: number) {
    const principal = {
      _id: new mongoose.Types.ObjectId(),
      companyRef,
      role: USER_TYPE.ADMIN,
      email: "admin@acme.test",
      name: "Admin Alice",
    };
    for (let i = 0; i < n; i++) {
      await appendAuditLog(
        {
          category: AuditCategory.ADMIN_ACTION,
          action: `evt.${i}`,
          status: AuditStatus.SUCCESS,
          targetType: null,
          targetId: null,
          requestId: null,
          target: { label: null },
          context: { ip: null, userAgent: null, path: null, method: null },
          retentionDays: null,
        },
        principal,
        null,
        { throwOnFailure: true },
      );
    }
    return AuditLogModel.find({ companyRef })
      .sort({ timestamp: 1, _id: 1 })
      .lean();
  }

  it("returns the full FR24 report for a genuine clean chain", async () => {
    const session = await createSuperAdminSession();
    const companyRef = new mongoose.Types.ObjectId();
    await seedChain(companyRef, 4);

    const res = await request(app)
      .get(`${VERIFY_URL}?companyRef=${companyRef.toString()}`)
      .set("Cookie", session.cookie);

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      companyRef: companyRef.toString(),
      totalEntries: 4,
      breaksFound: 0,
      breaks: [],
      status: "clean",
    });
    expect(res.body.data.firstEntry).toBeTruthy();
    expect(res.body.data.lastEntry).toBeTruthy();
    expect(res.body.data.verifiedAt).toBeTruthy();
    expect(res.body.data.anchorUnverified).toBeUndefined();
  });

  it("returns 200 with status tampered for a tampered chain (tampered is a successful verification)", async () => {
    const session = await createSuperAdminSession();
    const companyRef = new mongoose.Types.ObjectId();
    const rows = await seedChain(companyRef, 4);
    await AuditLogModel.updateOne(
      { _id: rows[1]._id },
      { $set: { action: "evil.rewrite" } },
    );

    const res = await request(app)
      .get(`${VERIFY_URL}?companyRef=${companyRef.toString()}`)
      .set("Cookie", session.cookie);

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("tampered");
    expect(res.body.data.breaksFound).toBeGreaterThan(0);
    expect(res.body.data.breaks[0]).toMatchObject({
      entryId: rows[1]._id.toString(),
      tier: "hot",
    });
  });

  it("refunds the quota slot when the walk fails mid-stream (infra error)", async () => {
    const session = await createSuperAdminSession();
    const userId = (session.user._id as mongoose.Types.ObjectId).toString();
    vi.spyOn(auditLogsHelper, "verifyChain").mockRejectedValueOnce(
      new Error("db dropped mid-walk"),
    );

    const res = await request(app)
      .get(`${VERIFY_URL}?companyRef=${new mongoose.Types.ObjectId()}`)
      .set("Cookie", session.cookie);

    expect(res.status).toBeGreaterThanOrEqual(500);
    const doc = await AuditVerifyQuotaModel.findById(currentWindowKey(userId));
    expect(doc?.count).toBe(0);
  });

  it("maps a mid-walk ChainTooLargeError to the 413 refusal and keeps the slot burned", async () => {
    const session = await createSuperAdminSession();
    const userId = (session.user._id as mongoose.Types.ObjectId).toString();
    vi.spyOn(auditLogsHelper, "verifyChain").mockRejectedValueOnce(
      new ChainTooLargeError("x", AUDIT_CONSTANTS.verifyMaxRows),
    );

    const res = await request(app)
      .get(`${VERIFY_URL}?companyRef=${new mongoose.Types.ObjectId()}`)
      .set("Cookie", session.cookie);

    expect(res.status).toBe(413);
    expect(res.body.messageCode).toBe(ERROR_CODES.VERIFY_ROW_LIMIT_EXCEEDED);
    const doc = await AuditVerifyQuotaModel.findById(currentWindowKey(userId));
    expect(doc?.count).toBe(1);
  });
});

describe("Audit-log chain verify — cold-tier estimate (E.3, AC#7)", () => {
  const app = createApp();

  beforeEach(async () => {
    await AuditLogModel.deleteMany({});
    await ChainHeadModel.deleteMany({});
    await AuditVerifyQuotaModel.deleteMany({});
  });

  it("413s when hot + cold combined exceed the cap (cold count pushes it over)", async () => {
    const session = await createSuperAdminSession();
    vi.spyOn(athenaChainReader, "isColdTierConfigured").mockReturnValue(true);
    const coldCount = vi
      .spyOn(athenaChainReader, "countColdChain")
      .mockResolvedValue(AUDIT_CONSTANTS.verifyMaxRows + 1);
    const companyRef = new mongoose.Types.ObjectId().toString();

    const res = await request(app)
      .get(`${VERIFY_URL}?companyRef=${companyRef}`)
      .set("Cookie", session.cookie);

    expect(res.status).toBe(413);
    expect(res.body.messageCode).toBe(ERROR_CODES.VERIFY_ROW_LIMIT_EXCEEDED);
    expect(coldCount).toHaveBeenCalledWith(companyRef);
  });

  it("proceeds to a coldTier report when the combined estimate is under the cap", async () => {
    const session = await createSuperAdminSession();
    vi.spyOn(athenaChainReader, "isColdTierConfigured").mockReturnValue(true);
    vi.spyOn(athenaChainReader, "countColdChain").mockResolvedValue(5);
    // The default cold reader streams via the (globally mocked) Athena pager —
    // zero pages → empty cold tier, hot-only rows, coldTier flagged true.
    const companyRef = new mongoose.Types.ObjectId().toString();

    const res = await request(app)
      .get(`${VERIFY_URL}?companyRef=${companyRef}`)
      .set("Cookie", session.cookie);

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      companyRef,
      totalEntries: 0,
      coldTier: true,
      status: "clean",
    });
  });

  it("skips the cold count when the archive tier is unconfigured (hot-only degrade)", async () => {
    const session = await createSuperAdminSession();
    vi.spyOn(athenaChainReader, "isColdTierConfigured").mockReturnValue(false);
    const coldCount = vi.spyOn(athenaChainReader, "countColdChain");
    const companyRef = new mongoose.Types.ObjectId().toString();

    const res = await request(app)
      .get(`${VERIFY_URL}?companyRef=${companyRef}`)
      .set("Cookie", session.cookie);

    expect(res.status).toBe(200);
    expect(res.body.data.coldTier).toBe(false);
    expect(coldCount).not.toHaveBeenCalled();
  });

  it("refunds the quota slot when the cold count throws (infra parity with the hot estimate)", async () => {
    const session = await createSuperAdminSession();
    const userId = (session.user._id as mongoose.Types.ObjectId).toString();
    vi.spyOn(athenaChainReader, "isColdTierConfigured").mockReturnValue(true);
    vi.spyOn(athenaChainReader, "countColdChain").mockRejectedValueOnce(
      new Error("athena unavailable"),
    );

    const res = await request(app)
      .get(`${VERIFY_URL}?companyRef=${new mongoose.Types.ObjectId()}`)
      .set("Cookie", session.cookie);

    expect(res.status).toBeGreaterThanOrEqual(500);
    const doc = await AuditVerifyQuotaModel.findById(currentWindowKey(userId));
    expect(doc?.count).toBe(0);
  });
});

describe("Audit-log chain verify — sweep-collision guard (review patch 2026-06-04)", () => {
  const app = createApp();

  beforeEach(async () => {
    await AuditLogModel.deleteMany({});
    await AuditVerifyQuotaModel.deleteMany({});
    await MigrationLockModel.deleteMany({});
  });

  it("409s while the retention sweep lock is held, refunds the slot, and runs no walk", async () => {
    const session = await createSuperAdminSession();
    const userId = (session.user._id as mongoose.Types.ObjectId).toString();
    await MigrationLockModel.create({
      _id: RETENTION_SWEEP_ID,
      holder: "test-sweep-holder",
      expiresAt: new Date(Date.now() + 60_000),
    });
    const countSpy = vi.spyOn(mongoAuditProvider, "countAuditLogs");

    const res = await request(app)
      .get(`${VERIFY_URL}?companyRef=${new mongoose.Types.ObjectId()}`)
      .set("Cookie", session.cookie);

    expect(res.status).toBe(409);
    expect(res.body.messageCode).toBe(
      ERROR_CODES.VERIFY_RETENTION_SWEEP_ACTIVE,
    );
    expect(countSpy).not.toHaveBeenCalled();
    // Transient refusal — not the caller's fault, slot refunded back to 0.
    const doc = await AuditVerifyQuotaModel.findById(currentWindowKey(userId));
    expect(doc?.count).toBe(0);
  });

  it("proceeds to the report when the sweep lock exists but is expired (crashed sweep)", async () => {
    const session = await createSuperAdminSession();
    await MigrationLockModel.create({
      _id: RETENTION_SWEEP_ID,
      holder: "stale-holder",
      expiresAt: new Date(Date.now() - 1_000),
    });
    const companyRef = new mongoose.Types.ObjectId().toString();

    const res = await request(app)
      .get(`${VERIFY_URL}?companyRef=${companyRef}`)
      .set("Cookie", session.cookie);

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      companyRef,
      totalEntries: 0,
      status: "clean",
    });
  });

  it("does not 409 for an unrelated migration lock (only the retention sweep lock blocks)", async () => {
    const session = await createSuperAdminSession();
    await MigrationLockModel.create({
      _id: "some-other-migration",
      holder: "other-holder",
      expiresAt: new Date(Date.now() + 60_000),
    });

    const res = await request(app)
      .get(`${VERIFY_URL}?companyRef=${new mongoose.Types.ObjectId()}`)
      .set("Cookie", session.cookie);

    expect(res.status).toBe(200);
  });
});
