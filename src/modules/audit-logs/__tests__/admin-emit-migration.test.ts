import mongoose from "mongoose";
import { describe, expect, it } from "vitest";

import "@/tests/mocks/database.mock";

import { AuditLogModel } from "@/db/models/audit-logs/audit-log";
import { USER_TYPE } from "@/enums";
import { AuditContext } from "@/db/plugins/audit/audit-context";
import { emitAuditLogSync } from "@/modules/audit-logs/helpers/emit.helper";
import { AuditAction, AuditStatus, AuditTargetType } from "@/enums/audit.enum";

describe("emit migration — new field shape under principal-populated context", () => {
  it("persists a row with actorId from principal, targetType=users, status=success", async () => {
    const principal = {
      _id: new mongoose.Types.ObjectId(),
      companyRef: new mongoose.Types.ObjectId(),
      role: USER_TYPE.ADMIN,
      email: "admin@acme.test",
      name: "Admin Alice",
    };

    const targetId = new mongoose.Types.ObjectId().toString();

    await AuditContext.run({ principal, requestId: "req-1" }, async () => {
      await emitAuditLogSync({
        action: AuditAction.USER_STATUS_CHANGED,
        status: AuditStatus.SUCCESS,
        targetType: AuditTargetType.USER,
        targetId,
        changes: [{ field: "status", before: "ACTIVE", after: "INACTIVE" }],
      });
    });

    const rows = await AuditLogModel.find({
      action: AuditAction.USER_STATUS_CHANGED,
    }).lean();
    expect(rows.length).toBe(1);
    const row = rows[0];
    expect(row.actorId.toString()).toBe(principal._id.toString());
    expect(row.companyRef.toString()).toBe(principal.companyRef.toString());
    expect(row.actorEmail).toBe(principal.email);
    expect(row.actorRole).toBe(USER_TYPE.ADMIN);
    expect(row.targetType).toBe(AuditTargetType.USER);
    expect(row.targetId?.toString()).toBe(targetId);
    expect(row.status).toBe(AuditStatus.SUCCESS);
    expect(row.requestId).toBe("req-1");
    expect(row.changes?.[0]).toMatchObject({
      field: "status",
      after: "INACTIVE",
    });
  });

  it("super_admin acting on a company emits with companyRef = targetId", async () => {
    const principal = {
      _id: new mongoose.Types.ObjectId(),
      companyRef: null,
      role: USER_TYPE.SUPER_ADMIN,
      email: "root@platform.test",
      name: "Root",
    };

    const targetCompany = new mongoose.Types.ObjectId();

    await AuditContext.run({ principal }, async () => {
      await emitAuditLogSync({
        action: AuditAction.COMPANY_FORCE_PASSWORD_CHANGE,
        status: AuditStatus.SUCCESS,
        targetType: AuditTargetType.COMPANY,
        targetId: targetCompany,
        metadata: { affectedCount: 42 },
      });
    });

    const rows = await AuditLogModel.find({
      action: AuditAction.COMPANY_FORCE_PASSWORD_CHANGE,
    }).lean();
    expect(rows.length).toBe(1);
    expect(rows[0].companyRef.toString()).toBe(targetCompany.toString());
    expect(rows[0].metadata).toMatchObject({ affectedCount: 42 });
  });
});
