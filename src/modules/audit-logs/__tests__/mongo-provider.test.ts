import mongoose from "mongoose";
import { beforeEach, describe, expect, it, vi } from "vitest";

import "@/tests/mocks/database.mock";

import { AuditLogModel } from "@/db/models/audit-logs/audit-log";
import { AuditLogDlqModel } from "@/db/models/audit-logs/audit-log-dlq";
import { ChainHeadModel } from "@/db/models/audit-logs/chain-head";
import { USER_TYPE } from "@/enums";
import {
  MongoAuditProvider,
  mongoAuditProvider,
} from "@/providers/audit-logs/mongo.provider";
import type {
  IAuditLogRowInput,
  IAuditStorageProvider,
  IDlqRowInput,
} from "@/providers/audit-logs/utils/audit-provider.types";
import type { IAuditEventBase } from "@/db/plugins/audit/utils/audit-event.types";
import { AuditCategory, AuditStatus } from "@/enums/audit.enum";
import {
  SUBSYSTEM_MAPPING_VERSION,
  SystemSubsystem,
} from "@/db/plugins/audit/utils/subsystem";

function makeBase(overrides: Partial<IAuditEventBase> = {}): IAuditEventBase {
  return {
    timestamp: new Date(),
    category: AuditCategory.ADMIN_ACTION,
    action: "user.update",
    status: AuditStatus.SUCCESS,
    companyRef: new mongoose.Types.ObjectId(),
    actorId: new mongoose.Types.ObjectId(),
    actorEmail: "admin@acme.test",
    actorRole: USER_TYPE.ADMIN,
    targetType: null,
    targetId: null,
    requestId: null,
    subsystemMappingVersion: SUBSYSTEM_MAPPING_VERSION,
    actor: { name: "Admin" },
    target: { label: null },
    context: { ip: null, userAgent: null, path: null, method: null },
    retentionDays: null,
    ...overrides,
  };
}

function makeRow(
  overrides: Partial<IAuditLogRowInput> = {},
): IAuditLogRowInput {
  return {
    ...makeBase(),
    _sig: "sig",
    _prevSig: "ROOT",
    signedSnapshot: "{}",
    ...overrides,
  };
}

describe("MongoAuditProvider", () => {
  beforeEach(() => {
    // database.mock clears collections between tests
  });

  it("is assignable to IAuditStorageProvider (covariance)", () => {
    const p: IAuditStorageProvider = new MongoAuditProvider();
    expect(typeof p.appendRow).toBe("function");
    expect(typeof p.getChainHead).toBe("function");
    expect(typeof p.casUpdateChainHead).toBe("function");
    expect(typeof p.writeDlq).toBe("function");
  });

  it("appendRow persists an audit log row", async () => {
    const row = makeRow({ action: "evt.append" });
    await mongoAuditProvider.appendRow(row);

    const persisted = await AuditLogModel.find({ action: "evt.append" }).lean();
    expect(persisted.length).toBe(1);
    expect(persisted[0]._sig).toBe("sig");
  });

  it("getChainHead returns null when no head exists", async () => {
    const head = await mongoAuditProvider.getChainHead(
      new mongoose.Types.ObjectId(),
    );
    expect(head).toBeNull();
  });

  it("casUpdateChainHead upserts on ROOT and then swaps on subsequent sig", async () => {
    const chainId = new mongoose.Types.ObjectId();

    const first = await mongoAuditProvider.casUpdateChainHead(
      chainId,
      "ROOT",
      "sig-a",
      null,
    );
    expect(first.swapped).toBe(true);

    const head1 = await mongoAuditProvider.getChainHead(chainId);
    expect(head1?.lastSig).toBe("sig-a");

    const second = await mongoAuditProvider.casUpdateChainHead(
      chainId,
      "sig-a",
      "sig-b",
      null,
    );
    expect(second.swapped).toBe(true);

    const head2 = await mongoAuditProvider.getChainHead(chainId);
    expect(head2?.lastSig).toBe("sig-b");
  });

  it("casUpdateChainHead returns stale_prevsig on mismatched expected", async () => {
    const chainId = new mongoose.Types.ObjectId();
    await mongoAuditProvider.casUpdateChainHead(chainId, "ROOT", "sig-a", null);

    const stale = await mongoAuditProvider.casUpdateChainHead(
      chainId,
      "WRONG",
      "sig-z",
      null,
    );
    expect(stale.swapped).toBe(false);
    expect(stale.reason).toBe("stale_prevsig");

    const head = await ChainHeadModel.findOne({ _id: chainId }).lean();
    expect(head?.lastSig).toBe("sig-a");
  });

  it("casUpdateChainHead sets subsystem only on insert", async () => {
    const chainId = new mongoose.Types.ObjectId();
    await mongoAuditProvider.casUpdateChainHead(
      chainId,
      "ROOT",
      "sig-a",
      SystemSubsystem.CRON,
    );

    const head = await ChainHeadModel.findOne({ _id: chainId }).lean();
    expect(head?.subsystem).toBe(SystemSubsystem.CRON);

    await mongoAuditProvider.casUpdateChainHead(
      chainId,
      "sig-a",
      "sig-b",
      null,
    );
    const headAfter = await ChainHeadModel.findOne({ _id: chainId }).lean();
    expect(headAfter?.subsystem).toBe(SystemSubsystem.CRON);
  });

  it("casUpdateChainHead maps Mongo duplicate-key (11000) to head_missing", async () => {
    const chainId = new mongoose.Types.ObjectId();
    vi.spyOn(ChainHeadModel, "findOneAndUpdate").mockRejectedValueOnce(
      Object.assign(new Error("E11000 duplicate key"), {
        code: 11000,
      }) as never,
    );

    const result = await mongoAuditProvider.casUpdateChainHead(
      chainId,
      "ROOT",
      "sig-a",
      null,
    );
    expect(result.swapped).toBe(false);
    expect(result.reason).toBe("head_missing");
  });

  it("casUpdateChainHead rethrows non-11000 driver errors", async () => {
    const chainId = new mongoose.Types.ObjectId();
    vi.spyOn(ChainHeadModel, "findOneAndUpdate").mockRejectedValueOnce(
      new Error("connection reset") as never,
    );

    await expect(
      mongoAuditProvider.casUpdateChainHead(chainId, "ROOT", "sig-a", null),
    ).rejects.toThrow(/connection reset/);
  });

  it("writeDlq persists a DLQ row with null sigs and the supplied reason", async () => {
    const row: IDlqRowInput = makeBase({ action: "evt.dlq" });
    await mongoAuditProvider.writeDlq(row, "cas_exhausted");

    const persisted = await AuditLogDlqModel.find({ action: "evt.dlq" }).lean();
    expect(persisted.length).toBe(1);
    expect(persisted[0]._sig).toBeNull();
    expect(persisted[0]._prevSig).toBeNull();
    expect(persisted[0].failureReason).toBe("cas_exhausted");
  });
});
