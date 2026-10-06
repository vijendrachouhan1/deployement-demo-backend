import { Writable } from "stream";

import { ParquetSchema, ParquetWriter } from "@dsnp/parquetjs";
import type { SchemaDefinition } from "@dsnp/parquetjs";
import mongoose from "mongoose";

import type { IAuditLog } from "@/db/models/audit-logs/audit-log";
import { ARCHIVE_COLUMNS } from "@/providers/audit-logs/archive-setup.provider";
import { recomputeSignedBytes } from "@/db/plugins/audit/recompute-signed-bytes";
import type { IParquetBatchResult } from "@/providers/audit-logs/utils/audit-provider.types";

/*
 * Hive column types (from ARCHIVE_COLUMNS) → parquetjs primitives. Athena reads
 * a TIMESTAMP_MILLIS Parquet column as `timestamp` (UTC ms); INT32 covers the
 * two `int` columns; everything else is a UTF8 string.
 */
const HIVE_TO_PARQUET: Record<string, "TIMESTAMP_MILLIS" | "INT32" | "UTF8"> = {
  timestamp: "TIMESTAMP_MILLIS",
  int: "INT32",
  string: "UTF8",
};

/*
 * Parquet schema derived from ARCHIVE_COLUMNS so the writer can never drift from
 * the table definition. Every column is optional (some rows have null targetId /
 * failureReason / changes / metadata) and Snappy-compressed to match the table's
 * 'parquet.compression'='SNAPPY' setting.
 */
const ARCHIVE_PARQUET_SCHEMA = new ParquetSchema(
  Object.fromEntries(
    ARCHIVE_COLUMNS.map(([name, hiveType]) => [
      name,
      {
        type: HIVE_TO_PARQUET[hiveType],
        optional: true,
        compression: "SNAPPY",
      },
    ]),
  ) as SchemaDefinition,
);

const objectIdToString = (
  id: mongoose.Types.ObjectId | null | undefined,
): string | null => id?.toHexString() ?? null;

export function mapRowToArchiveColumns(
  row: IAuditLog,
): Record<string, unknown> {
  return {
    _id: row._id.toHexString(),
    timestamp: row.timestamp,
    category: row.category,
    action: row.action,
    status: row.status,
    companyRef: objectIdToString(row.companyRef),
    actorId: objectIdToString(row.actorId),
    actorEmail: row.actorEmail ?? null,
    actorRole: row.actorRole,
    targetType: row.targetType ?? null,
    targetId: objectIdToString(row.targetId),
    requestId: row.requestId ?? null,
    actor_name: row.actor?.name ?? null,
    actor_impersonatedBy: objectIdToString(row.actor?.impersonatedBy),
    target_label: row.target?.label ?? null,
    context_ip: row.context?.ip ?? null,
    context_userAgent: row.context?.userAgent ?? null,
    context_path: row.context?.path ?? null,
    context_method: row.context?.method ?? null,
    changes: row.changes ? JSON.stringify(row.changes) : null,
    metadata: row.metadata ? JSON.stringify(row.metadata) : null,
    failureReason: row.failureReason ?? null,
    retentionDays: row.retentionDays ?? null,
    _sig: row._sig,
    _prevSig: row._prevSig,
    subsystemMappingVersion: row.subsystemMappingVersion ?? null,
    signedSnapshot: row.signedSnapshot ?? recomputeSignedBytes(row),
  };
}

/**
 * Convert a batch of expired audit rows to a Snappy-compressed Parquet buffer.
 * A row that fails to map/serialize is skipped and logged; the rest of the batch
 * still ships. Returns the buffer plus the `_id`s actually written, or null when
 * nothing survives (empty input or every row skipped) so the caller uploads
 * nothing.
 *
 * Pure transform: no S3/Athena coupling — the caller owns upload and delete.
 */
export async function batchToParquet(
  batch: IAuditLog[],
): Promise<IParquetBatchResult | null> {
  const chunks: Buffer[] = [];
  const sink = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(chunk as Buffer);
      callback();
    },
  });

  /*
   * openStream types its sink as fs.WriteStream, but only calls write/end on it
   * — an in-memory Writable supplies exactly those. Bridge the over-strict param
   * via its own public signature, not a deep dist import.
   */
  const writer = await ParquetWriter.openStream(
    ARCHIVE_PARQUET_SCHEMA,
    sink as unknown as Parameters<typeof ParquetWriter.openStream>[1],
  );
  const archivedIds: mongoose.Types.ObjectId[] = [];

  for (const row of batch) {
    try {
      await writer.appendRow(mapRowToArchiveColumns(row));
      archivedIds.push(row._id);
    } catch (err) {
      console.error(
        `[audit-retention][parquet] skipped row _id=${row._id?.toString()} — conversion failed:`,
        err,
      );
    }
  }

  await writer.close();

  if (archivedIds.length === 0) {
    return null;
  }

  return { buffer: Buffer.concat(chunks), archivedIds };
}
