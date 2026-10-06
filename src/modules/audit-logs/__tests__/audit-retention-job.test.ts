import mongoose from "mongoose";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import "@/tests/mocks/database.mock";

import { runAuditRetentionSweep } from "@/agenda/helpers/audit-retention.helper";
import { AuditExportStateModel } from "@/db/models/audit-logs/audit-export-state";
import {
  AuditLogModel,
  type IAuditLog,
} from "@/db/models/audit-logs/audit-log";
import { USER_TYPE } from "@/enums";
import * as archiveUpload from "@/providers/audit-logs/archive-upload.provider";
import { RETENTION_SWEEP_ID } from "@/modules/audit-logs/helpers/retention/sweep.helper";
import { AuditCategory, AuditStatus } from "@/enums/audit.enum";
import { SUBSYSTEM_MAPPING_VERSION } from "@/db/plugins/audit/utils/subsystem";

const MS_PER_DAY = 24 * 60 * 60_000;

function makeExpiredRow(): Partial<IAuditLog> {
  return {
    timestamp: new Date(Date.now() - 365 * MS_PER_DAY), // expired under 90-day window
    category: AuditCategory.ADMIN_ACTION,
    action: "user.update",
    status: AuditStatus.SUCCESS,
    companyRef: new mongoose.Types.ObjectId(),
    actorId: new mongoose.Types.ObjectId(),
    actorEmail: "admin@acme.test",
    actorRole: USER_TYPE.ADMIN,
    targetType: null,
    targetId: null,
    requestId: null,
    _sig: "sig",
    _prevSig: "ROOT",
    subsystemMappingVersion: SUBSYSTEM_MAPPING_VERSION,
    actor: { name: "Admin" },
    target: { label: null },
    context: { ip: null, userAgent: null, path: null, method: null },
    retentionDays: null,
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("runAuditRetentionSweep — the agenda job wires the real commit processor (AC1)", () => {
  it("archives + deletes expired rows (not the D.3 no-op) and advances the checkpoint", async () => {
    await AuditLogModel.insertMany([
      makeExpiredRow(),
      makeExpiredRow(),
      makeExpiredRow(),
    ]);

    // Stand in for D.5's S3/Athena IO — echo the batch's ids as archived.
    const uploadSpy = vi
      .spyOn(archiveUpload, "uploadBatchToArchive")
      .mockImplementation(async (batch) => ({
        archivedIds: batch.map((r) => r._id),
      }));

    await runAuditRetentionSweep();

    // the real processor ran: rows are gone (the no-op would have deleted nothing)
    expect(uploadSpy).toHaveBeenCalledTimes(1);
    expect(await AuditLogModel.countDocuments()).toBe(0);

    const state =
      await AuditExportStateModel.findById(RETENTION_SWEEP_ID).lean();
    expect(state?.lastExportedId).toBeTruthy();
    expect(state?.status).toBe("ok");
  });

  it("swallows a sweep failure so the worker process never crashes (AC6)", async () => {
    await AuditLogModel.insertMany([makeExpiredRow()]);
    vi.spyOn(archiveUpload, "uploadBatchToArchive").mockRejectedValue(
      new Error("s3 down"),
    );
    vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(runAuditRetentionSweep()).resolves.toBeUndefined();

    // upload failed before any commit → row still present, no checkpoint
    expect(await AuditLogModel.countDocuments()).toBe(1);
    expect(await AuditExportStateModel.findById(RETENTION_SWEEP_ID)).toBeNull();
  });
});
