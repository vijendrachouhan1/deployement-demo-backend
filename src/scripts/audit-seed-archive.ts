import crypto from "crypto";

import mongoose from "mongoose";

import { connectDB, disconnectDB } from "@/db";
import type { IAuditLog } from "@/db/models/audit-logs/audit-log";
import { USER_TYPE } from "@/enums";
import envConfig from "@/config/env";
import {
  ROOT_SIG,
  HASH_INPUT_SEPARATOR,
} from "@/db/plugins/audit/utils/chain.constant";
import { deterministicJson } from "@/db/plugins/audit/utils/deterministic-json";
import { mongoAuditProvider } from "@/providers/audit-logs/mongo.provider";
import { sha256 } from "@/db/plugins/audit/utils/sha256";
import { recomputeSignedBytes } from "@/db/plugins/audit/recompute-signed-bytes";
import type { IAuditEventBase } from "@/db/plugins/audit/utils/audit-event.types";
import { AuditCategory, AuditStatus } from "@/enums/audit.enum";
import { SUBSYSTEM_MAPPING_VERSION } from "@/db/plugins/audit/utils/subsystem";

/**
 * Dev-only: seed a FRESH test tenant with chain-valid audit rows old enough
 * for the retention sweep to archive (timestamps > AUDIT_HOT_WINDOW_DAYS ago),
 * plus a few current rows so the tenant spans hot + cold after a sweep.
 *
 * The public emit path stamps `timestamp: new Date()` inside the signed
 * payload, so backdated rows must be built through the same signing machinery
 * with an explicit timestamp. Every row is verified against
 * `recomputeSignedBytes` before AND after insert — drift from the emit
 * lockstep contract aborts the script instead of seeding false-tamper rows.
 */

const BACKDATED_ROWS = 30;
const HOT_ROWS = 3;
const BACKDATE_DAYS = envConfig.AUDIT_HOT_WINDOW_DAYS + 10;

const ACTOR_ID = new mongoose.Types.ObjectId();
const ACTOR_EMAIL = "archive-seed@test.local";
const ACTOR_NAME = "Archive Seed Script";

interface ISeedTemplate {
  category: AuditCategory;
  action: string;
  status: AuditStatus;
  targetType: string | null;
  targetLabel: string | null;
  method: string | null;
  metadata?: Record<string, unknown>;
  changes?: IAuditLog["changes"];
  failureReason?: string;
}

const TEMPLATES: ISeedTemplate[] = [
  {
    category: AuditCategory.AUTHENTICATION,
    action: "user.login.success",
    status: AuditStatus.SUCCESS,
    targetType: "session",
    targetLabel: null,
    method: "POST",
  },
  {
    category: AuditCategory.AUTHENTICATION,
    action: "user.login.failure",
    status: AuditStatus.FAILURE,
    targetType: "session",
    targetLabel: null,
    method: "POST",
    failureReason: "Invalid credentials — password mismatch",
  },
  {
    category: AuditCategory.AUTHENTICATION,
    action: "user.logout",
    status: AuditStatus.SUCCESS,
    targetType: "session",
    targetLabel: null,
    method: "POST",
  },
  {
    category: AuditCategory.ADMIN_ACTION,
    action: "user.role.update",
    status: AuditStatus.SUCCESS,
    targetType: "user",
    targetLabel: "Jane Smith",
    method: "PUT",
    changes: [{ field: "roles", before: "user", after: "admin" }],
  },
  {
    category: AuditCategory.ADMIN_ACTION,
    action: "user.status.update",
    status: AuditStatus.SUCCESS,
    targetType: "user",
    targetLabel: "Bob Wilson",
    method: "PATCH",
    changes: [{ field: "status", before: "ACTIVE", after: "INACTIVE" }],
  },
  {
    category: AuditCategory.ADMIN_ACTION,
    action: "user.invite.send",
    status: AuditStatus.SUCCESS,
    targetType: "user",
    targetLabel: null,
    method: "POST",
    metadata: { invitedEmail: "new.hire@test.local", expiresIn: "7d" },
  },
  {
    category: AuditCategory.TENANT,
    action: "company.settings.update",
    status: AuditStatus.SUCCESS,
    targetType: "company",
    targetLabel: "Archive Test Co",
    method: "PUT",
    changes: [{ field: "enablePasswordRotation", before: false, after: true }],
  },
  {
    category: AuditCategory.RBAC,
    action: "role.permission.update",
    status: AuditStatus.SUCCESS,
    targetType: "role",
    targetLabel: "Editor Role",
    method: "PUT",
    changes: [
      {
        field: "permissions",
        before: ["dashboard:view"],
        after: ["dashboard:view", "audit-logs:view"],
      },
    ],
  },
  {
    category: AuditCategory.RBAC,
    action: "role.delete",
    status: AuditStatus.FAILURE,
    targetType: "role",
    targetLabel: "Legacy Viewer",
    method: "DELETE",
    failureReason: "Cannot delete role: 3 users still assigned",
  },
  {
    category: AuditCategory.ADMIN_ACTION,
    action: "user.password.change",
    status: AuditStatus.SUCCESS,
    targetType: "user",
    targetLabel: "Alice Johnson",
    method: "PUT",
    changes: [{ field: "password", before: "***", after: "***" }],
  },
];

function buildBaseEvent(
  template: ISeedTemplate,
  timestamp: Date,
  companyRef: mongoose.Types.ObjectId,
): IAuditEventBase {
  const baseEvent: IAuditEventBase = {
    category: template.category,
    action: template.action,
    status: template.status,
    targetType: template.targetType,
    targetId: template.targetType ? companyRef : null,
    requestId: crypto.randomUUID(),
    target: { label: template.targetLabel },
    context: {
      ip: "127.0.0.1",
      userAgent: "audit-seed-archive/1.0",
      path: "/api/seed-archive",
      method: template.method,
    },
    retentionDays: null,
    timestamp,
    companyRef,
    actorId: ACTOR_ID,
    actorEmail: ACTOR_EMAIL,
    actorRole: USER_TYPE.SUPER_ADMIN,
    subsystemMappingVersion: SUBSYSTEM_MAPPING_VERSION,
    actor: { name: ACTOR_NAME },
  };
  if (template.metadata) baseEvent.metadata = template.metadata;
  if (template.changes) baseEvent.changes = template.changes;
  if (template.failureReason) baseEvent.failureReason = template.failureReason;
  return baseEvent;
}

async function appendBackdated(
  baseEvent: IAuditEventBase,
  companyRef: mongoose.Types.ObjectId,
): Promise<void> {
  const signedBytes = deterministicJson(baseEvent);

  /*
   * Lockstep self-check BEFORE touching the chain: the verify walker must be
   * able to rebuild these exact bytes from the stored fields.
   */
  const recomputed = recomputeSignedBytes(baseEvent as IAuditLog);
  if (recomputed !== signedBytes) {
    throw new Error(
      "signed-bytes drift: recomputeSignedBytes disagrees with deterministicJson — refusing to seed rows that would verify as tampered",
    );
  }

  const head = await mongoAuditProvider.getChainHead(companyRef);
  const prevSig = head?.lastSig ?? ROOT_SIG;
  const newSig = sha256(prevSig + HASH_INPUT_SEPARATOR + signedBytes);

  const cas = await mongoAuditProvider.casUpdateChainHead(
    companyRef,
    prevSig,
    newSig,
    null,
  );
  if (!cas.swapped) {
    throw new Error(`chain head CAS failed (${cas.reason}) — aborting`);
  }

  await mongoAuditProvider.appendRow({
    ...baseEvent,
    _sig: newSig,
    _prevSig: prevSig,
    signedSnapshot: signedBytes,
  });
}

async function verifySeededChain(
  companyRef: mongoose.Types.ObjectId,
  expectedCount: number,
): Promise<void> {
  const rows = await mongoAuditProvider.findChainBatch(
    companyRef.toHexString(),
    null,
    expectedCount + 10,
  );
  if (rows.length !== expectedCount) {
    throw new Error(
      `read-back count mismatch: expected ${expectedCount}, found ${rows.length}`,
    );
  }

  let prevSig = ROOT_SIG;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const recomputed = recomputeSignedBytes(row);
    if (recomputed !== row.signedSnapshot) {
      throw new Error(`row ${i}: stored signed bytes drift on read-back`);
    }
    const expectedSig = sha256(prevSig + HASH_INPUT_SEPARATOR + recomputed);
    if (expectedSig !== row._sig) {
      throw new Error(`row ${i}: signature does not verify on read-back`);
    }
    if (row._prevSig !== prevSig) {
      throw new Error(`row ${i}: linkage break on read-back`);
    }
    prevSig = row._sig;
  }

  const headAfter = await mongoAuditProvider.getChainHead(companyRef);
  if (headAfter?.lastSig !== prevSig) {
    throw new Error("chain head does not match the last seeded row");
  }
}

async function seed(): Promise<void> {
  if (process.env.NODE_ENV === "production") {
    throw new Error("refusing to run the archive seed in production");
  }

  await connectDB();
  const companyRef = new mongoose.Types.ObjectId();
  console.log(
    "[audit:seed-archive] fresh test tenant:",
    companyRef.toHexString(),
  );
  console.log(
    `[audit:seed-archive] seeding ${BACKDATED_ROWS} rows ~${BACKDATE_DAYS} days old + ${HOT_ROWS} current rows`,
  );

  /*
   * Backdated rows: ascending timestamps, 2h apart, spread across ~3 UTC days
   * so the sweep produces multiple partitions.
   */
  const start = Date.now() - BACKDATE_DAYS * 24 * 60 * 60 * 1000;
  for (let i = 0; i < BACKDATED_ROWS; i++) {
    const template = TEMPLATES[i % TEMPLATES.length];
    const timestamp = new Date(start + i * 2 * 60 * 60 * 1000);
    await appendBackdated(
      buildBaseEvent(template, timestamp, companyRef),
      companyRef,
    );
    process.stdout.write(".");
  }

  /*
   * Current rows: same chain, now-ish timestamps — these stay in the hot tier
   * after a sweep, giving the tenant a real cold→hot boundary.
   */
  for (let i = 0; i < HOT_ROWS; i++) {
    const template = TEMPLATES[i % TEMPLATES.length];
    const timestamp = new Date(Date.now() - (HOT_ROWS - i) * 60 * 1000);
    await appendBackdated(
      buildBaseEvent(template, timestamp, companyRef),
      companyRef,
    );
    process.stdout.write(".");
  }
  console.log("");

  await verifySeededChain(companyRef, BACKDATED_ROWS + HOT_ROWS);
  console.log("[audit:seed-archive] read-back verify: chain is clean ✔");
  console.log("");
  console.log("[audit:seed-archive] done. Next steps:");
  console.log(
    "  1. npm run audit:sweep-once   (archives the backdated rows to S3)",
  );
  console.log(
    `  2. Verify Chain in the UI with companyRef ${companyRef.toHexString()} → expect "Hot + cold tiers", ${BACKDATED_ROWS} cold + ${HOT_ROWS} hot, status clean`,
  );
  console.log("  3. Archived Logs page → run the default query → expect rows");

  await disconnectDB();
}

seed().then(
  () => process.exit(0),
  (err) => {
    console.error(
      "\n[audit:seed-archive] FAILED:",
      err instanceof Error ? err.message : err,
    );
    process.exit(1);
  },
);
