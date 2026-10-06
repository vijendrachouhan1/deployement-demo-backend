import mongoose from "mongoose";

import { connectDB, disconnectDB } from "@/db";
import { Company } from "@/db/models/company";
import { User } from "@/db/models/user";
import { USER_TYPE } from "@/enums";
import {
  AuditContext,
  runWithSubsystem,
} from "@/db/plugins/audit/audit-context";
import { emitAuditLogSync } from "@/modules/audit-logs/helpers/emit.helper";
import type { IAuditEventInput } from "@/db/plugins/audit/utils/audit-event.types";
import type { IAuditPrincipal } from "@/db/plugins/audit/utils/audit.types";
import { AuditCategory } from "@/enums/audit.enum";
import { SystemSubsystem } from "@/db/plugins/audit/utils/subsystem";

async function findSeedPrincipal(): Promise<{
  principal: IAuditPrincipal;
  companyId: mongoose.Types.ObjectId;
}> {
  const superAdmin = await User.findOne({
    roles: USER_TYPE.SUPER_ADMIN,
  }).lean();
  if (!superAdmin)
    throw new Error("No super-admin user found. Create one first.");

  const company = await Company.findOne().lean();
  if (!company) throw new Error("No company found. Create one first.");

  return {
    principal: {
      _id: superAdmin._id as mongoose.Types.ObjectId,
      companyRef: company._id as mongoose.Types.ObjectId,
      role: USER_TYPE.SUPER_ADMIN,
      email: superAdmin.email,
      name: superAdmin.name
        ? `${superAdmin.name.first} ${superAdmin.name.last}`
        : "Super Admin",
    },
    companyId: company._id as mongoose.Types.ObjectId,
  };
}

const SEED_EVENTS = [
  {
    action: "user.login.success",
    status: "success" as const,
    category: AuditCategory.AUTHENTICATION,
    targetType: "session",
    context: { method: "POST" },
  },
  {
    action: "user.login.failure",
    status: "failure" as const,
    category: AuditCategory.AUTHENTICATION,
    targetType: "session",
    failureReason: "Invalid credentials — password mismatch",
    context: { method: "POST" },
  },
  {
    action: "user.logout",
    status: "success" as const,
    category: AuditCategory.AUTHENTICATION,
    targetType: "session",
    context: { method: "POST" },
  },
  {
    action: "user.login.mfa_required",
    status: "success" as const,
    category: AuditCategory.AUTHENTICATION,
    targetType: "session",
    metadata: { mfaMethod: "totp", challengeId: "ch_abc123" },
    context: { method: "POST" },
  },
  {
    action: "user.role.update",
    status: "success" as const,
    category: AuditCategory.ADMIN_ACTION,
    targetType: "user",
    changes: [{ field: "roles", before: "user", after: "admin" }],
    target: { label: "Jane Smith" },
    context: { method: "PUT" },
  },
  {
    action: "user.role.update",
    status: "failure" as const,
    category: AuditCategory.ADMIN_ACTION,
    targetType: "user",
    failureReason: "Cannot promote: user account is inactive",
    changes: [{ field: "roles", before: "user", after: "admin" }],
    target: { label: "Deactivated User" },
    context: { method: "PUT" },
  },
  {
    action: "user.status.update",
    status: "success" as const,
    category: AuditCategory.ADMIN_ACTION,
    targetType: "user",
    changes: [{ field: "status", before: "ACTIVE", after: "INACTIVE" }],
    target: { label: "Bob Wilson" },
    context: { method: "PATCH" },
  },
  {
    action: "company.status.update",
    status: "success" as const,
    category: AuditCategory.TENANT,
    targetType: "company",
    changes: [{ field: "companyStatus", before: "ACTIVE", after: "INACTIVE" }],
    target: { label: "Acme Corp" },
    context: { method: "PATCH" },
  },
  {
    action: "company.settings.update",
    status: "success" as const,
    category: AuditCategory.TENANT,
    targetType: "company",
    changes: [
      { field: "enablePasswordRotation", before: false, after: true },
      { field: "passwordValidityDays", before: null, after: 90 },
    ],
    target: { label: "Acme Corp" },
    metadata: { source: "admin-panel", section: "security-settings" },
    context: { method: "PUT" },
  },
  {
    action: "role.permission.update",
    status: "success" as const,
    category: AuditCategory.RBAC,
    targetType: "role",
    changes: [
      {
        field: "permissions",
        before: ["dashboard:view", "teams:view"],
        after: ["dashboard:view", "teams:view", "audit-logs:view"],
      },
    ],
    target: { label: "Editor Role" },
    context: { method: "PUT" },
  },
  {
    action: "role.create",
    status: "success" as const,
    category: AuditCategory.RBAC,
    targetType: "role",
    metadata: {
      roleName: "Auditor",
      permissions: ["audit-logs:view", "dashboard:view"],
    },
    target: { label: "Auditor" },
    context: { method: "POST" },
  },
  {
    action: "role.delete",
    status: "failure" as const,
    category: AuditCategory.RBAC,
    targetType: "role",
    failureReason: "Cannot delete role: 3 users still assigned",
    target: { label: "Legacy Viewer" },
    context: { method: "DELETE" },
  },
  {
    action: "user.password.change",
    status: "success" as const,
    category: AuditCategory.ADMIN_ACTION,
    targetType: "user",
    changes: [
      { field: "password", before: "hashed_old_pw", after: "hashed_new_pw" },
    ],
    target: { label: "Alice Johnson" },
    context: { method: "PUT" },
  },
  {
    action: "user.invite.send",
    status: "success" as const,
    category: AuditCategory.ADMIN_ACTION,
    targetType: "user",
    metadata: {
      invitedEmail: "new.hire@acme.com",
      expiresIn: "7d",
      role: "user",
    },
    context: { method: "POST" },
  },
  {
    action: "user.invite.send",
    status: "failure" as const,
    category: AuditCategory.ADMIN_ACTION,
    targetType: "user",
    failureReason: "Email already registered",
    metadata: { invitedEmail: "existing@acme.com" },
    context: { method: "POST" },
  },
  {
    action: "migration.schema.apply",
    status: "success" as const,
    category: AuditCategory.SYSTEM,
    targetType: null,
    metadata: {
      migrationName: "add-audit-logs-indexes",
      version: "1.4.0",
      collectionsAffected: ["audit_logs", "chain_heads", "audit_logs_dlq"],
    },
    context: { method: null },
  },
  {
    action: "cron.cleanup.run",
    status: "success" as const,
    category: AuditCategory.SYSTEM,
    targetType: null,
    metadata: {
      job: "expired-invites-cleanup",
      rowsDeleted: 12,
      durationMs: 340,
    },
    context: { method: null },
  },
  {
    action: "audit.chain.verify",
    status: "success" as const,
    category: AuditCategory.AUDIT_META,
    targetType: "chain",
    metadata: {
      chainId: "company-abc",
      rowsVerified: 1024,
      gaps: 0,
      durationMs: 2100,
    },
    context: { method: null },
  },
  {
    action: "audit.export.request",
    status: "success" as const,
    category: AuditCategory.AUDIT_META,
    targetType: "export",
    metadata: {
      format: "csv",
      dateRange: { from: "2026-01-01", to: "2026-05-01" },
      rowCount: 5430,
    },
    context: { method: "POST" },
  },
  {
    action: "company.create",
    status: "success" as const,
    category: AuditCategory.TENANT,
    targetType: "company",
    metadata: {
      companyName: "NewStartup Inc",
      plan: "starter",
      tokenSecret: "sk_live_abc123_should_be_redacted",
    },
    target: { label: "NewStartup Inc" },
    context: { method: "POST" },
  },
];

async function seed() {
  await connectDB();
  console.log("[audit:seed] Connected to database");

  const { principal, companyId } = await findSeedPrincipal();
  console.log(
    `[audit:seed] Using principal: ${principal.email} (${principal.role})`,
  );
  console.log(`[audit:seed] Target company: ${companyId}`);
  console.log(
    `[audit:seed] Seeding ${SEED_EVENTS.length} audit log entries...`,
  );

  let succeeded = 0;
  let failed = 0;

  for (const event of SEED_EVENTS) {
    try {
      const subsystem =
        event.category === AuditCategory.SYSTEM
          ? SystemSubsystem.CRON
          : SystemSubsystem.OTHER;

      await runWithSubsystem(subsystem, () =>
        AuditContext.run(
          {
            requestId: crypto.randomUUID(),
            ip: "127.0.0.1",
            path: `/api/seed${event.context?.method ? "" : "/system"}`,
            userAgent: "audit-seed-script/1.0",
            principal,
          },
          () =>
            emitAuditLogSync({
              ...event,
              targetId: event.targetType ? companyId : undefined,
            } as IAuditEventInput),
        ),
      );
      succeeded++;
      process.stdout.write(".");
    } catch (err) {
      failed++;
      console.error(
        `\n[audit:seed] Failed to emit "${event.action}":`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  console.log(`\n[audit:seed] Done. ${succeeded} succeeded, ${failed} failed.`);

  await disconnectDB();
}

seed().then(
  () => process.exit(0),
  (err) => {
    console.error("[audit:seed] Fatal error:", err);
    process.exit(1);
  },
);
