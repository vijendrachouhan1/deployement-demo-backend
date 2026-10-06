import mongoose from "mongoose";
import { describe, expect, it } from "vitest";

import "@/tests/mocks/database.mock";

import { AuditLogModel } from "@/db/models/audit-logs/audit-log";
import { ChainHeadModel } from "@/db/models/audit-logs/chain-head";
import { USER_TYPE } from "@/enums";
import { appendAuditLog } from "@/db/plugins/audit/append-audit-log";
import { InMemoryAuditProvider } from "@/modules/audit-logs/__tests__/fixtures/in-memory.provider";
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

describe("appendAuditLog with injected provider", () => {
  it("routes append + head writes to the injected provider, leaving Mongo untouched", async () => {
    const provider = new InMemoryAuditProvider();
    const principal = makePrincipal();

    for (let i = 0; i < 10; i++) {
      await appendAuditLog(
        makeSkeleton({ action: `evt.${i}` }),
        principal,
        null,
        { throwOnFailure: true },
        provider,
      );
    }

    expect(provider.rows.length).toBe(10);
    expect(provider.rows[0]._prevSig).toBe("ROOT");
    for (let i = 1; i < provider.rows.length; i++) {
      expect(provider.rows[i]._prevSig).toBe(provider.rows[i - 1]._sig);
    }
    const head = provider.heads.get(principal.companyRef.toString());
    expect(head?.lastSig).toBe(provider.rows[provider.rows.length - 1]._sig);

    expect(await AuditLogModel.countDocuments()).toBe(0);
    expect(await ChainHeadModel.countDocuments()).toBe(0);
  });

  it("writes to the injected provider's DLQ when CAS exhausts", async () => {
    const provider = new InMemoryAuditProvider();
    const principal = makePrincipal();

    provider.casUpdateChainHead = async () => ({
      swapped: false,
      reason: "stale_prevsig",
    });

    await appendAuditLog(
      makeSkeleton({ action: "evt.exhaust" }),
      principal,
      null,
      { throwOnFailure: false },
      provider,
    );

    expect(provider.dlq.length).toBe(1);
    expect(provider.dlq[0]._sig).toBeNull();
    expect(provider.dlq[0].failureReason).toBe("cas_exhausted");
  });
});
