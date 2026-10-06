import mongoose from "mongoose";

import {
  AuditLogModel,
  type IAuditLog,
} from "@/db/models/audit-logs/audit-log";
import { AuditExportStateModel } from "@/db/models/audit-logs/audit-export-state";
import { uploadBatchToArchive } from "@/providers/audit-logs/archive-upload.provider";
import { RETENTION_SWEEP_ID } from "@/modules/audit-logs/helpers/retention/sweep.helper";
import type { RetentionBatchProcessor } from "@/modules/audit-logs/utils/retention.types";

function isValidDate(value: unknown): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

/**
 * Reject a row that cannot be safely archived BEFORE it reaches grouping /
 * convert / upload / delete. Grouping derives the S3 partition from
 * `row.timestamp`, so an Invalid Date would otherwise build a `year=NaN`
 * partition and — because the row deletes after upload — be lost. The required
 * tamper-evidence fields are read unguarded by the Parquet mapper, so a missing
 * one would be written as a silent null cold copy while the hot original is
 * deleted. Returns a reason string when unarchivable, null when safe.
 */
export function validateArchivableRow(row: IAuditLog): string | null {
  if (!isValidDate(row.timestamp)) return "invalid or missing timestamp";
  if (!row._sig) return "missing _sig";
  if (!row._prevSig) return "missing _prevSig";
  if (row.actorRole == null) return "missing actorRole";
  if (row.category == null) return "missing category";
  if (!row.action) return "missing action";
  if (row.status == null) return "missing status";
  if (
    typeof row.subsystemMappingVersion !== "number" ||
    Number.isNaN(row.subsystemMappingVersion)
  ) {
    return "invalid subsystemMappingVersion";
  }
  return null;
}

/**
 * Advance the persisted checkpoint to the batch cursor. Always moves to
 * `meta.lastId` — even when nothing shipped — so an all-skipped (corrupt) batch
 * is passed over once instead of being re-selected forever; delete is separately
 * scoped to `archivedIds`, so advancing never deletes a skipped row.
 */
async function advanceCheckpoint(
  lastId: mongoose.Types.ObjectId,
  lastTimestamp: Date | null,
): Promise<void> {
  await AuditExportStateModel.findByIdAndUpdate(
    RETENTION_SWEEP_ID,
    {
      $set: {
        lastExportedId: lastId,
        lastExportedAt: lastTimestamp,
        status: "ok",
      },
    },
    { upsert: true },
  );
}

/**
 * The real retention processor the nightly sweep runs in production. Commit
 * order is strict: upload + register the cold copy (throws on IO failure) →
 * advance the checkpoint → delete the hot rows by explicit `_id`. Advancing
 * before delete means a delete failure leaves rows in both tiers (skipped next
 * run via `lastExportedId`) — never in neither.
 *
 * System lifecycle is logged through the app logger only and never chain-emits:
 * the retention worker has no audit identity to sign events with.
 */
export const commitBatchToArchive: RetentionBatchProcessor = async (
  batch,
  meta,
) => {
  const valid: IAuditLog[] = [];
  for (const row of batch) {
    const reason = validateArchivableRow(row);
    if (reason) {
      console.error(
        `[audit-retention] skipped malformed row _id=${row?._id?.toString()} — ${reason}; left in hot tier for investigation`,
      );
      continue;
    }
    valid.push(row);
  }

  /*
   * uploadBatchToArchive throws on any S3/partition failure — let it propagate
   * so the sweep halts this batch (no checkpoint advance, no delete) and retries
   * it next run; the deterministic archive keys make that retry idempotent.
   */
  const { archivedIds } = valid.length
    ? await uploadBatchToArchive(valid)
    : { archivedIds: [] as mongoose.Types.ObjectId[] };

  /*
   * A valid row the converter couldn't encode (e.g. a value outside a Parquet
   * column's domain) comes back missing from archivedIds — neither archived nor
   * deleted, yet the checkpoint advances past it, so it would be orphaned in the
   * hot tier with no trace. Surface each one for investigation.
   */
  if (archivedIds.length !== valid.length) {
    const archived = new Set(archivedIds.map((id) => id.toString()));
    for (const row of valid) {
      if (!archived.has(row._id.toString())) {
        console.error(
          `[audit-retention] valid row _id=${row._id.toString()} was not archived (dropped during convert/upload); left in hot tier for investigation`,
        );
      }
    }
  }

  const lastRow = batch[batch.length - 1];
  const lastTimestamp =
    lastRow && isValidDate(lastRow.timestamp) ? lastRow.timestamp : null;
  await advanceCheckpoint(meta.lastId, lastTimestamp);

  if (archivedIds.length) {
    /*
     * Delete by explicit _id list only — never by the expiry query — so a row
     * that expired between selection and delete is never caught.
     */
    await AuditLogModel.deleteMany({ _id: { $in: archivedIds } });
    console.info(
      `[audit-retention] batch ${meta.batchIndex}: archived + deleted ${archivedIds.length} rows ` +
        `(_id ${meta.firstId.toString()}..${meta.lastId.toString()})`,
    );
  }
};
