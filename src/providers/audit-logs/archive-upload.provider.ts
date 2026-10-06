import mongoose from "mongoose";

import envConfig from "@/config/env";
import type { IAuditLog } from "@/db/models/audit-logs/audit-log";
import { AUDIT_CONSTANTS } from "@/providers/audit-logs/utils/audit.constant";
import {
  buildArchiveLocationRoot,
  SAFE_TABLE,
} from "@/providers/audit-logs/archive-setup.provider";
import { athenaProvider } from "@/providers/audit-logs/athena.provider";
import { batchToParquet } from "@/providers/audit-logs/parquet-archive.provider";
import { fileStorageService } from "@/providers/file-storage";
import type {
  ArchiveUploadResult,
  DayGroup,
} from "@/providers/audit-logs/utils/audit-provider.types";

const PARQUET_CONTENT_TYPE = "application/octet-stream";

function partitionFor(date: Date): {
  year: string;
  month: string;
  day: string;
} {
  return {
    year: String(date.getUTCFullYear()).padStart(4, "0"),
    month: String(date.getUTCMonth() + 1).padStart(2, "0"),
    day: String(date.getUTCDate()).padStart(2, "0"),
  };
}

/**
 * Group a batch by UTC calendar day, preserving arrival (`_id`) order both across
 * and within groups. A batch can straddle day boundaries (notably the first-ever
 * backfill), and each day must land in its own partition or Athena's date pruning
 * silently drops rows.
 */
function groupByUtcDay(batch: IAuditLog[]): DayGroup[] {
  const groups = new Map<string, DayGroup>();
  for (const row of batch) {
    const { year, month, day } = partitionFor(row.timestamp);
    const key = `${year}-${month}-${day}`;
    let group = groups.get(key);
    if (!group) {
      group = { year, month, day, rows: [] };
      groups.set(key, group);
    }
    group.rows.push(row);
  }
  return Array.from(groups.values());
}

/**
 * S3 object key + Athena partition LOCATION for a day-group, both derived from
 * the shared `buildArchiveLocationRoot()` so they can never drift from the table.
 * The key is deterministic (`batch-{firstId}.parquet`) so a retry of an
 * already-uploaded group overwrites the same object instead of duplicating rows.
 */
function buildArchivePaths(
  group: DayGroup,
  firstIdHex: string,
): { key: string; partitionLocation: string } {
  const root = buildArchiveLocationRoot();
  const partitionLocation = `${root}year=${group.year}/month=${group.month}/day=${group.day}/`;
  const bucket = envConfig.AUDIT_ARCHIVE_BUCKET as string;
  const key = `${partitionLocation.slice(`s3://${bucket}/`.length)}batch-${firstIdHex}.parquet`;
  return { key, partitionLocation };
}

/** Register a date partition with Athena (idempotent — ADD IF NOT EXISTS, no Glue crawler). */
async function registerPartition(
  group: DayGroup,
  partitionLocation: string,
): Promise<void> {
  const table = AUDIT_CONSTANTS.archiveGlueTable;
  if (!SAFE_TABLE.test(table)) {
    throw new Error(
      `archiveGlueTable "${table}" is not a valid table identifier (expected [A-Za-z0-9_])`,
    );
  }
  const sql =
    `ALTER TABLE \`${table}\` ADD IF NOT EXISTS PARTITION ` +
    `(year='${group.year}', month='${group.month}', day='${group.day}') ` +
    `LOCATION '${partitionLocation}'`;
  await athenaProvider.runQuery(sql);
}

export async function uploadBatchToArchive(
  batch: IAuditLog[],
): Promise<ArchiveUploadResult> {
  const archivedIds: mongoose.Types.ObjectId[] = [];

  for (const group of groupByUtcDay(batch)) {
    const parquet = await batchToParquet(group.rows);
    if (!parquet) {
      continue;
    }

    const firstIdHex = group.rows[0]._id.toHexString();
    const { key, partitionLocation } = buildArchivePaths(group, firstIdHex);

    await fileStorageService.upload({
      key,
      buffer: parquet.buffer,
      mimeType: PARQUET_CONTENT_TYPE,
      bucket: envConfig.AUDIT_ARCHIVE_BUCKET,
    });
    await registerPartition(group, partitionLocation);

    archivedIds.push(...parquet.archivedIds);
  }

  return { archivedIds };
}
