import mongoose from "mongoose";
import { describe, expect, it } from "vitest";

import "@/tests/mocks/database.mock";

import { AuditLogModel } from "@/db/models/audit-logs/audit-log";
import { USER_TYPE } from "@/enums";
import { AuditCategory } from "@/enums/audit.enum";
import { SUBSYSTEM_MAPPING_VERSION } from "@/db/plugins/audit/utils/subsystem";

function buildValidAuditLog(
  overrides: Partial<Parameters<typeof AuditLogModel.create>[0]> = {},
) {
  return {
    timestamp: new Date(),
    category: AuditCategory.AUTHENTICATION,
    action: "user.login.success",
    status: "success" as const,
    companyRef: new mongoose.Types.ObjectId(),
    actorId: new mongoose.Types.ObjectId(),
    actorEmail: "alice@example.com",
    actorRole: USER_TYPE.ADMIN,
    targetType: null,
    targetId: null,
    requestId: "req-123",
    _sig: "sig-abc",
    _prevSig: "ROOT",
    subsystemMappingVersion: SUBSYSTEM_MAPPING_VERSION,
    actor: { name: "Alice" },
    target: { label: null },
    context: {
      ip: "127.0.0.1",
      userAgent: "vitest",
      path: "/api/auth/login",
      method: "POST",
    },
    retentionDays: null,
    ...overrides,
  };
}

describe("AuditLogModel schema", () => {
  it("inserts a valid IAuditLog document", async () => {
    const doc = await AuditLogModel.create(buildValidAuditLog());

    expect(doc._id).toBeDefined();
    expect(doc.createdAt).toBeInstanceOf(Date);
    expect(doc.updatedAt).toBeInstanceOf(Date);
    expect(doc.actor.name).toBe("Alice");
    expect(doc.context.ip).toBe("127.0.0.1");
  });

  it("rejects insert when companyRef is missing", async () => {
    const { companyRef: _unused, ...rest } = buildValidAuditLog();
    void _unused;

    await expect(
      AuditLogModel.create(
        rest as unknown as Parameters<typeof AuditLogModel.create>[0],
      ),
    ).rejects.toThrow(/companyRef/);
  });

  it("declares all 7 compound indexes from final-design.md §1", async () => {
    await AuditLogModel.init();
    const indexes = await AuditLogModel.collection.getIndexes();
    const keyShapes = Object.values(indexes).map((idx) => JSON.stringify(idx));

    const expected = [
      [["timestamp", -1]],
      [
        ["companyRef", 1],
        ["timestamp", -1],
      ],
      [
        ["category", 1],
        ["timestamp", -1],
      ],
      [
        ["actorId", 1],
        ["timestamp", -1],
      ],
      [
        ["action", 1],
        ["timestamp", -1],
      ],
      [
        ["targetType", 1],
        ["targetId", 1],
        ["timestamp", -1],
      ],
      [["actorEmail", 1]],
    ];

    for (const idx of expected) {
      expect(keyShapes).toContain(JSON.stringify(idx));
    }
  });
});
