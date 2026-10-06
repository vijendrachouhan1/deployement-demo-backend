import mongoose from "mongoose";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

import "@/tests/mocks/database.mock";

import { createApp } from "@/app";
import { ERROR_CODES } from "@/constants/error-codes";
import { AUDIT_CONSTANTS } from "@/providers/audit-logs/utils/audit.constant";
import { AuditExportQuotaModel } from "@/db/models/audit-logs/audit-export-quota";
import { AuditLogModel } from "@/db/models/audit-logs/audit-log";
import { USER_TYPE } from "@/enums";
import { EXPORT_QUOTA_WINDOW_MS } from "@/modules/audit-logs/helpers/audit-log.helper";
import { mongoAuditProvider } from "@/providers/audit-logs";
import { fileStorageService } from "@/providers/file-storage";
import {
  createAdminSession,
  createSuperAdminSession,
  createUserSession,
} from "@/tests/utils/auth";
import { AuditCategory } from "@/enums/audit.enum";
import { SUBSYSTEM_MAPPING_VERSION } from "@/db/plugins/audit/utils/subsystem";

async function seedAuditRow(overrides: {
  companyRef: mongoose.Types.ObjectId;
  action?: string;
  status?: "success" | "failure";
}) {
  return AuditLogModel.create({
    timestamp: new Date(),
    category: AuditCategory.ADMIN_ACTION,
    action: overrides.action ?? "user.status_updated",
    status: overrides.status ?? "success",
    companyRef: overrides.companyRef,
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

// Spies on the storage singleton — tests never touch real S3. Set per test;
// restoreMocks (vitest config) auto-restores the originals afterwards.
let uploadSpy: ReturnType<typeof vi.spyOn>;
let presignSpy: ReturnType<typeof vi.spyOn>;

function stubStorage() {
  uploadSpy = vi
    .spyOn(fileStorageService, "upload")
    .mockResolvedValue({ key: "stub-key" });
  presignSpy = vi
    .spyOn(fileStorageService, "getPreSignedUrl")
    .mockResolvedValue({
      url: "https://signed.example/file",
      keyFile: "stub-key",
    });
}

// Parse the rows serialized into the most recent JSON upload.
function uploadedJsonActions(): string[] {
  const file = uploadSpy.mock.calls.at(-1)?.[0] as { buffer: Buffer };
  const rows = JSON.parse(file.buffer.toString("utf-8")) as {
    action: string;
  }[];
  return rows.map((r) => r.action);
}

describe("Audit-log export — admin", () => {
  const app = createApp();

  beforeEach(async () => {
    await AuditLogModel.deleteMany({});
    stubStorage();
  });

  it("returns a presigned-URL envelope, never the raw rows (AC#3)", async () => {
    const session = await createAdminSession();
    await seedAuditRow({
      companyRef: session.company._id as mongoose.Types.ObjectId,
    });

    const res = await request(app)
      .get("/api/admin/audit-logs/export")
      .set("Cookie", session.cookie);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({
      url: "https://signed.example/file",
      format: "json",
      truncated: false,
    });
    expect(res.body.data.key).toEqual(expect.any(String));
    expect(res.body.data.rowCount).toBe(1);
    // The body must NOT carry the audit rows.
    expect(res.body.data.data).toBeUndefined();
  });

  it("exports only the admin's own-company rows (AC#1, #3)", async () => {
    const session = await createAdminSession();
    const own = session.company._id as mongoose.Types.ObjectId;
    const other = new mongoose.Types.ObjectId();
    await seedAuditRow({ companyRef: own, action: "own.1" });
    await seedAuditRow({ companyRef: other, action: "foreign.1" });

    const res = await request(app)
      .get("/api/admin/audit-logs/export")
      .set("Cookie", session.cookie);

    expect(res.status).toBe(200);
    const actions = uploadedJsonActions();
    expect(actions).toContain("own.1");
    expect(actions).not.toContain("foreign.1");
  });

  it("ignores a client-supplied companyRef (forces own scope) (AC#3)", async () => {
    const session = await createAdminSession();
    const own = session.company._id as mongoose.Types.ObjectId;
    const other = new mongoose.Types.ObjectId();
    await seedAuditRow({ companyRef: own });
    await seedAuditRow({ companyRef: other, action: "leak.attempt" });

    const res = await request(app)
      .get(`/api/admin/audit-logs/export?companyRef=${other.toString()}`)
      .set("Cookie", session.cookie);

    expect(res.status).toBe(200);
    expect(uploadedJsonActions()).not.toContain("leak.attempt");
  });

  it("honors format=csv|json, defaults to json, rejects invalid (AC#2)", async () => {
    const session = await createAdminSession();
    await seedAuditRow({
      companyRef: session.company._id as mongoose.Types.ObjectId,
    });

    const csv = await request(app)
      .get("/api/admin/audit-logs/export?format=csv")
      .set("Cookie", session.cookie);
    expect(csv.status).toBe(200);
    expect(csv.body.data.format).toBe("csv");
    expect(uploadSpy.mock.calls.at(-1)?.[0]).toMatchObject({
      mimeType: "text/csv",
    });

    const json = await request(app)
      .get("/api/admin/audit-logs/export?format=json")
      .set("Cookie", session.cookie);
    expect(json.status).toBe(200);
    expect(uploadSpy.mock.calls.at(-1)?.[0]).toMatchObject({
      mimeType: "application/json",
    });

    const omitted = await request(app)
      .get("/api/admin/audit-logs/export")
      .set("Cookie", session.cookie);
    expect(omitted.status).toBe(200);
    expect(omitted.body.data.format).toBe("json");

    const bad = await request(app)
      .get("/api/admin/audit-logs/export?format=xml")
      .set("Cookie", session.cookie);
    expect(bad.status).toBe(400);
  });

  it("passes the configured TTL to the presigned GET URL (AC#4)", async () => {
    const session = await createAdminSession();
    await seedAuditRow({
      companyRef: session.company._id as mongoose.Types.ObjectId,
    });

    await request(app)
      .get("/api/admin/audit-logs/export")
      .set("Cookie", session.cookie);

    expect(presignSpy).toHaveBeenCalledWith(
      expect.any(String),
      "application/json",
      expect.objectContaining({ operation: "get", expiresIn: 900 }),
    );
  });

  it("narrows the export by a filter, like the list (AC#1)", async () => {
    const session = await createAdminSession();
    const own = session.company._id as mongoose.Types.ObjectId;
    await seedAuditRow({ companyRef: own, action: "a.ok", status: "success" });
    await seedAuditRow({
      companyRef: own,
      action: "a.fail",
      status: "failure",
    });

    const res = await request(app)
      .get("/api/admin/audit-logs/export?status=failure")
      .set("Cookie", session.cookie);

    expect(res.status).toBe(200);
    const actions = uploadedJsonActions();
    expect(actions).toContain("a.fail");
    expect(actions).not.toContain("a.ok");
  });

  it("rejects ?search on the admin export (super-admin-only)", async () => {
    const session = await createAdminSession();
    const res = await request(app)
      .get("/api/admin/audit-logs/export?search=alice")
      .set("Cookie", session.cookie);
    expect(res.status).toBe(400);
  });

  it("caps at 5000 rows and flags truncation (AC#5)", async () => {
    const session = await createAdminSession();
    const own = session.company._id as mongoose.Types.ObjectId;
    // Stub the provider to overflow the cap without seeding 5001 docs.
    const overflow = Array.from({ length: 5001 }, (_, i) => ({
      _id: new mongoose.Types.ObjectId(),
      action: `row.${i}`,
      companyRef: own,
    })) as unknown as Awaited<
      ReturnType<typeof mongoAuditProvider.findAuditLogsForExport>
    >;
    vi.spyOn(mongoAuditProvider, "findAuditLogsForExport").mockResolvedValue(
      overflow,
    );

    const res = await request(app)
      .get("/api/admin/audit-logs/export")
      .set("Cookie", session.cookie);

    expect(res.status).toBe(200);
    expect(res.body.data.truncated).toBe(true);
    expect(res.body.data.rowCount).toBe(5000);
  });

  it("returns 5xx and no link when the S3 upload fails (AC#6)", async () => {
    const session = await createAdminSession();
    await seedAuditRow({
      companyRef: session.company._id as mongoose.Types.ObjectId,
    });
    uploadSpy.mockRejectedValueOnce(new Error("s3 unavailable"));

    const res = await request(app)
      .get("/api/admin/audit-logs/export")
      .set("Cookie", session.cookie);

    expect(res.status).toBeGreaterThanOrEqual(500);
    expect(res.body?.data?.url).toBeUndefined();
    expect(presignSpy).not.toHaveBeenCalled();
  });
});

describe("Audit-log export — super-admin", () => {
  const app = createApp();

  beforeEach(async () => {
    await AuditLogModel.deleteMany({});
    stubStorage();
  });

  it("exports across all tenants by default (AC#3)", async () => {
    const session = await createSuperAdminSession();
    const a = new mongoose.Types.ObjectId();
    const b = new mongoose.Types.ObjectId();
    await seedAuditRow({ companyRef: a, action: "a.1" });
    await seedAuditRow({ companyRef: b, action: "b.1" });

    const res = await request(app)
      .get("/api/super-admin/audit-logs/export")
      .set("Cookie", session.cookie);

    expect(res.status).toBe(200);
    const actions = uploadedJsonActions();
    expect(actions).toContain("a.1");
    expect(actions).toContain("b.1");
  });

  it("scopes to ?companyRef= when supplied (AC#3)", async () => {
    const session = await createSuperAdminSession();
    const a = new mongoose.Types.ObjectId();
    const b = new mongoose.Types.ObjectId();
    await seedAuditRow({ companyRef: a, action: "a.only" });
    await seedAuditRow({ companyRef: b, action: "b.excluded" });

    const res = await request(app)
      .get(`/api/super-admin/audit-logs/export?companyRef=${a.toString()}`)
      .set("Cookie", session.cookie);

    expect(res.status).toBe(200);
    const actions = uploadedJsonActions();
    expect(actions).toContain("a.only");
    expect(actions).not.toContain("b.excluded");
  });
});

describe("Audit-log export — quota (C.3)", () => {
  const app = createApp();
  const LIMIT = AUDIT_CONSTANTS.exportMaxPerWindow;

  function currentWindowKey(userId: string): string {
    const windowStart =
      Math.floor(Date.now() / EXPORT_QUOTA_WINDOW_MS) * EXPORT_QUOTA_WINDOW_MS;
    return `${userId}:${windowStart}`;
  }

  // Seed the caller's counter for the CURRENT window so we hit the boundary
  // without firing LIMIT real requests.
  async function seedQuota(userId: string, count: number, windowKey?: string) {
    return AuditExportQuotaModel.create({
      _id: windowKey ?? currentWindowKey(userId),
      userId: new mongoose.Types.ObjectId(userId),
      count,
      expiresAt: new Date(Date.now() + EXPORT_QUOTA_WINDOW_MS),
    });
  }

  beforeEach(async () => {
    await AuditLogModel.deleteMany({});
    await AuditExportQuotaModel.deleteMany({});
    stubStorage();
  });

  it("allows an export while under the per-window limit (AC#3)", async () => {
    const session = await createAdminSession();
    await seedAuditRow({
      companyRef: session.company._id as mongoose.Types.ObjectId,
    });

    const res = await request(app)
      .get("/api/admin/audit-logs/export")
      .set("Cookie", session.cookie);

    expect(res.status).toBe(200);
    expect(uploadSpy).toHaveBeenCalledTimes(1);
  });

  it("rejects with 429 rate_limit_exceeded once over the limit, and runs no export job (AC#1, #2)", async () => {
    const session = await createAdminSession();
    const userId = (session.user._id as mongoose.Types.ObjectId).toString();
    await seedAuditRow({
      companyRef: session.company._id as mongoose.Types.ObjectId,
    });
    // Already at the cap → the next request increments past it → 429.
    await seedQuota(userId, LIMIT);

    const res = await request(app)
      .get("/api/admin/audit-logs/export")
      .set("Cookie", session.cookie);

    expect(res.status).toBe(429);
    expect(res.body.messageCode).toBe(ERROR_CODES.RATE_LIMIT_EXCEEDED);
    // No export work ran.
    expect(uploadSpy).not.toHaveBeenCalled();
    expect(presignSpy).not.toHaveBeenCalled();
  });

  it("counts the boundary exactly: the LIMIT-th succeeds, the next 429s (AC#1)", async () => {
    const session = await createAdminSession();
    const userId = (session.user._id as mongoose.Types.ObjectId).toString();
    await seedAuditRow({
      companyRef: session.company._id as mongoose.Types.ObjectId,
    });
    // One below the cap: next call → count == LIMIT (allowed), then → 429.
    await seedQuota(userId, LIMIT - 1);

    const ok = await request(app)
      .get("/api/admin/audit-logs/export")
      .set("Cookie", session.cookie);
    expect(ok.status).toBe(200);

    const blocked = await request(app)
      .get("/api/admin/audit-logs/export")
      .set("Cookie", session.cookie);
    expect(blocked.status).toBe(429);
  });

  it("is per-user: one user's limit does not block another (AC#5)", async () => {
    const a = await createAdminSession();
    const b = await createAdminSession();
    const aId = (a.user._id as mongoose.Types.ObjectId).toString();
    await seedAuditRow({
      companyRef: a.company._id as mongoose.Types.ObjectId,
    });
    await seedAuditRow({
      companyRef: b.company._id as mongoose.Types.ObjectId,
    });
    await seedQuota(aId, LIMIT); // A is maxed out

    const blockedA = await request(app)
      .get("/api/admin/audit-logs/export")
      .set("Cookie", a.cookie);
    expect(blockedA.status).toBe(429);

    const okB = await request(app)
      .get("/api/admin/audit-logs/export")
      .set("Cookie", b.cookie);
    expect(okB.status).toBe(200);
  });

  it("starts a fresh count when the previous window has rolled over (AC#4)", async () => {
    const session = await createAdminSession();
    const userId = (session.user._id as mongoose.Types.ObjectId).toString();
    await seedAuditRow({
      companyRef: session.company._id as mongoose.Types.ObjectId,
    });
    // A maxed-out counter for a PAST window must not affect the current one.
    const pastWindowStart =
      Math.floor(Date.now() / EXPORT_QUOTA_WINDOW_MS) * EXPORT_QUOTA_WINDOW_MS -
      EXPORT_QUOTA_WINDOW_MS;
    await seedQuota(userId, LIMIT, `${userId}:${pastWindowStart}`);

    const res = await request(app)
      .get("/api/admin/audit-logs/export")
      .set("Cookie", session.cookie);

    expect(res.status).toBe(200);
    const fresh = await AuditExportQuotaModel.findById(
      currentWindowKey(userId),
    );
    expect(fresh?.count).toBe(1);
  });

  it("refunds the quota slot when the export job fails (no burn on infra error)", async () => {
    const session = await createAdminSession();
    const userId = (session.user._id as mongoose.Types.ObjectId).toString();
    await seedAuditRow({
      companyRef: session.company._id as mongoose.Types.ObjectId,
    });
    uploadSpy.mockRejectedValueOnce(new Error("s3 unavailable"));

    const res = await request(app)
      .get("/api/admin/audit-logs/export")
      .set("Cookie", session.cookie);

    expect(res.status).toBeGreaterThanOrEqual(500);
    // Counter was incremented to 1 then refunded back to 0 — the failed export
    // did not consume the user's window.
    const doc = await AuditExportQuotaModel.findById(currentWindowKey(userId));
    expect(doc?.count).toBe(0);
  });

  it("enforces the quota on the super-admin export too (AC#2)", async () => {
    const session = await createSuperAdminSession();
    const userId = (session.user._id as mongoose.Types.ObjectId).toString();
    await seedQuota(userId, LIMIT);

    const res = await request(app)
      .get("/api/super-admin/audit-logs/export")
      .set("Cookie", session.cookie);

    expect(res.status).toBe(429);
    expect(res.body.messageCode).toBe(ERROR_CODES.RATE_LIMIT_EXCEEDED);
    expect(uploadSpy).not.toHaveBeenCalled();
  });
});

describe("Audit-log export — admin.export_run audit emit (C.4)", () => {
  const app = createApp();

  beforeEach(async () => {
    await AuditLogModel.deleteMany({});
    await AuditExportQuotaModel.deleteMany({});
    stubStorage();
  });

  it("emits a synchronous admin.export_run row on a successful admin export (AC#1, #2, #3)", async () => {
    const session = await createAdminSession();
    const own = session.company._id as mongoose.Types.ObjectId;
    await seedAuditRow({ companyRef: own });

    const res = await request(app)
      .get("/api/admin/audit-logs/export")
      .set("Cookie", session.cookie);

    expect(res.status).toBe(200);

    // Emit is awaited → the row is queryable immediately, no sleep/poll.
    const row = await AuditLogModel.findOne({
      action: "admin.export_run",
    }).lean();
    expect(row).toBeTruthy();
    expect(row?.category).toBe(AuditCategory.ADMIN_ACTION);
    expect(row?.status).toBe("success");
    expect(row?.metadata?.format).toBe("json");
    expect(row?.metadata?.rowCount).toBe(1);
    expect(row?.metadata?.truncated).toBe(false);
    // metadata.companyRef carries the exported scope (the admin's own tenant).
    expect(row?.metadata?.companyRef).toBe(own.toString());
    // Actor is server-derived from the calling principal.
    expect(row?.actorId?.toString()).toBe(
      (session.user._id as mongoose.Types.ObjectId).toString(),
    );
  });

  it("emits admin.export_run with metadata.companyRef='all' for a cross-tenant super-admin export (AC#1, #3)", async () => {
    const session = await createSuperAdminSession();
    await seedAuditRow({ companyRef: new mongoose.Types.ObjectId() });

    const res = await request(app)
      .get("/api/super-admin/audit-logs/export")
      .set("Cookie", session.cookie);

    expect(res.status).toBe(200);

    const row = await AuditLogModel.findOne({
      action: "admin.export_run",
    }).lean();
    expect(row).toBeTruthy();
    expect(row?.metadata?.companyRef).toBe("all");
    expect(row?.actorId?.toString()).toBe(
      (session.user._id as mongoose.Types.ObjectId).toString(),
    );
  });

  it("emits admin.export_run with metadata.companyRef set to a supplied ?companyRef (super-admin) (AC#3)", async () => {
    const session = await createSuperAdminSession();
    const target = new mongoose.Types.ObjectId();
    await seedAuditRow({ companyRef: target });

    const res = await request(app)
      .get(`/api/super-admin/audit-logs/export?companyRef=${target.toString()}`)
      .set("Cookie", session.cookie);

    expect(res.status).toBe(200);
    const row = await AuditLogModel.findOne({
      action: "admin.export_run",
    }).lean();
    expect(row?.metadata?.companyRef).toBe(target.toString());
  });

  it("captures the applied filters in metadata.filters, excluding format/pagination (AC#3)", async () => {
    const session = await createAdminSession();
    await seedAuditRow({
      companyRef: session.company._id as mongoose.Types.ObjectId,
    });

    const res = await request(app)
      .get(
        "/api/admin/audit-logs/export?category=rbac&status=failure&format=csv&page=2&pageSize=10",
      )
      .set("Cookie", session.cookie);

    expect(res.status).toBe(200);
    const row = await AuditLogModel.findOne({
      action: "admin.export_run",
    }).lean();
    const filters = row?.metadata?.filters as Record<string, unknown>;
    expect(filters).toMatchObject({ category: "rbac", status: "failure" });
    // Resolved filter subset only — never the raw query.
    expect(filters).not.toHaveProperty("format");
    expect(filters).not.toHaveProperty("page");
    expect(filters).not.toHaveProperty("pageSize");
    expect(filters).not.toHaveProperty("companyRef");
    // format lives at the top of metadata, not inside filters.
    expect(row?.metadata?.format).toBe("csv");
  });

  it("returns 5xx with no link when the emit fails, but the export already ran (AC#4)", async () => {
    const session = await createAdminSession();
    await seedAuditRow({
      companyRef: session.company._id as mongoose.Types.ObjectId,
    });
    // Force the chain write (and thus emitAuditLogSync) to reject — after the
    // export upload has already happened.
    vi.spyOn(AuditLogModel, "create").mockRejectedValue(
      new Error("chain write failed") as never,
    );

    const res = await request(app)
      .get("/api/admin/audit-logs/export")
      .set("Cookie", session.cookie);

    expect(res.status).toBeGreaterThanOrEqual(500);
    expect(res.body?.data?.url).toBeUndefined();
    // The export genuinely ran (object uploaded) — only the audit record failed.
    expect(uploadSpy).toHaveBeenCalledTimes(1);
  });

  it("does NOT emit admin.export_run on a 429 quota rejection (AC#5)", async () => {
    const session = await createAdminSession();
    const userId = (session.user._id as mongoose.Types.ObjectId).toString();
    await seedAuditRow({
      companyRef: session.company._id as mongoose.Types.ObjectId,
    });
    const windowStart =
      Math.floor(Date.now() / EXPORT_QUOTA_WINDOW_MS) * EXPORT_QUOTA_WINDOW_MS;
    await AuditExportQuotaModel.create({
      _id: `${userId}:${windowStart}`,
      userId: new mongoose.Types.ObjectId(userId),
      count: AUDIT_CONSTANTS.exportMaxPerWindow,
      expiresAt: new Date(windowStart + EXPORT_QUOTA_WINDOW_MS),
    });

    const res = await request(app)
      .get("/api/admin/audit-logs/export")
      .set("Cookie", session.cookie);

    expect(res.status).toBe(429);
    const row = await AuditLogModel.findOne({ action: "admin.export_run" });
    expect(row).toBeNull();
  });

  it("does NOT emit admin.export_run when the export job (S3) fails (AC#5)", async () => {
    const session = await createAdminSession();
    await seedAuditRow({
      companyRef: session.company._id as mongoose.Types.ObjectId,
    });
    uploadSpy.mockRejectedValueOnce(new Error("s3 unavailable"));

    const res = await request(app)
      .get("/api/admin/audit-logs/export")
      .set("Cookie", session.cookie);

    expect(res.status).toBeGreaterThanOrEqual(500);
    const row = await AuditLogModel.findOne({ action: "admin.export_run" });
    expect(row).toBeNull();
  });
});

describe("Audit-log export — role gates (AC#7)", () => {
  const app = createApp();

  beforeEach(() => {
    stubStorage();
  });

  it("rejects a USER role on the admin export", async () => {
    const session = await createUserSession();
    const res = await request(app)
      .get("/api/admin/audit-logs/export")
      .set("Cookie", session.cookie);
    expect([401, 403]).toContain(res.status);
  });

  it("rejects an unauthenticated admin export", async () => {
    const res = await request(app).get("/api/admin/audit-logs/export");
    expect(res.status).toBe(401);
  });

  it("rejects an unauthenticated super-admin export", async () => {
    const res = await request(app).get("/api/super-admin/audit-logs/export");
    expect(res.status).toBe(401);
  });
});
