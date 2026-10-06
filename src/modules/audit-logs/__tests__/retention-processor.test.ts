import mongoose from "mongoose";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import "@/tests/mocks/database.mock";

import { AuditExportStateModel } from "@/db/models/audit-logs/audit-export-state";
import {
  AuditLogModel,
  type IAuditLog,
} from "@/db/models/audit-logs/audit-log";
import { USER_TYPE } from "@/enums";
import * as archiveUpload from "@/providers/audit-logs/archive-upload.provider";
import * as auditEmit from "@/modules/audit-logs/helpers/emit.helper";
import * as appendModule from "@/db/plugins/audit/append-audit-log";
import {
  commitBatchToArchive,
  validateArchivableRow,
} from "@/modules/audit-logs/helpers/retention/processor.helper";
import { RETENTION_SWEEP_ID } from "@/modules/audit-logs/helpers/retention/sweep.helper";
import { AuditCategory, AuditStatus } from "@/enums/audit.enum";
import { SUBSYSTEM_MAPPING_VERSION } from "@/db/plugins/audit/utils/subsystem";

const TS = new Date("2026-01-15T10:00:00.000Z");

function makeRow(overrides: Partial<IAuditLog> = {}): IAuditLog {
  return {
    _id: new mongoose.Types.ObjectId(),
    timestamp: TS,
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
    ...overrides,
  } as IAuditLog;
}

function metaFor(batch: IAuditLog[], batchIndex = 0) {
  return {
    batchIndex,
    firstId: batch[0]._id,
    lastId: batch[batch.length - 1]._id,
  };
}

/** Seed real rows so delete/checkpoint effects can be asserted against Mongo. */
async function seed(rows: Partial<IAuditLog>[]): Promise<IAuditLog[]> {
  const docs = await AuditLogModel.insertMany(rows.map((r) => makeRow(r)));
  return docs
    .map((d) => d.toObject() as IAuditLog)
    .sort((a, b) => a._id.toString().localeCompare(b._id.toString()));
}

beforeEach(() => {
  vi.restoreAllMocks();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("validateArchivableRow (AC2)", () => {
  it("accepts a well-formed row", () => {
    expect(validateArchivableRow(makeRow())).toBeNull();
  });

  it("rejects a non-Date / Invalid-Date timestamp", () => {
    expect(
      validateArchivableRow(makeRow({ timestamp: new Date("nope") })),
    ).toMatch(/timestamp/);
    expect(
      validateArchivableRow(
        makeRow({ timestamp: "2026-01-01" as unknown as Date }),
      ),
    ).toMatch(/timestamp/);
  });

  it("rejects missing required tamper-evidence fields", () => {
    expect(validateArchivableRow(makeRow({ _sig: "" }))).toMatch(/_sig/);
    expect(validateArchivableRow(makeRow({ _prevSig: "" }))).toMatch(
      /_prevSig/,
    );
    expect(
      validateArchivableRow(
        makeRow({ actorRole: null as unknown as USER_TYPE }),
      ),
    ).toMatch(/actorRole/);
    expect(validateArchivableRow(makeRow({ action: "" }))).toMatch(/action/);
    expect(
      validateArchivableRow(
        makeRow({ subsystemMappingVersion: undefined as unknown as number }),
      ),
    ).toMatch(/subsystemMappingVersion/);
  });
});

describe("commitBatchToArchive — happy path (AC3, AC4, AC5)", () => {
  it("uploads valid rows, advances the checkpoint, deletes only archivedIds", async () => {
    const rows = await seed([{}, {}, {}]);
    // D.5 archived rows 0 and 1 (row 2 e.g. skipped by D.4 conversion downstream)
    const archivedIds = [rows[0]._id, rows[1]._id];
    const uploadSpy = vi
      .spyOn(archiveUpload, "uploadBatchToArchive")
      .mockResolvedValue({ archivedIds });

    await commitBatchToArchive(rows, metaFor(rows));

    // upload received every valid row
    expect(uploadSpy).toHaveBeenCalledTimes(1);
    expect(uploadSpy.mock.calls[0][0]).toHaveLength(3);

    // only the archived rows are gone; the un-archived row survives (AC4)
    const remaining = await AuditLogModel.find().lean<IAuditLog[]>();
    expect(remaining.map((r) => r._id.toString())).toEqual([
      rows[2]._id.toString(),
    ]);

    // checkpoint advanced to the batch cursor (AC5)
    const state =
      await AuditExportStateModel.findById(RETENTION_SWEEP_ID).lean();
    expect(state?.lastExportedId?.toString()).toBe(rows[2]._id.toString());
    expect(state?.lastExportedAt?.toISOString()).toBe(TS.toISOString());
    expect(state?.status).toBe("ok");
  });
});

describe("commitBatchToArchive — partial archive surfaces unarchived valid rows", () => {
  it("logs each valid row the converter dropped (missing from archivedIds), but still deletes only archivedIds", async () => {
    const rows = await seed([{}, {}, {}]);
    // D.4/D.5 archived rows 0 and 1; row 2 was valid at the guard but dropped downstream
    const archivedIds = [rows[0]._id, rows[1]._id];
    vi.spyOn(archiveUpload, "uploadBatchToArchive").mockResolvedValue({
      archivedIds,
    });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await commitBatchToArchive(rows, metaFor(rows));

    // the dropped valid row is surfaced for investigation
    expect(errSpy).toHaveBeenCalledTimes(1);
    expect(errSpy.mock.calls[0][0]).toContain(rows[2]._id.toString());
    expect(errSpy.mock.calls[0][0]).toMatch(/not archived/);

    // it stays in the hot tier (not deleted), checkpoint still advances
    const remaining = await AuditLogModel.find().lean<IAuditLog[]>();
    expect(remaining.map((r) => r._id.toString())).toEqual([
      rows[2]._id.toString(),
    ]);
  });
});

describe("commitBatchToArchive — commit order (AC3)", () => {
  it("runs upload → checkpoint → delete in that order", async () => {
    const rows = [makeRow()];
    const uploadSpy = vi
      .spyOn(archiveUpload, "uploadBatchToArchive")
      .mockResolvedValue({ archivedIds: [rows[0]._id] });
    const checkpointSpy = vi
      .spyOn(AuditExportStateModel, "findByIdAndUpdate")
      .mockResolvedValue(null as never);
    const deleteSpy = vi
      .spyOn(AuditLogModel, "deleteMany")
      .mockResolvedValue({ deletedCount: 1 } as never);

    await commitBatchToArchive(rows, metaFor(rows));

    const up = uploadSpy.mock.invocationCallOrder[0];
    const cp = checkpointSpy.mock.invocationCallOrder[0];
    const del = deleteSpy.mock.invocationCallOrder[0];
    expect(up).toBeLessThan(cp);
    expect(cp).toBeLessThan(del);

    // delete is by explicit _id list, scoped to archivedIds (AC4)
    expect(deleteSpy.mock.calls[0][0]).toEqual({ _id: { $in: [rows[0]._id] } });
  });
});

describe("commitBatchToArchive — error halts the batch (AC6)", () => {
  it("does not advance the checkpoint or delete when upload throws", async () => {
    const rows = await seed([{}]);
    vi.spyOn(archiveUpload, "uploadBatchToArchive").mockRejectedValue(
      new Error("s3 down"),
    );

    await expect(commitBatchToArchive(rows, metaFor(rows))).rejects.toThrow(
      "s3 down",
    );

    const state =
      await AuditExportStateModel.findById(RETENTION_SWEEP_ID).lean();
    expect(state).toBeNull(); // no checkpoint advance
    const remaining = await AuditLogModel.countDocuments();
    expect(remaining).toBe(1); // nothing deleted
  });
});

describe("commitBatchToArchive — integrity guard (AC2)", () => {
  it("excludes malformed rows from upload+delete; they stay in the hot tier", async () => {
    const valid = makeRow();
    const badTs = makeRow({ timestamp: new Date("nope") });
    const noSig = makeRow({ _sig: "" });
    const batch = [valid, badTs, noSig];

    const uploadSpy = vi
      .spyOn(archiveUpload, "uploadBatchToArchive")
      .mockResolvedValue({ archivedIds: [valid._id] });
    const deleteSpy = vi
      .spyOn(AuditLogModel, "deleteMany")
      .mockResolvedValue({ deletedCount: 1 } as never);
    const checkpointSpy = vi
      .spyOn(AuditExportStateModel, "findByIdAndUpdate")
      .mockResolvedValue(null as never);
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await commitBatchToArchive(batch, metaFor(batch));

    // only the valid row reaches the converter/uploader
    expect(uploadSpy).toHaveBeenCalledTimes(1);
    expect(uploadSpy.mock.calls[0][0]).toEqual([valid]);
    // delete scoped to the archived (valid) row only — the two bad rows are never deleted
    expect(deleteSpy.mock.calls[0][0]).toEqual({ _id: { $in: [valid._id] } });
    // checkpoint still advances to the batch cursor
    expect(checkpointSpy.mock.calls[0][0]).toBe(RETENTION_SWEEP_ID);
    expect(checkpointSpy.mock.calls[0][1]).toMatchObject({
      $set: { lastExportedId: batch[batch.length - 1]._id },
    });
    expect(errSpy).toHaveBeenCalledTimes(2); // one log per skipped row
  });

  it("advances past an all-malformed batch without uploading or deleting (no re-select loop)", async () => {
    const batch = [
      makeRow({ timestamp: new Date("nope") }),
      makeRow({ _sig: "" }),
    ];
    const uploadSpy = vi.spyOn(archiveUpload, "uploadBatchToArchive");
    const deleteSpy = vi.spyOn(AuditLogModel, "deleteMany");
    const checkpointSpy = vi
      .spyOn(AuditExportStateModel, "findByIdAndUpdate")
      .mockResolvedValue(null as never);
    vi.spyOn(console, "error").mockImplementation(() => {});

    await commitBatchToArchive(batch, metaFor(batch));

    expect(uploadSpy).not.toHaveBeenCalled();
    expect(deleteSpy).not.toHaveBeenCalled();
    // checkpoint still moves to the cursor so the corrupt batch isn't re-selected forever
    expect(checkpointSpy.mock.calls[0][1]).toMatchObject({
      $set: { lastExportedId: batch[batch.length - 1]._id },
    });
  });
});

describe("commitBatchToArchive — app-logger-only, no chain-emit (AC7, FR19)", () => {
  it("never calls emitAuditLog / emitAuditLogSync during a commit", async () => {
    const rows = [makeRow()];
    vi.spyOn(archiveUpload, "uploadBatchToArchive").mockResolvedValue({
      archivedIds: [rows[0]._id],
    });
    vi.spyOn(AuditLogModel, "deleteMany").mockResolvedValue({
      deletedCount: 1,
    } as never);
    vi.spyOn(AuditExportStateModel, "findByIdAndUpdate").mockResolvedValue(
      null as never,
    );
    const emitSpy = vi
      .spyOn(auditEmit, "emitAuditLog")
      .mockImplementation(() => {});
    const emitSyncSpy = vi
      .spyOn(auditEmit, "emitAuditLogSync")
      .mockResolvedValue();
    const appendSpy = vi
      .spyOn(appendModule, "appendAuditLog")
      .mockResolvedValue(undefined as never);

    await commitBatchToArchive(rows, metaFor(rows));

    expect(emitSpy).not.toHaveBeenCalled();
    expect(emitSyncSpy).not.toHaveBeenCalled();
    expect(appendSpy).not.toHaveBeenCalled();
  });
});
