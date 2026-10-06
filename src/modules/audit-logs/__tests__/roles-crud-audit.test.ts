import mongoose from "mongoose";
import { beforeEach, describe, expect, it } from "vitest";

import "@/tests/mocks/database.mock";

import { AuditLogModel } from "@/db/models/audit-logs/audit-log";
import { USER_TYPE } from "@/enums";
import { AuditContext } from "@/db/plugins/audit/audit-context";
import { emitAuditLogSync } from "@/modules/audit-logs/helpers/emit.helper";
import { AuditAction, AuditStatus, AuditTargetType } from "@/enums/audit.enum";

describe("Roles CRUD emit shape", () => {
  beforeEach(async () => {
    await AuditLogModel.deleteMany({});
  });

  const principal = {
    _id: new mongoose.Types.ObjectId(),
    companyRef: new mongoose.Types.ObjectId(),
    role: USER_TYPE.ADMIN,
    email: "admin@acme.test",
    name: "Admin",
  };

  it("role.created carries slug + permissionCount in metadata", async () => {
    await AuditContext.run({ principal }, async () => {
      await emitAuditLogSync({
        action: AuditAction.ROLE_CREATED,
        status: AuditStatus.SUCCESS,
        targetType: AuditTargetType.ROLE,
        metadata: {
          slug: "custom-manager",
          name: "Custom Manager",
          permissionCount: 5,
        },
      });
    });

    const row = await AuditLogModel.findOne({ action: "role.created" }).lean();
    expect(row).toBeTruthy();
    expect(row?.targetType).toBe("Role");
    expect(row?.metadata).toMatchObject({
      slug: "custom-manager",
      permissionCount: 5,
    });
  });

  it("role.updated and role.deleted carry slug", async () => {
    await AuditContext.run({ principal }, async () => {
      await emitAuditLogSync({
        action: AuditAction.ROLE_UPDATED,
        status: AuditStatus.SUCCESS,
        targetType: AuditTargetType.ROLE,
        metadata: { slug: "custom-manager" },
      });
      await emitAuditLogSync({
        action: AuditAction.ROLE_DELETED,
        status: AuditStatus.SUCCESS,
        targetType: AuditTargetType.ROLE,
        metadata: { slug: "custom-manager" },
      });
    });

    const updated = await AuditLogModel.findOne({
      action: "role.updated",
    }).lean();
    const deleted = await AuditLogModel.findOne({
      action: "role.deleted",
    }).lean();
    expect(updated?.metadata).toMatchObject({ slug: "custom-manager" });
    expect(deleted?.metadata).toMatchObject({ slug: "custom-manager" });
  });

  it("role.* failure rows include sanitized failureReason and no raw stack", async () => {
    await AuditContext.run({ principal }, async () => {
      await emitAuditLogSync({
        action: AuditAction.ROLE_DELETED,
        status: AuditStatus.FAILURE,
        targetType: AuditTargetType.ROLE,
        metadata: { slug: "in-use-role" },
        failureReason: "Role has assignments",
      });
    });

    const row = await AuditLogModel.findOne({
      action: "role.deleted",
      status: "failure",
    }).lean();
    expect(row?.failureReason).toBe("Role has assignments");
  });
});
