import mongoose from "mongoose";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";

import "@/tests/mocks/database.mock";

import { createApp } from "@/app";
import { AuditLogModel } from "@/db/models/audit-logs/audit-log";
import { User } from "@/db/models/user";
import { STATUS } from "@/enums";
import { createAdminSession } from "@/tests/utils/auth";

async function waitForRow(filter: object, timeoutMs = 3000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const row = await AuditLogModel.findOne(filter).lean();
    if (row) return row;
    await new Promise((r) => setTimeout(r, 50));
  }
  return null;
}

describe("Admin user status-change audit emit", () => {
  const app = createApp();

  beforeEach(async () => {
    await AuditLogModel.deleteMany({});
  });

  it("emits success row when admin flips a user's status", async () => {
    const session = await createAdminSession();
    const targetUser = await User.create({
      email: "target@a.test",
      name: { first: "Target", last: "User" },
      externalUserId: new mongoose.Types.ObjectId().toString(),
      hasPassword: true,
      roles: "user",
      status: STATUS.ACTIVE,
      companyRef: session.company._id,
    });

    const res = await request(app)
      .put(`/api/admin/user/status/${targetUser._id.toString()}`)
      .set("Cookie", session.cookie)
      .send({ status: STATUS.INACTIVE });

    expect(res.status).toBe(200);

    // The status change is audited generically by the DB plugin as a
    // record-change row (action "<model>.updated"), not a bespoke
    // "user.status.changed" emit — the field change is carried in `changes`.
    const row = await waitForRow({ action: "user.updated" });
    expect(row).toBeTruthy();
    expect(row?.status).toBe("success");
    expect(row?.targetType).toBe("user");
    expect(row?.targetId?.toString()).toBe(targetUser._id.toString());
    expect(row?.actorId.toString()).toBe(session.user._id.toString());
    expect(row?.companyRef.toString()).toBe(session.company._id.toString());
    expect(row?.changes?.[0]).toMatchObject({
      field: "status",
      after: STATUS.INACTIVE,
    });
  });
});
