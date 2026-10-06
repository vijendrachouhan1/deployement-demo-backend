import mongoose from "mongoose";
import { describe, expect, it, vi } from "vitest";

import "@/tests/mocks/database.mock";

import { AuditExportStateModel } from "@/db/models/audit-logs/audit-export-state";
import {
  AuditLogModel,
  type IAuditLog,
} from "@/db/models/audit-logs/audit-log";
import { MigrationLockModel } from "@/db/models/audit-logs/migration-lock";
import { USER_TYPE } from "@/enums";
import {
  RETENTION_BATCH_SIZE,
  RETENTION_SWEEP_ID,
  runRetentionSweep,
  selectExpiredBatch,
} from "@/modules/audit-logs/helpers/retention/sweep.helper";
import { AuditCategory, AuditStatus } from "@/enums/audit.enum";
import { SUBSYSTEM_MAPPING_VERSION } from "@/db/plugins/audit/utils/subsystem";

const NOW = new Date("2026-06-03T12:00:00.000Z");
const MS_PER_DAY = 24 * 60 * 60_000;

function makeRow(overrides: Partial<IAuditLog> = {}): Partial<IAuditLog> {
  return {
    timestamp: new Date(NOW.getTime() - 365 * MS_PER_DAY), // expired by default
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
  };
}

async function seed(rows: Partial<IAuditLog>[]): Promise<IAuditLog[]> {
  const docs = await AuditLogModel.insertMany(rows);
  return docs
    .map((d) => d.toObject() as IAuditLog)
    .sort((a, b) => a._id.toString().localeCompare(b._id.toString()));
}

describe("runRetentionSweep — lock (AC1)", () => {
  it("skips when another run already holds an unexpired lock", async () => {
    await seed([makeRow()]);
    await MigrationLockModel.create({
      _id: RETENTION_SWEEP_ID,
      holder: "other-run",
      expiresAt: new Date(NOW.getTime() + 10 * 60_000),
    });

    const processBatch = vi.fn().mockResolvedValue(undefined);
    await runRetentionSweep(NOW, processBatch);

    expect(processBatch).not.toHaveBeenCalled();
    // the other run's lock is untouched
    const lock = await MigrationLockModel.findById(RETENTION_SWEEP_ID).lean();
    expect(lock?.holder).toBe("other-run");
  });

  it("reclaims an expired lock and runs", async () => {
    await seed([makeRow()]);
    await MigrationLockModel.create({
      _id: RETENTION_SWEEP_ID,
      holder: "dead-run",
      expiresAt: new Date(NOW.getTime() - 60_000), // already expired
    });

    const processBatch = vi.fn().mockResolvedValue(undefined);
    await runRetentionSweep(NOW, processBatch);

    expect(processBatch).toHaveBeenCalledTimes(1);
  });

  it("releases the lock after a successful run", async () => {
    await seed([makeRow()]);

    await runRetentionSweep(NOW, vi.fn().mockResolvedValue(undefined));

    const lock = await MigrationLockModel.findById(RETENTION_SWEEP_ID).lean();
    expect(lock).toBeNull();
  });

  it("releases the lock even when the processor throws", async () => {
    await seed([makeRow()]);
    const boom = vi.fn().mockRejectedValue(new Error("processor boom"));

    await expect(runRetentionSweep(NOW, boom)).rejects.toThrow(
      /processor boom/,
    );

    const lock = await MigrationLockModel.findById(RETENTION_SWEEP_ID).lean();
    expect(lock).toBeNull();
  });
});

describe("runRetentionSweep — checkpoint (AC2)", () => {
  it("selects from the oldest row when no checkpoint exists", async () => {
    const rows = await seed([makeRow(), makeRow(), makeRow()]);

    const seen: string[] = [];
    await runRetentionSweep(NOW, async (batch) => {
      batch.forEach((r) => seen.push(r._id.toString()));
    });

    expect(seen.sort()).toEqual(rows.map((r) => r._id.toString()).sort());
  });

  it("resumes strictly after lastExportedId from the checkpoint", async () => {
    const rows = await seed([makeRow(), makeRow(), makeRow()]);
    // checkpoint at the first row → only rows 2 and 3 should be selected
    await AuditExportStateModel.create({
      _id: RETENTION_SWEEP_ID,
      lastExportedAt: rows[0].timestamp,
      lastExportedId: rows[0]._id,
      status: "ok",
    });

    const seen: string[] = [];
    await runRetentionSweep(NOW, async (batch) => {
      batch.forEach((r) => seen.push(r._id.toString()));
    });

    expect(seen.sort()).toEqual(
      [rows[1]._id.toString(), rows[2]._id.toString()].sort(),
    );
  });

  it("never writes the checkpoint (advance is D.6)", async () => {
    await seed([makeRow(), makeRow()]);

    await runRetentionSweep(NOW, vi.fn().mockResolvedValue(undefined));

    const state = await AuditExportStateModel.findById(RETENTION_SWEEP_ID);
    expect(state).toBeNull();
  });
});

describe("selectExpiredBatch — expiry predicate (AC3)", () => {
  it("selects rows older than the flat cutoff and ignores retentionDays", async () => {
    await seed([
      // older than the 90-day window → expired
      makeRow({
        action: "expired.old",
        timestamp: new Date(NOW.getTime() - 365 * MS_PER_DAY),
      }),
      // inside the 90-day window → NOT expired
      makeRow({
        action: "fresh.recent",
        timestamp: new Date(NOW.getTime() - MS_PER_DAY),
      }),
      // a long per-row retentionDays must NOT save an old row — it is ignored
      makeRow({
        action: "expired.longretention",
        timestamp: new Date(NOW.getTime() - 365 * MS_PER_DAY),
        retentionDays: 365,
      }),
      // a tiny per-row retentionDays must NOT expire a recent row — also ignored
      makeRow({
        action: "fresh.shortretention",
        timestamp: new Date(NOW.getTime() - MS_PER_DAY),
        retentionDays: 1,
      }),
    ]);

    const batch = await selectExpiredBatch(NOW, null);
    const actions = batch.map((r) => r.action).sort();

    expect(actions).toEqual(["expired.longretention", "expired.old"]);
  });

  it("orders by _id ascending", async () => {
    const rows = await seed([makeRow(), makeRow(), makeRow()]);
    const batch = await selectExpiredBatch(NOW, null);
    const ids = batch.map((r) => r._id.toString());
    expect(ids).toEqual(rows.map((r) => r._id.toString()));
  });
});

describe("runRetentionSweep — batching & no-op (AC3, AC4)", () => {
  it("streams expired rows in batches of at most RETENTION_BATCH_SIZE", async () => {
    const total = RETENTION_BATCH_SIZE + 50;
    const rows = Array.from({ length: total }, () => makeRow());
    await seed(rows);

    const sizes: number[] = [];
    const seen = new Set<string>();
    await runRetentionSweep(NOW, async (batch) => {
      sizes.push(batch.length);
      batch.forEach((r) => seen.add(r._id.toString()));
    });

    expect(sizes[0]).toBe(RETENTION_BATCH_SIZE);
    expect(sizes.every((s) => s <= RETENTION_BATCH_SIZE)).toBe(true);
    expect(seen.size).toBe(total); // every expired row covered, no overlap
  });

  it("exits cleanly with no processor call and no checkpoint write when nothing is expired", async () => {
    // a single fresh row (timestamp now) — not expired under the 90-day default
    await seed([makeRow({ timestamp: NOW })]);

    const processBatch = vi.fn().mockResolvedValue(undefined);
    await runRetentionSweep(NOW, processBatch);

    expect(processBatch).not.toHaveBeenCalled();
    const lock = await MigrationLockModel.findById(RETENTION_SWEEP_ID).lean();
    expect(lock).toBeNull();
    const state = await AuditExportStateModel.findById(RETENTION_SWEEP_ID);
    expect(state).toBeNull();
  });
});

describe("runRetentionSweep — lock heartbeat (AC8)", () => {
  it("renews the lock once per processed batch so a long sweep can't TTL-expire", async () => {
    // two full pages + a remainder → three processed batches
    const total = RETENTION_BATCH_SIZE * 2 + 5;
    await seed(Array.from({ length: total }, () => makeRow()));

    const renewSpy = vi.spyOn(MigrationLockModel, "updateOne");
    await runRetentionSweep(NOW, vi.fn().mockResolvedValue(undefined));

    // one renewal per batch, each holder-scoped and pushing expiresAt forward
    expect(renewSpy).toHaveBeenCalledTimes(3);
    expect(renewSpy).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        _id: RETENTION_SWEEP_ID,
        holder: expect.any(String),
      }),
      expect.objectContaining({
        $set: expect.objectContaining({ expiresAt: expect.any(Date) }),
      }),
    );
  });

  it("does not renew when there is nothing to sweep", async () => {
    await seed([makeRow({ timestamp: NOW })]); // fresh → not expired
    const renewSpy = vi.spyOn(MigrationLockModel, "updateOne");

    await runRetentionSweep(NOW, vi.fn().mockResolvedValue(undefined));

    expect(renewSpy).not.toHaveBeenCalled();
  });
});
