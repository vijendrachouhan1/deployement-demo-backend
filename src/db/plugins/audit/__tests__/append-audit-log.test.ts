import mongoose from "mongoose";
import { beforeEach, describe, expect, it, vi } from "vitest";

import "@/tests/mocks/database.mock";
import { sha256 } from "@/db/plugins/audit/utils/sha256";

const HASH_INPUT_SEPARATOR = "\x1f";

import { AuditLogModel } from "@/db/models/audit-logs/audit-log";
import { AuditLogDlqModel } from "@/db/models/audit-logs/audit-log-dlq";
import { ChainHeadModel } from "@/db/models/audit-logs/chain-head";
import { USER_TYPE } from "@/enums";
import { appendAuditLog } from "@/db/plugins/audit/append-audit-log";
import { AuditCategory, AuditStatus } from "@/enums/audit.enum";

function makeSkeleton(overrides: Record<string, unknown> = {}) {
  return {
    category: AuditCategory.ADMIN_ACTION,
    action: "user.update",
    status: AuditStatus.SUCCESS,
    targetType: null,
    targetId: null,
    requestId: null,
    target: { label: null },
    context: { ip: null, userAgent: null, path: null, method: null },
    retentionDays: null,
    ...overrides,
  };
}

function makePrincipal() {
  return {
    _id: new mongoose.Types.ObjectId(),
    companyRef: new mongoose.Types.ObjectId(),
    role: USER_TYPE.ADMIN,
    email: "admin@acme.test",
    name: "Admin Alice",
  };
}

describe("appendAuditLog", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("writes a chain of 100 sequential emits with linear _prevSig", async () => {
    const principal = makePrincipal();
    for (let i = 0; i < 100; i++) {
      await appendAuditLog(
        makeSkeleton({ action: `evt.${i}` }),
        principal,
        null,
        { throwOnFailure: true },
      );
    }

    const rows = await AuditLogModel.find({ companyRef: principal.companyRef })
      .sort({ timestamp: 1, _id: 1 })
      .lean();
    expect(rows.length).toBe(100);
    expect(rows[0]._prevSig).toBe("ROOT");
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i]._prevSig).toBe(rows[i - 1]._sig);
    }

    const head = await ChainHeadModel.findOne({
      _id: principal.companyRef,
    }).lean();
    expect(head?.lastSig).toBe(rows[rows.length - 1]._sig);

    for (const row of rows) {
      expect(typeof row.signedSnapshot).toBe("string");
      expect(row.signedSnapshot!.length).toBeGreaterThan(0);
      expect(
        sha256(row._prevSig + HASH_INPUT_SEPARATOR + row.signedSnapshot),
      ).toBe(row._sig);
    }
  });

  it("falls to DLQ on CAS exhaustion", async () => {
    const principal = makePrincipal();
    const noopUpdate = vi
      .spyOn(ChainHeadModel, "findOneAndUpdate")
      .mockImplementation(
        () => ({ then: (r: (v: unknown) => unknown) => r(null) }) as never,
      );
    void noopUpdate;

    await appendAuditLog(
      makeSkeleton({ action: "evt.cas-exhaust" }),
      principal,
      null,
      { throwOnFailure: false },
    );

    const dlq = await AuditLogDlqModel.find({}).lean();
    expect(dlq.length).toBe(1);
    expect(dlq[0]._sig).toBeNull();
    expect(dlq[0]._prevSig).toBeNull();
    expect(dlq[0].failureReason).toBe("cas_exhausted");
  });

  it("rolls back the chain head and DLQs when the row append fails after CAS (P0)", async () => {
    const principal = makePrincipal();
    vi.spyOn(AuditLogModel, "create").mockRejectedValue(
      new Error("append boom") as never,
    );

    await appendAuditLog(
      makeSkeleton({ action: "evt.append-fail" }),
      principal,
      null,
      { throwOnFailure: false },
    );

    // The CAS shared the append's transaction, so it rolled back too — the head
    // never advanced to a signature with no backing row.
    const head = await ChainHeadModel.findOne({
      _id: principal.companyRef,
    }).lean();
    expect(head).toBeNull();

    // No orphan row; the lost event is captured in the DLQ instead.
    const dlq = await AuditLogDlqModel.find({
      companyRef: principal.companyRef,
    }).lean();
    expect(dlq.length).toBe(1);
    expect(dlq[0].failureReason).toBe("append_failed");

    vi.restoreAllMocks();

    // A later emit chains cleanly from ROOT — no phantom predecessor, so a
    // subsequent verify sees no false tamper break.
    await appendAuditLog(
      makeSkeleton({ action: "evt.after-recovery" }),
      principal,
      null,
      { throwOnFailure: true },
    );
    const rows = await AuditLogModel.find({ companyRef: principal.companyRef })
      .sort({ timestamp: 1, _id: 1 })
      .lean();
    expect(rows.length).toBe(1);
    expect(rows[0]._prevSig).toBe("ROOT");
    const head2 = await ChainHeadModel.findOne({
      _id: principal.companyRef,
    }).lean();
    expect(head2?.lastSig).toBe(rows[0]._sig);
  });

  it("propagates exception when throwOnFailure=true and DB rejects", async () => {
    const principal = makePrincipal();
    vi.spyOn(AuditLogModel, "create").mockRejectedValue(
      new Error("db down") as never,
    );

    await expect(
      appendAuditLog(makeSkeleton(), principal, null, { throwOnFailure: true }),
    ).rejects.toThrow(/db down/);
  });

  it("swallows exception when throwOnFailure=false", async () => {
    const principal = makePrincipal();
    vi.spyOn(AuditLogModel, "create").mockRejectedValue(
      new Error("db down") as never,
    );

    await expect(
      appendAuditLog(makeSkeleton(), principal, null, {
        throwOnFailure: false,
      }),
    ).resolves.toBeUndefined();
  });
});
