import mongoose from "mongoose";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MockInstance } from "vitest";

import envConfig from "@/config/env";
import type { IAuditLog } from "@/db/models/audit-logs/audit-log";
import { AUDIT_CONSTANTS } from "@/providers/audit-logs/utils/audit.constant";
import {
  buildArchiveLocationRoot,
  SAFE_TABLE,
} from "@/providers/audit-logs/archive-setup.provider";
import { athenaProvider } from "@/providers/audit-logs/athena.provider";
import * as parquetArchive from "@/providers/audit-logs/parquet-archive.provider";
import { uploadBatchToArchive } from "@/providers/audit-logs/archive-upload.provider";
import { fileStorageService } from "@/providers/file-storage";

function makeRow(timestamp: string, id?: mongoose.Types.ObjectId): IAuditLog {
  return {
    _id: id ?? new mongoose.Types.ObjectId(),
    timestamp: new Date(timestamp),
  } as IAuditLog;
}

const origBucket = envConfig.AUDIT_ARCHIVE_BUCKET;
const origPrefix = AUDIT_CONSTANTS.archivePrefix;
const origTable = AUDIT_CONSTANTS.archiveGlueTable;

let uploadSpy: MockInstance<typeof fileStorageService.upload>;
let runQuerySpy: MockInstance<typeof athenaProvider.runQuery>;

beforeEach(() => {
  envConfig.AUDIT_ARCHIVE_BUCKET = "suraj-audit-archive";
  AUDIT_CONSTANTS.archivePrefix = "archive";
  AUDIT_CONSTANTS.archiveGlueTable = "audit_archive";

  // Parquet conversion is covered by its own suite — stub it so these tests
  // target grouping / upload / partition-registration. archivedIds echo the input.
  vi.spyOn(parquetArchive, "batchToParquet").mockImplementation(
    async (rows: IAuditLog[]) => ({
      buffer: Buffer.from("PAR1"),
      archivedIds: rows.map((r) => r._id),
    }),
  );
  uploadSpy = vi
    .spyOn(fileStorageService, "upload")
    .mockResolvedValue({ key: "stub-key" });
  runQuerySpy = vi
    .spyOn(athenaProvider, "runQuery")
    .mockResolvedValue({ rows: [], truncated: false });
});

afterEach(() => {
  vi.restoreAllMocks();
  envConfig.AUDIT_ARCHIVE_BUCKET = origBucket;
  AUDIT_CONSTANTS.archivePrefix = origPrefix;
  AUDIT_CONSTANTS.archiveGlueTable = origTable;
});

describe("uploadBatchToArchive: single-day batch (AC1, AC3, AC7)", () => {
  it("uploads one object to the archive bucket and registers one partition", async () => {
    const id = new mongoose.Types.ObjectId();
    const batch = [
      makeRow("2026-05-15T01:00:00.000Z", id),
      makeRow("2026-05-15T23:59:00.000Z"),
    ];

    const { archivedIds } = await uploadBatchToArchive(batch);

    expect(uploadSpy).toHaveBeenCalledTimes(1);
    const uploaded = uploadSpy.mock.calls[0][0];
    expect(uploaded.bucket).toBe("suraj-audit-archive");
    expect(uploaded.key).toBe(
      `archive/year=2026/month=05/day=15/batch-${id.toHexString()}.parquet`,
    );
    expect(uploaded.buffer).toBeInstanceOf(Buffer);

    expect(runQuerySpy).toHaveBeenCalledTimes(1);
    const sql = runQuerySpy.mock.calls[0][0] as string;
    expect(sql).toContain(
      "ALTER TABLE `audit_archive` ADD IF NOT EXISTS PARTITION",
    );
    expect(sql).toContain("(year='2026', month='05', day='15')");
    expect(sql).toContain(
      "LOCATION 's3://suraj-audit-archive/archive/year=2026/month=05/day=15/'",
    );

    expect(archivedIds).toEqual(batch.map((r) => r._id));
  });
});

describe("uploadBatchToArchive: multi-day batch (AC2)", () => {
  it("splits into one object + one partition per UTC day, zero-padded", async () => {
    const jan = new mongoose.Types.ObjectId();
    const may = new mongoose.Types.ObjectId();
    const batch = [
      makeRow("2026-01-05T12:00:00.000Z", jan),
      makeRow("2026-01-05T18:00:00.000Z"),
      makeRow("2026-05-15T09:00:00.000Z", may),
    ];

    await uploadBatchToArchive(batch);

    expect(uploadSpy).toHaveBeenCalledTimes(2);
    const keys = uploadSpy.mock.calls.map((c) => c[0].key);
    expect(keys).toContain(
      `archive/year=2026/month=01/day=05/batch-${jan.toHexString()}.parquet`,
    );
    expect(keys).toContain(
      `archive/year=2026/month=05/day=15/batch-${may.toHexString()}.parquet`,
    );

    expect(runQuerySpy).toHaveBeenCalledTimes(2);
    const partitions = runQuerySpy.mock.calls.map((c) => c[0] as string);
    expect(
      partitions.some((s) => s.includes("(year='2026', month='01', day='05')")),
    ).toBe(true);
    expect(
      partitions.some((s) => s.includes("(year='2026', month='05', day='15')")),
    ).toBe(true);
  });

  it("uses UTC, not local time, for the partition boundary", async () => {
    // 2026-05-15T23:30Z is still May 15 in UTC regardless of the runner's TZ.
    await uploadBatchToArchive([makeRow("2026-05-15T23:30:00.000Z")]);
    expect(runQuerySpy.mock.calls[0][0]).toContain(
      "(year='2026', month='05', day='15')",
    );
  });
});

describe("uploadBatchToArchive: deterministic key (AC4)", () => {
  it("produces the same key for the same day-group rows (retry overwrites)", async () => {
    const id = new mongoose.Types.ObjectId();
    const batch = [makeRow("2026-05-15T01:00:00.000Z", id)];

    await uploadBatchToArchive(batch);
    await uploadBatchToArchive(batch);

    expect(uploadSpy.mock.calls[0][0].key).toBe(uploadSpy.mock.calls[1][0].key);
  });
});

describe("uploadBatchToArchive: ordering + failure halts (AC5)", () => {
  it("uploads before registering the partition", async () => {
    await uploadBatchToArchive([makeRow("2026-05-15T01:00:00.000Z")]);
    expect(uploadSpy.mock.invocationCallOrder[0]).toBeLessThan(
      runQuerySpy.mock.invocationCallOrder[0],
    );
  });

  it("does not register the partition and propagates when the upload fails", async () => {
    uploadSpy.mockRejectedValueOnce(new Error("s3 down"));

    await expect(
      uploadBatchToArchive([makeRow("2026-05-15T01:00:00.000Z")]),
    ).rejects.toThrow("s3 down");
    expect(runQuerySpy).not.toHaveBeenCalled();
  });
});

describe("uploadBatchToArchive: skip + empty (AC6)", () => {
  it("skips a day-group whose conversion returns null and excludes it from archivedIds", async () => {
    const keptId = new mongoose.Types.ObjectId();
    const droppedId = new mongoose.Types.ObjectId();
    const kept = makeRow("2026-05-15T01:00:00.000Z", keptId);
    const dropped = makeRow("2026-06-20T01:00:00.000Z", droppedId);

    (
      parquetArchive.batchToParquet as ReturnType<typeof vi.fn>
    ).mockImplementation(async (rows: IAuditLog[]) =>
      rows[0]._id.equals(droppedId)
        ? null
        : { buffer: Buffer.from("PAR1"), archivedIds: rows.map((r) => r._id) },
    );

    const { archivedIds } = await uploadBatchToArchive([kept, dropped]);

    expect(uploadSpy).toHaveBeenCalledTimes(1);
    expect(archivedIds).toEqual([keptId]);
    expect(archivedIds).not.toContainEqual(droppedId);
  });

  it("returns no archivedIds and touches no AWS for an empty batch", async () => {
    const { archivedIds } = await uploadBatchToArchive([]);
    expect(archivedIds).toEqual([]);
    expect(uploadSpy).not.toHaveBeenCalled();
    expect(runQuerySpy).not.toHaveBeenCalled();
  });
});

describe("uploadBatchToArchive: LOCATION-root drift guard (AC1, AC3)", () => {
  it("registers the partition under the same root the table DDL uses", async () => {
    await uploadBatchToArchive([makeRow("2026-05-15T01:00:00.000Z")]);
    const sql = runQuerySpy.mock.calls[0][0] as string;
    const root = buildArchiveLocationRoot();
    const location = sql.match(/LOCATION '([^']+)'/)![1];
    expect(location.startsWith(root)).toBe(true);
  });

  it("table identifier passes the shared SAFE_TABLE guard", () => {
    expect(SAFE_TABLE.test("audit_archive")).toBe(true);
    expect(SAFE_TABLE.test("audit`;DROP")).toBe(false);
  });
});
