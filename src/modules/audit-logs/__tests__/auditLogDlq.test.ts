import mongoose from "mongoose";
import { describe, expect, it } from "vitest";

import "@/tests/mocks/database.mock";

import { AuditLogDlqModel } from "@/db/models/audit-logs/audit-log-dlq";
import { USER_TYPE } from "@/enums";
import { AuditCategory } from "@/enums/audit.enum";
import { SUBSYSTEM_MAPPING_VERSION } from "@/db/plugins/audit/utils/subsystem";

describe("AuditLogDlqModel schema", () => {
  it("permits null _sig and _prevSig with required failureReason + dlqAt", async () => {
    const doc = await AuditLogDlqModel.create({
      timestamp: new Date(),
      category: AuditCategory.SYSTEM,
      action: "audit.emit.lost",
      status: "failure" as const,
      companyRef: new mongoose.Types.ObjectId(),
      actorId: new mongoose.Types.ObjectId(),
      actorEmail: null,
      actorRole: USER_TYPE.SYSTEM,
      targetType: null,
      targetId: null,
      requestId: null,
      _sig: null,
      _prevSig: null,
      subsystemMappingVersion: SUBSYSTEM_MAPPING_VERSION,
      actor: { name: null },
      target: { label: null },
      context: { ip: null, userAgent: null, path: null, method: null },
      failureReason: "cas_exhausted",
      dlqAt: new Date(),
      retentionDays: null,
    });

    expect(doc._id).toBeDefined();
    expect(doc._sig).toBeNull();
    expect(doc._prevSig).toBeNull();
    expect(doc.failureReason).toBe("cas_exhausted");
    expect(doc.dlqAt).toBeInstanceOf(Date);
  });
});
