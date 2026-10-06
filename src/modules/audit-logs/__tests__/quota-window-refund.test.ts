import mongoose from "mongoose";
import { describe, expect, it } from "vitest";

import "@/tests/mocks/database.mock";

import { AuditExportQuotaModel } from "@/db/models/audit-logs/audit-export-quota";
import { AuditVerifyQuotaModel } from "@/db/models/audit-logs/audit-verify-quota";
import {
  auditLogsHelper,
  EXPORT_QUOTA_WINDOW_MS,
} from "@/modules/audit-logs/helpers/audit-log.helper";

describe("quota refund targets the charged window (D)", () => {
  it("increment returns the windowStart it charged", async () => {
    const userId = new mongoose.Types.ObjectId().toString();
    const { windowStart } =
      await auditLogsHelper.checkAndIncrementExportQuota(userId);

    const doc = await AuditExportQuotaModel.findById(
      `${userId}:${windowStart}`,
    ).lean();
    expect(doc?.count).toBe(1);

    await auditLogsHelper.decrementExportQuota(userId, windowStart);
    const after = await AuditExportQuotaModel.findById(
      `${userId}:${windowStart}`,
    ).lean();
    expect(after?.count).toBe(0);
  });

  it("refunds the original window even after the boundary rolls over", async () => {
    const userId = new mongoose.Types.ObjectId().toString();
    // Simulate a charge in a PAST window (the request straddled the boundary).
    const chargedWindow =
      Math.floor(Date.now() / EXPORT_QUOTA_WINDOW_MS) * EXPORT_QUOTA_WINDOW_MS -
      EXPORT_QUOTA_WINDOW_MS;
    await AuditExportQuotaModel.create({
      _id: `${userId}:${chargedWindow}`,
      userId: new mongoose.Types.ObjectId(userId),
      count: 1,
      expiresAt: new Date(chargedWindow + 2 * EXPORT_QUOTA_WINDOW_MS),
    });

    // Recomputing "now" would miss this bucket; passing the charged window hits it.
    await auditLogsHelper.decrementExportQuota(userId, chargedWindow);

    const doc = await AuditExportQuotaModel.findById(
      `${userId}:${chargedWindow}`,
    ).lean();
    expect(doc?.count).toBe(0);
  });

  it("verify refund also targets the charged window", async () => {
    const userId = new mongoose.Types.ObjectId().toString();
    const { windowStart } =
      await auditLogsHelper.checkAndIncrementVerifyQuota(userId);

    await auditLogsHelper.decrementVerifyQuota(userId, windowStart);
    const doc = await AuditVerifyQuotaModel.findById(
      `${userId}:${windowStart}`,
    ).lean();
    expect(doc?.count).toBe(0);
  });
});
