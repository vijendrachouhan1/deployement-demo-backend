import mongoose from "mongoose";
import { describe, expect, it } from "vitest";

import "@/tests/mocks/database.mock";

import {
  AuditLogModel,
  type IAuditLog,
} from "@/db/models/audit-logs/audit-log";
import { USER_TYPE } from "@/enums";
import { appendAuditLog } from "@/db/plugins/audit/append-audit-log";
import { recomputeSignedBytes } from "@/db/plugins/audit/recompute-signed-bytes";
import { sha256 } from "@/db/plugins/audit/utils/sha256";
import { AuditCategory, AuditStatus } from "@/enums/audit.enum";

const HASH_INPUT_SEPARATOR = "\x1f";

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

async function emitOne(overrides: Record<string, unknown> = {}) {
  const principal = makePrincipal();
  await appendAuditLog(makeSkeleton(overrides), principal, null, {
    throwOnFailure: true,
  });
  const row = await AuditLogModel.findOne({
    companyRef: principal.companyRef,
  }).lean<IAuditLog>();
  if (!row) throw new Error("expected emitted row");
  return row;
}

describe("recomputeSignedBytes", () => {
  it("round-trips: recompute equals the stored signedSnapshot", async () => {
    const row = await emitOne({
      action: "user.profile.update",
      metadata: { plan: "pro", seats: 5 },
      changes: [{ field: "name", before: "A", after: "B" }],
    });

    expect(recomputeSignedBytes(row)).toBe(row.signedSnapshot);
    expect(
      sha256(row._prevSig + HASH_INPUT_SEPARATOR + recomputeSignedBytes(row)),
    ).toBe(row._sig);
  });

  it("recomputes correctly for a legacy row lacking signedSnapshot (and ignores __v)", async () => {
    const row = await emitOne({ action: "legacy.evt" });
    const expected = row.signedSnapshot;

    const legacy = { ...row, __v: 0 } as IAuditLog & { __v: number };
    delete (legacy as { signedSnapshot?: string }).signedSnapshot;

    expect(legacy.signedSnapshot).toBeUndefined();
    expect(recomputeSignedBytes(legacy)).toBe(expected);
  });

  it("is deterministic across repeated calls", async () => {
    const row = await emitOne({ action: "determinism.evt" });
    expect(recomputeSignedBytes(row)).toBe(recomputeSignedBytes(row));
  });
});
