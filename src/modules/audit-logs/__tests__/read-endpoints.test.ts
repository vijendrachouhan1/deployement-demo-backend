import mongoose from "mongoose";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";

import { createApp } from "@/app";
import { AuditLogModel } from "@/db/models/audit-logs/audit-log";
import { USER_TYPE } from "@/enums";
import "@/tests/mocks/database.mock";
import {
  createAdminSession,
  createSuperAdminSession,
  createUserSession,
} from "@/tests/utils/auth";
import { AuditCategory } from "@/enums/audit.enum";
import { SUBSYSTEM_MAPPING_VERSION } from "@/db/plugins/audit/utils/subsystem";

async function seedAuditRow(overrides: {
  companyRef: mongoose.Types.ObjectId;
  actorEmail?: string | null;
  action?: string;
  status?: "success" | "failure";
  targetType?: string | null;
  prevSig?: string;
  sig?: string;
}) {
  const companyRef = overrides.companyRef;
  return AuditLogModel.create({
    timestamp: new Date(),
    category: AuditCategory.ADMIN_ACTION,
    action: overrides.action ?? "user.status_updated",
    status: overrides.status ?? "success",
    companyRef,
    actorId: new mongoose.Types.ObjectId(),
    actorEmail: overrides.actorEmail ?? "actor@a.test",
    actorRole: USER_TYPE.ADMIN,
    targetType: overrides.targetType ?? "users",
    targetId: new mongoose.Types.ObjectId(),
    requestId: "test-req-id",
    subsystemMappingVersion: SUBSYSTEM_MAPPING_VERSION,
    actor: { name: "Admin" },
    target: { label: null },
    context: { ip: null, userAgent: null, path: null, method: null },
    retentionDays: null,
    _sig: overrides.sig ?? `sig-${Math.random()}`,
    _prevSig: overrides.prevSig ?? "ROOT",
  });
}

describe("Audit-log read endpoints — admin", () => {
  const app = createApp();

  beforeEach(async () => {
    await AuditLogModel.deleteMany({});
  });

  it("returns rows scoped to admin's own company", async () => {
    const session = await createAdminSession();
    const ownCompany = session.company._id as mongoose.Types.ObjectId;
    const otherCompany = new mongoose.Types.ObjectId();

    await seedAuditRow({ companyRef: ownCompany, action: "user.own.1" });
    await seedAuditRow({ companyRef: ownCompany, action: "user.own.2" });
    await seedAuditRow({ companyRef: otherCompany, action: "user.foreign" });

    const res = await request(app)
      .get("/api/admin/audit-logs")
      .set("Cookie", session.cookie)
      .set("Accept", "application/json");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.data.length).toBe(2);
    const actions = res.body.data.data.map((r: any) => r.action);
    expect(actions).not.toContain("user.foreign");
  });

  it("silently drops caller-supplied companyRef and forces own scope", async () => {
    const session = await createAdminSession();
    const ownCompany = session.company._id as mongoose.Types.ObjectId;
    const otherCompany = new mongoose.Types.ObjectId();

    await seedAuditRow({ companyRef: ownCompany });
    await seedAuditRow({ companyRef: otherCompany, action: "leak.attempt" });

    const res = await request(app)
      .get(`/api/admin/audit-logs?companyRef=${otherCompany.toString()}`)
      .set("Cookie", session.cookie);

    expect(res.status).toBe(200);
    const actions = res.body.data.data.map((r: any) => r.action);
    expect(actions).not.toContain("leak.attempt");
  });

  it('rejects ?companyRef={"$regex":".*"} JSON coercion attempt', async () => {
    const session = await createAdminSession();
    const res = await request(app)
      .get(
        `/api/admin/audit-logs?companyRef=${encodeURIComponent('{"$regex":".*"}')}`,
      )
      .set("Cookie", session.cookie);

    expect(res.status).toBe(400);
  });

  it("rejects ?search=anything on admin route (substring forbidden)", async () => {
    const session = await createAdminSession();
    const res = await request(app)
      .get("/api/admin/audit-logs?search=alice")
      .set("Cookie", session.cookie);

    expect(res.status).toBe(400);
  });

  it("returns 404 (not 403) for GET /:id of foreign-tenant row", async () => {
    const session = await createAdminSession();
    const otherCompany = new mongoose.Types.ObjectId();
    const foreignRow = await seedAuditRow({ companyRef: otherCompany });

    const res = await request(app)
      .get(`/api/admin/audit-logs/${foreignRow._id}`)
      .set("Cookie", session.cookie);

    expect(res.status).toBe(404);
  });

  it("returns 200 for GET /:id of own-tenant row", async () => {
    const session = await createAdminSession();
    const ownCompany = session.company._id as mongoose.Types.ObjectId;
    const ownRow = await seedAuditRow({ companyRef: ownCompany });

    const res = await request(app)
      .get(`/api/admin/audit-logs/${ownRow._id}`)
      .set("Cookie", session.cookie);

    expect(res.status).toBe(200);
    expect(res.body.data._id).toBe(ownRow._id.toString());
  });

  it("returns 400 for malformed ObjectId in /:id", async () => {
    const session = await createAdminSession();
    const res = await request(app)
      .get("/api/admin/audit-logs/not-an-objectid")
      .set("Cookie", session.cookie);

    expect(res.status).toBe(400);
  });

  it("returns 403 for USER role (no AUDIT_LOGS_VIEW grant)", async () => {
    const session = await createUserSession();
    const res = await request(app)
      .get("/api/admin/audit-logs")
      .set("Cookie", session.cookie);

    // USER fails adminMiddleware first → 401
    expect([401, 403]).toContain(res.status);
  });
});

describe("Audit-log read endpoints — super-admin", () => {
  const app = createApp();

  beforeEach(async () => {
    await AuditLogModel.deleteMany({});
  });

  it("returns rows across ALL tenants by default", async () => {
    const session = await createSuperAdminSession();
    const tenantA = new mongoose.Types.ObjectId();
    const tenantB = new mongoose.Types.ObjectId();
    await seedAuditRow({ companyRef: tenantA, action: "a.1" });
    await seedAuditRow({ companyRef: tenantB, action: "b.1" });

    const res = await request(app)
      .get("/api/super-admin/audit-logs")
      .set("Cookie", session.cookie);

    expect(res.status).toBe(200);
    const actions = res.body.data.data.map((r: any) => r.action);
    expect(actions).toContain("a.1");
    expect(actions).toContain("b.1");
  });

  it("scopes to ?companyRef= when supplied", async () => {
    const session = await createSuperAdminSession();
    const tenantA = new mongoose.Types.ObjectId();
    const tenantB = new mongoose.Types.ObjectId();
    await seedAuditRow({ companyRef: tenantA, action: "a.only" });
    await seedAuditRow({ companyRef: tenantB, action: "b.excluded" });

    const res = await request(app)
      .get(`/api/super-admin/audit-logs?companyRef=${tenantA.toString()}`)
      .set("Cookie", session.cookie);

    expect(res.status).toBe(200);
    const actions = res.body.data.data.map((r: any) => r.action);
    expect(actions).toContain("a.only");
    expect(actions).not.toContain("b.excluded");
  });

  it("accepts ?search=substring (super-admin only)", async () => {
    const session = await createSuperAdminSession();
    const tenant = new mongoose.Types.ObjectId();
    await seedAuditRow({ companyRef: tenant, actorEmail: "alice@x.test" });
    await seedAuditRow({ companyRef: tenant, actorEmail: "bob@x.test" });

    const res = await request(app)
      .get("/api/super-admin/audit-logs?search=alice")
      .set("Cookie", session.cookie);

    expect(res.status).toBe(200);
    const emails = res.body.data.data.map((r: any) => r.actorEmail);
    expect(emails).toContain("alice@x.test");
    expect(emails).not.toContain("bob@x.test");
  });

  it('rejects ?companyRef={"$regex":".*"} regex coercion', async () => {
    const session = await createSuperAdminSession();
    const res = await request(app)
      .get(
        `/api/super-admin/audit-logs?companyRef=${encodeURIComponent('{"$regex":".*"}')}`,
      )
      .set("Cookie", session.cookie);

    expect(res.status).toBe(400);
  });

  it("returns 200 for GET /:id of any-tenant row", async () => {
    const session = await createSuperAdminSession();
    const row = await seedAuditRow({
      companyRef: new mongoose.Types.ObjectId(),
    });

    const res = await request(app)
      .get(`/api/super-admin/audit-logs/${row._id}`)
      .set("Cookie", session.cookie);

    expect(res.status).toBe(200);
  });
});

describe("Audit-log read endpoints — companyRef edge cases", () => {
  const app = createApp();

  beforeEach(async () => {
    await AuditLogModel.deleteMany({});
  });

  it("super-admin: SYSTEM:auth shortcut resolves to the sentinel ObjectId", async () => {
    const session = await createSuperAdminSession();

    // Seed a row owned by the AUTH subsystem sentinel.
    const { SYSTEM_SUBSYSTEM_REFS, SystemSubsystem } =
      await import("@/db/plugins/audit/utils/subsystem.js");
    await seedAuditRow({
      companyRef: SYSTEM_SUBSYSTEM_REFS[SystemSubsystem.AUTH],
      action: "system.auth.login",
    });
    // Seed a row owned by a normal tenant.
    await seedAuditRow({
      companyRef: new mongoose.Types.ObjectId(),
      action: "tenant.regular",
    });

    const res = await request(app)
      .get("/api/super-admin/audit-logs?companyRef=SYSTEM:auth")
      .set("Cookie", session.cookie);

    expect(res.status).toBe(200);
    const actions = res.body.data.data.map((r: any) => r.action);
    expect(actions).toContain("system.auth.login");
    expect(actions).not.toContain("tenant.regular");
  });

  it("rejects non-hex slug companyRef (e.g. tenant_slug_xyz)", async () => {
    const session = await createSuperAdminSession();
    const res = await request(app)
      .get("/api/super-admin/audit-logs?companyRef=tenant_slug_xyz")
      .set("Cookie", session.cookie);

    expect(res.status).toBe(400);
  });

  it("rejects unknown SYSTEM subsystem name", async () => {
    const session = await createSuperAdminSession();
    const res = await request(app)
      .get("/api/super-admin/audit-logs?companyRef=SYSTEM:bogussub")
      .set("Cookie", session.cookie);

    expect(res.status).toBe(400);
  });

  it("rejects page above 10000 cap", async () => {
    const session = await createSuperAdminSession();
    const res = await request(app)
      .get("/api/super-admin/audit-logs?page=999999999")
      .set("Cookie", session.cookie);

    expect(res.status).toBe(400);
  });
});

describe("Audit-log read endpoints — auth gates", () => {
  const app = createApp();

  it("admin route returns 401 for unauthenticated request", async () => {
    const res = await request(app).get("/api/admin/audit-logs");
    expect(res.status).toBe(401);
  });

  it("super-admin route returns 401 for unauthenticated request", async () => {
    const res = await request(app).get("/api/super-admin/audit-logs");
    expect(res.status).toBe(401);
  });

  it("server ignores X-Request-Id header from client", async () => {
    const session = await createAdminSession();
    const res = await request(app)
      .get("/api/admin/audit-logs")
      .set("X-Request-Id", "client-supplied-spoof")
      .set("Cookie", session.cookie);

    expect(res.status).toBe(200);
    const echoed = res.headers["x-request-id"] as string;
    expect(echoed).toBeDefined();
    expect(echoed).not.toBe("client-supplied-spoof");
    expect(echoed).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });
});
