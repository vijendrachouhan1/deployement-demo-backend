import crypto from "crypto";
import mongoose from "mongoose";

import {
  AuditLogModel,
  type IAuditLog,
} from "@/db/models/audit-logs/audit-log";
import { AuditExportStateModel } from "@/db/models/audit-logs/audit-export-state";
import { MigrationLockModel } from "@/db/models/audit-logs/migration-lock";
import { resolveHotWindowCutoff } from "@/modules/audit-logs/helpers/retention/window.helper";
import type { RetentionBatchProcessor } from "@/modules/audit-logs/utils/retention.types";

export const RETENTION_SWEEP_ID = "audit-retention-sweep";
export const RETENTION_BATCH_SIZE = 1000;
export const RETENTION_LOCK_TTL_MS = 30 * 60_000;

const logBatch: RetentionBatchProcessor = async (batch, meta) => {
  console.info(
    `[audit-retention] batch ${meta.batchIndex}: ${batch.length} expired rows ` +
      `(_id ${meta.firstId.toString()}..${meta.lastId.toString()}) — ` +
      `default logging processor`,
  );
};

async function acquireLock(now: Date): Promise<string | null> {
  const holder = `${process.pid}:${now.getTime()}:${crypto.randomUUID()}`;
  const expiresAt = new Date(now.getTime() + RETENTION_LOCK_TTL_MS);

  try {
    await MigrationLockModel.findOneAndUpdate(
      { _id: RETENTION_SWEEP_ID, expiresAt: { $lt: now } },
      { $set: { holder, expiresAt } },
      { upsert: true, new: true },
    );
    return holder;
  } catch (err) {
    if ((err as { code?: number }).code === 11000) {
      return null;
    }
    throw err;
  }
}

/** Release the lock only if this run still holds it. */
async function releaseLock(holder: string): Promise<void> {
  await MigrationLockModel.deleteOne({ _id: RETENTION_SWEEP_ID, holder });
}

async function renewLock(holder: string): Promise<void> {
  await MigrationLockModel.updateOne(
    { _id: RETENTION_SWEEP_ID, holder },
    { $set: { expiresAt: new Date(Date.now() + RETENTION_LOCK_TTL_MS) } },
  );
}

async function readCheckpointId(): Promise<mongoose.Types.ObjectId | null> {
  const state = await AuditExportStateModel.findById(RETENTION_SWEEP_ID).lean();
  return state?.lastExportedId ?? null;
}

export async function selectExpiredBatch(
  now: Date,
  afterId: mongoose.Types.ObjectId | null,
): Promise<IAuditLog[]> {
  const cutoff = resolveHotWindowCutoff(now);

  const filter: mongoose.FilterQuery<IAuditLog> = {
    timestamp: { $lt: cutoff },
    ...(afterId ? { _id: { $gt: afterId } } : {}),
  };

  return AuditLogModel.find(filter)
    .sort({ _id: 1 })
    .limit(RETENTION_BATCH_SIZE)
    .lean<IAuditLog[]>();
}

/**
 * Scheduled job that streams expired audit logs out of MongoDB in batches so
 * they can be moved to cold storage.
 *
 * Only one run executes at a time: it holds a lock, so if a slow run overlaps
 * with the next scheduled one they can't process the same rows twice. If a
 * previous run was interrupted, it resumes from the last saved checkpoint
 * instead of starting over.
 *
 * This function only *finds* expired rows (those with a `timestamp` older than
 * the hot-window cutoff) and hands them to `processBatch`, 1,000 at a time. It
 * does not archive or delete anything itself — converting a batch to Parquet,
 * uploading it to S3, deleting the rows, and advancing the checkpoint are the
 * processor's job. The default processor only logs, so real callers pass their
 * own.
 *
 * @param now Injectable clock for tests (defaults to wall-clock now).
 * @param processBatch Handler that archives and deletes each batch (defaults to a logging no-op).
 */
export async function runRetentionSweep(
  now: Date = new Date(),
  processBatch: RetentionBatchProcessor = logBatch,
): Promise<void> {
  const holder = await acquireLock(now);
  if (!holder) {
    console.info("[audit-retention] sweep already running — skipping");
    return;
  }

  try {
    let cursor = await readCheckpointId();
    let batchIndex = 0;

    for (;;) {
      const batch = await selectExpiredBatch(now, cursor);

      if (batch.length === 0) {
        if (batchIndex === 0) {
          console.info("[audit-retention] nothing to sweep");
        }
        break;
      }

      const batchLen = batch.length;
      const firstId = batch[0]._id;
      const lastId = batch[batchLen - 1]._id;

      await processBatch(batch, { batchIndex, firstId, lastId });
      await renewLock(holder);

      cursor = lastId;
      batchIndex += 1;

      if (batchLen < RETENTION_BATCH_SIZE) {
        break;
      }
    }
  } finally {
    await releaseLock(holder);
  }
}
