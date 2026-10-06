import mongoose from "mongoose";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import "@/tests/mocks/database.mock";

import { AuditLogModel } from "@/db/models/audit-logs/audit-log";
import { AuditLogDlqModel } from "@/db/models/audit-logs/audit-log-dlq";
import { ChainHeadModel } from "@/db/models/audit-logs/chain-head";
import { USER_TYPE } from "@/enums";
import {
  AUDIT_COLLECTIONS,
  AuditWipeRefused,
  CONFIRM_TOKEN,
  runWipeCli,
  wipeAuditCollections,
} from "@/modules/audit-logs/helpers/wipe.helper";
import { AuditCategory } from "@/enums/audit.enum";
import { SUBSYSTEM_MAPPING_VERSION } from "@/db/plugins/audit/utils/subsystem";

async function seed(): Promise<void> {
  const companyRef = new mongoose.Types.ObjectId();
  for (let i = 0; i < 3; i++) {
    await AuditLogModel.create({
      timestamp: new Date(),
      category: AuditCategory.ADMIN_ACTION,
      action: `evt.${i}`,
      status: "success",
      companyRef,
      actorId: new mongoose.Types.ObjectId(),
      actorEmail: "a@b.test",
      actorRole: USER_TYPE.ADMIN,
      targetType: null,
      targetId: null,
      requestId: null,
      subsystemMappingVersion: SUBSYSTEM_MAPPING_VERSION,
      actor: { name: "Admin" },
      target: { label: null },
      context: { ip: null, userAgent: null, path: null, method: null },
      retentionDays: null,
      _sig: `sig-${i}`,
      _prevSig: i === 0 ? "ROOT" : `sig-${i - 1}`,
    });
  }
  await ChainHeadModel.create({
    _id: companyRef,
    subsystem: null,
    lastSig: "sig-2",
    updatedAt: new Date(),
  });
  await AuditLogDlqModel.create({
    timestamp: new Date(),
    category: AuditCategory.ADMIN_ACTION,
    action: "evt.dlq",
    status: "success",
    companyRef,
    actorId: new mongoose.Types.ObjectId(),
    actorEmail: "a@b.test",
    actorRole: USER_TYPE.ADMIN,
    targetType: null,
    targetId: null,
    requestId: null,
    subsystemMappingVersion: SUBSYSTEM_MAPPING_VERSION,
    actor: { name: "Admin" },
    target: { label: null },
    context: { ip: null, userAgent: null, path: null, method: null },
    retentionDays: null,
    _sig: null,
    _prevSig: null,
    failureReason: "cas_exhausted",
    dlqAt: new Date(),
  });
}

describe("wipeAuditCollections", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("drops all three audit collections when present", async () => {
    await seed();

    const before = (
      await mongoose.connection
        .db!.listCollections({}, { nameOnly: true })
        .toArray()
    ).map((c) => c.name);
    for (const name of AUDIT_COLLECTIONS) expect(before).toContain(name);

    await wipeAuditCollections();

    const after = (
      await mongoose.connection
        .db!.listCollections({}, { nameOnly: true })
        .toArray()
    ).map((c) => c.name);
    for (const name of AUDIT_COLLECTIONS) expect(after).not.toContain(name);
  });

  it("skips collections that are not present", async () => {
    await expect(wipeAuditCollections()).resolves.toBeUndefined();
  });
});

describe("runWipeCli confirm gate", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.AUDIT_WIPE_CONFIRM;
  });

  it("rejects with AuditWipeRefused when AUDIT_WIPE_CONFIRM is unset", async () => {
    delete process.env.AUDIT_WIPE_CONFIRM;
    await expect(runWipeCli()).rejects.toBeInstanceOf(AuditWipeRefused);
  });

  it("rejects when AUDIT_WIPE_CONFIRM is set to the wrong value", async () => {
    process.env.AUDIT_WIPE_CONFIRM = "nope";
    await expect(runWipeCli()).rejects.toBeInstanceOf(AuditWipeRefused);
  });

  it("leaves collections untouched when the gate refuses", async () => {
    await seed();
    delete process.env.AUDIT_WIPE_CONFIRM;
    await expect(runWipeCli()).rejects.toBeInstanceOf(AuditWipeRefused);
    expect(await AuditLogModel.countDocuments()).toBe(3);
  });

  it("exposes the expected confirm token constant", () => {
    expect(CONFIRM_TOKEN).toBe("I_KNOW_WHAT_I_AM_DOING");
  });
});

describe("production guard", () => {
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    process.env.NODE_ENV = "production";
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.env.NODE_ENV = originalNodeEnv;
    process.env.AUDIT_WIPE_CONFIRM = CONFIRM_TOKEN;
    delete process.env.AUDIT_WIPE_CONFIRM;
  });

  it("refuses wipeAuditCollections in production", async () => {
    await seed();
    await expect(wipeAuditCollections()).rejects.toBeInstanceOf(
      AuditWipeRefused,
    );
    expect(await AuditLogModel.countDocuments()).toBe(3);
  });

  it("refuses runWipeCli in production even with the confirm token set", async () => {
    process.env.AUDIT_WIPE_CONFIRM = CONFIRM_TOKEN;
    await expect(runWipeCli()).rejects.toBeInstanceOf(AuditWipeRefused);
  });
});
