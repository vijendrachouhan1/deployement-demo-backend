import mongoose from "mongoose";
import { describe, expect, it } from "vitest";

import "@/tests/mocks/database.mock";

import { AuditLogModel } from "@/db/models/audit-logs/audit-log";
import { auditPlugin } from "@/db/plugins/audit/audit.plugin";
import { AuditContext } from "@/db/plugins/audit/audit-context";
import { drainPendingEmits } from "@/modules/audit-logs/helpers/emit.helper";
import { USER_TYPE } from "@/enums";

const BULK_AUDIT_LIMIT = 1000;

const BulkWidgetSchema = new mongoose.Schema({
  name: String,
  batch: String,
  apiToken: String,
});
BulkWidgetSchema.plugin(auditPlugin, {
  model: "BulkWidget",
  labelField: "name",
});
const BulkWidgetModel =
  (mongoose.models.BulkWidget as mongoose.Model<{
    name: string;
    batch: string;
    apiToken?: string;
  }>) ?? mongoose.model("BulkWidget", BulkWidgetSchema);

function makePrincipal() {
  return {
    _id: new mongoose.Types.ObjectId(),
    companyRef: new mongoose.Types.ObjectId(),
    role: USER_TYPE.ADMIN,
    email: "admin@acme.test",
    name: "Admin Alice",
  };
}

async function seed(count: number, batch: string) {
  const docs = Array.from({ length: count }, (_, i) => ({
    name: `w-${i}`,
    batch,
  }));
  await BulkWidgetModel.insertMany(docs);
}

describe("audit plugin bulk updateMany summary", () => {
  it("emits one summary entry (not per-record) when the match exceeds the limit", async () => {
    const principal = makePrincipal();
    await seed(BULK_AUDIT_LIMIT + 1, "big");

    await AuditContext.run({ principal }, async () => {
      await BulkWidgetModel.updateMany(
        { batch: "big" },
        { $set: { name: "renamed" } },
      ).exec();
    });
    await drainPendingEmits();

    const summaries = await AuditLogModel.find({
      companyRef: principal.companyRef,
      action: "BulkWidget.bulk_updated",
    }).lean();
    expect(summaries).toHaveLength(1);
    expect(summaries[0]?.metadata?.bulk).toMatchObject({
      op: "updateMany",
      matchedCount: BULK_AUDIT_LIMIT + 1,
    });

    const perRecord = await AuditLogModel.countDocuments({
      companyRef: principal.companyRef,
      action: "BulkWidget.updated",
    });
    expect(perRecord).toBe(0);
  });

  it("still emits per-record updates when the match is within the limit", async () => {
    const principal = makePrincipal();
    await seed(3, "small");

    await AuditContext.run({ principal }, async () => {
      await BulkWidgetModel.updateMany(
        { batch: "small" },
        { $set: { name: "renamed" } },
      ).exec();
    });
    await drainPendingEmits();

    const perRecord = await AuditLogModel.countDocuments({
      companyRef: principal.companyRef,
      action: "BulkWidget.updated",
    });
    expect(perRecord).toBe(3);
    const summary = await AuditLogModel.findOne({
      companyRef: principal.companyRef,
      action: "BulkWidget.bulk_updated",
    }).lean();
    expect(summary).toBeNull();
  });

  it("scrubs sensitive keys from the summary's filter and update payload", async () => {
    const principal = makePrincipal();
    await seed(BULK_AUDIT_LIMIT + 1, "secrets");

    await AuditContext.run({ principal }, async () => {
      await BulkWidgetModel.updateMany(
        { batch: "secrets" },
        { $set: { apiToken: "should-not-be-logged" } },
      ).exec();
    });
    await drainPendingEmits();

    const summary = await AuditLogModel.findOne({
      companyRef: principal.companyRef,
      action: "BulkWidget.bulk_updated",
    }).lean();
    const serialized = JSON.stringify(summary?.metadata?.bulk);
    expect(serialized).not.toContain("should-not-be-logged");
    expect(serialized).not.toContain("apiToken");
  });
});
