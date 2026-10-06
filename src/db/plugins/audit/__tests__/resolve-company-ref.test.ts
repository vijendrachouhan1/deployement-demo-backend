import mongoose from "mongoose";
import { describe, expect, it } from "vitest";

import "@/tests/mocks/database.mock";

import { User } from "@/db/models/user";
import { USER_TYPE } from "@/enums";
import { resolveCompanyRefForEmit } from "@/db/plugins/audit/resolve-company-ref";
import { AuditTargetType } from "@/enums/audit.enum";
import {
  SYSTEM_SUBSYSTEM_REFS,
  SystemSubsystem,
} from "@/db/plugins/audit/utils/subsystem";

function makePrincipal(
  overrides: Partial<Parameters<typeof resolveCompanyRefForEmit>[1] & {}>,
) {
  return {
    _id: new mongoose.Types.ObjectId(),
    companyRef: new mongoose.Types.ObjectId(),
    role: USER_TYPE.ADMIN,
    email: "admin@acme.test",
    name: "Admin Alice",
    ...overrides,
  };
}

describe("resolveCompanyRefForEmit", () => {
  it("no principal → SYSTEM_SUBSYSTEM_REFS[subsystem]", async () => {
    const ref = await resolveCompanyRefForEmit(
      { targetType: null, targetId: null },
      null,
      SystemSubsystem.CRON,
    );
    expect(ref.equals(SYSTEM_SUBSYSTEM_REFS[SystemSubsystem.CRON])).toBe(true);
  });

  it("no principal + no subsystem → OTHER", async () => {
    const ref = await resolveCompanyRefForEmit(
      { targetType: null, targetId: null },
      null,
      null,
    );
    expect(ref.equals(SYSTEM_SUBSYSTEM_REFS[SystemSubsystem.OTHER])).toBe(true);
  });

  it("super_admin + targetType=company → targetId (C6)", async () => {
    const tenant = new mongoose.Types.ObjectId();
    const principal = makePrincipal({ role: USER_TYPE.SUPER_ADMIN });
    const ref = await resolveCompanyRefForEmit(
      { targetType: AuditTargetType.COMPANY, targetId: tenant },
      principal,
      null,
    );
    expect(ref.equals(tenant)).toBe(true);
  });

  it("super_admin + targetType=user → owning tenant", async () => {
    const tenant = new mongoose.Types.ObjectId();
    const user = await User.create({
      email: "user@acme.test",
      name: { first: "U", last: "ser" },
      companyRef: tenant,
      roles: "user",
    });
    const principal = makePrincipal({ role: USER_TYPE.SUPER_ADMIN });
    const ref = await resolveCompanyRefForEmit(
      { targetType: AuditTargetType.USER, targetId: user._id },
      principal,
      null,
    );
    expect(ref.equals(tenant)).toBe(true);
  });

  it("super_admin + orphan user (no companyRef) → OTHER", async () => {
    const user = await User.create({
      email: "orphan@example.test",
      name: { first: "O", last: "rphan" },
      roles: "user",
    });
    const principal = makePrincipal({ role: USER_TYPE.SUPER_ADMIN });
    const ref = await resolveCompanyRefForEmit(
      { targetType: AuditTargetType.USER, targetId: user._id },
      principal,
      null,
    );
    expect(ref.equals(SYSTEM_SUBSYSTEM_REFS[SystemSubsystem.OTHER])).toBe(true);
  });

  it("admin → principal.companyRef", async () => {
    const principal = makePrincipal({ role: USER_TYPE.ADMIN });
    const ref = await resolveCompanyRefForEmit(
      {
        targetType: AuditTargetType.USER,
        targetId: new mongoose.Types.ObjectId(),
      },
      principal,
      null,
    );
    expect(ref.equals(principal.companyRef!)).toBe(true);
  });
});
