import mongoose from "mongoose";
import { describe, expect, it } from "vitest";

import "@/tests/mocks/database.mock";

import { AuditLogModel } from "@/db/models/audit-logs/audit-log";
import { auditPlugin } from "@/db/plugins/audit/audit.plugin";
import { AuditContext } from "@/db/plugins/audit/audit-context";
import { USER_TYPE } from "@/enums";

const WidgetSchema = new mongoose.Schema({
  name: String,
  code: { type: String, unique: true },
});
WidgetSchema.plugin(auditPlugin, { model: "Widget", labelField: "name" });
const WidgetModel =
  (mongoose.models.Widget as mongoose.Model<{ name: string; code: string }>) ??
  mongoose.model("Widget", WidgetSchema);

function makePrincipal() {
  return {
    _id: new mongoose.Types.ObjectId(),
    companyRef: new mongoose.Types.ObjectId(),
    role: USER_TYPE.ADMIN,
    email: "admin@acme.test",
    name: "Admin Alice",
  };
}

const waitFor = async <T>(check: () => Promise<T> | T, timeoutMs = 2000) => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const value = await check();
    if (value) return value;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error("waitFor timed out");
};

describe("audit plugin upsert-insert", () => {
  it("emits a create entry when findOneAndUpdate upserts a new doc", async () => {
    const principal = makePrincipal();

    await AuditContext.run({ principal }, async () => {
      await WidgetModel.findOneAndUpdate(
        { code: "foa-new" },
        { $set: { name: "Made by upsert" } },
        { upsert: true },
      ).exec();
    });

    const row = await waitFor(() =>
      AuditLogModel.findOne({
        companyRef: principal.companyRef,
        action: "Widget.created",
      }).lean(),
    );
    expect(row?.action).toBe("Widget.created");
  });

  it("emits a create entry when updateOne upserts a new doc", async () => {
    const principal = makePrincipal();

    await AuditContext.run({ principal }, async () => {
      await WidgetModel.updateOne(
        { code: "uo-new" },
        { $set: { name: "Upserted via updateOne" } },
        { upsert: true },
      ).exec();
    });

    const row = await waitFor(() =>
      AuditLogModel.findOne({
        companyRef: principal.companyRef,
        action: "Widget.created",
      }).lean(),
    );
    expect(row?.action).toBe("Widget.created");
  });

  it("emits an update (not create) when the upsert matches an existing doc", async () => {
    const principal = makePrincipal();
    await WidgetModel.create({ code: "existing", name: "Original" });

    await AuditContext.run({ principal }, async () => {
      await WidgetModel.findOneAndUpdate(
        { code: "existing" },
        { $set: { name: "Renamed" } },
        { upsert: true },
      ).exec();
    });

    const created = await waitFor(() =>
      AuditLogModel.findOne({
        companyRef: principal.companyRef,
        action: "Widget.updated",
      }).lean(),
    );
    expect(created?.action).toBe("Widget.updated");
    const wrongCreate = await AuditLogModel.findOne({
      companyRef: principal.companyRef,
      action: "Widget.created",
    }).lean();
    expect(wrongCreate).toBeNull();
  });
});
