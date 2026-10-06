import { afterEach, describe, expect, it } from "vitest";

import envConfig from "@/config/env";
import { AUDIT_CONSTANTS } from "@/providers/audit-logs/utils/audit.constant";
import { athenaProvider } from "@/providers/audit-logs/athena.provider";
import {
  buildCreateTableSql,
  createArchiveTable,
} from "@/providers/audit-logs/archive-setup.provider";

describe("buildCreateTableSql", () => {
  const origBucket = envConfig.AUDIT_ARCHIVE_BUCKET;
  const origPrefix = AUDIT_CONSTANTS.archivePrefix;
  const origTable = AUDIT_CONSTANTS.archiveGlueTable;

  afterEach(() => {
    envConfig.AUDIT_ARCHIVE_BUCKET = origBucket;
    AUDIT_CONSTANTS.archivePrefix = origPrefix;
    AUDIT_CONSTANTS.archiveGlueTable = origTable;
  });

  it("emits an idempotent CREATE TABLE with the full column + signedSnapshot shape", () => {
    envConfig.AUDIT_ARCHIVE_BUCKET = "suraj-audit-archive";
    AUDIT_CONSTANTS.archivePrefix = "archive";
    AUDIT_CONSTANTS.archiveGlueTable = "audit_archive";

    const sql = buildCreateTableSql();

    expect(sql).toContain(
      "CREATE EXTERNAL TABLE IF NOT EXISTS `audit_archive`",
    );
    expect(sql).toContain("`_id` string"); // cold walk order + entryId
    expect(sql).toContain("`signedSnapshot` string");
    expect(sql).toContain("`timestamp` timestamp"); // reserved word, backticked
    expect(sql).toContain("`_sig` string");
    expect(sql).toContain(
      "PARTITIONED BY (`year` string, `month` string, `day` string)",
    );
    expect(sql).toContain("STORED AS PARQUET");
    expect(sql).toContain("LOCATION 's3://suraj-audit-archive/archive/'");
    expect(sql).toContain("'parquet.compression'='SNAPPY'");
  });

  it("keeps partition columns out of the table body (Hive forbids duplicating them)", () => {
    envConfig.AUDIT_ARCHIVE_BUCKET = "b";

    const body = buildCreateTableSql().split("PARTITIONED BY")[0];

    expect(body).not.toContain("`year`");
    expect(body).not.toContain("`month`");
    expect(body).not.toContain("`day`");
  });

  it("normalizes stray/internal slashes in the prefix to a single-segment LOCATION", () => {
    envConfig.AUDIT_ARCHIVE_BUCKET = "b";
    AUDIT_CONSTANTS.archivePrefix = "/archive//nested/";

    expect(buildCreateTableSql()).toContain(
      "LOCATION 's3://b/archive/nested/'",
    );
  });

  it("collapses an empty / slash-only prefix to s3://bucket/ (no double slash)", () => {
    envConfig.AUDIT_ARCHIVE_BUCKET = "b";
    AUDIT_CONSTANTS.archivePrefix = "///";

    const sql = buildCreateTableSql();

    expect(sql).toContain("LOCATION 's3://b/'");
    expect(sql).not.toContain("s3://b//");
  });

  it("throws a clear error when AUDIT_ARCHIVE_BUCKET is absent", () => {
    envConfig.AUDIT_ARCHIVE_BUCKET = undefined;

    expect(() => buildCreateTableSql()).toThrow(
      /AUDIT_ARCHIVE_BUCKET is not set/,
    );
  });

  it("rejects a table name with SQL-breaking characters", () => {
    envConfig.AUDIT_ARCHIVE_BUCKET = "b";
    AUDIT_CONSTANTS.archiveGlueTable = "audit`;DROP";

    expect(() => buildCreateTableSql()).toThrow(
      /archiveGlueTable .* not a valid table identifier/,
    );
  });

  it("rejects a bucket/prefix that would break the LOCATION literal", () => {
    envConfig.AUDIT_ARCHIVE_BUCKET = "b';DROP";

    expect(() => buildCreateTableSql()).toThrow(
      /AUDIT_ARCHIVE_BUCKET .* invalid in an S3 location/,
    );
  });
});

describe("createArchiveTable — Glue-DB cross-check (review patch)", () => {
  const origDb = envConfig.ATHENA_DATABASE;
  const origGlueDb = envConfig.AUDIT_ARCHIVE_GLUE_DB;
  const origBucket = envConfig.AUDIT_ARCHIVE_BUCKET;

  afterEach(() => {
    envConfig.ATHENA_DATABASE = origDb;
    envConfig.AUDIT_ARCHIVE_GLUE_DB = origGlueDb;
    envConfig.AUDIT_ARCHIVE_BUCKET = origBucket;
    (athenaProvider.runQuery as any).mockClear?.();
  });

  it("throws (no query) when AUDIT_ARCHIVE_GLUE_DB diverges from ATHENA_DATABASE", async () => {
    envConfig.ATHENA_DATABASE = "audit_archive_db";
    envConfig.AUDIT_ARCHIVE_GLUE_DB = "some_other_db";
    envConfig.AUDIT_ARCHIVE_BUCKET = "suraj-audit-archive";
    (athenaProvider.runQuery as any).mockClear?.();

    await expect(createArchiveTable()).rejects.toThrow(
      /AUDIT_ARCHIVE_GLUE_DB .* must match ATHENA_DATABASE/,
    );
    expect(athenaProvider.runQuery).not.toHaveBeenCalled();
  });

  it("runs the CREATE TABLE then introspects the schema", async () => {
    envConfig.ATHENA_DATABASE = "audit_archive_db";
    envConfig.AUDIT_ARCHIVE_GLUE_DB = "audit_archive_db";
    envConfig.AUDIT_ARCHIVE_BUCKET = "suraj-audit-archive";
    (athenaProvider.runQuery as any).mockClear?.();

    await createArchiveTable();

    // 1) CREATE TABLE, 2) information_schema.columns drift check.
    expect(athenaProvider.runQuery).toHaveBeenCalledTimes(2);
    const createSql = (athenaProvider.runQuery as any).mock
      .calls[0][0] as string;
    expect(createSql).toContain(
      "CREATE EXTERNAL TABLE IF NOT EXISTS `audit_archive`",
    );
    const introspectSql = (athenaProvider.runQuery as any).mock
      .calls[1][0] as string;
    expect(introspectSql).toContain("information_schema.columns");
    expect(introspectSql).toContain("table_name = 'audit_archive'");
  });

  it("throws on schema drift when the live table is missing a column", async () => {
    envConfig.ATHENA_DATABASE = "audit_archive_db";
    envConfig.AUDIT_ARCHIVE_GLUE_DB = "audit_archive_db";
    envConfig.AUDIT_ARCHIVE_BUCKET = "suraj-audit-archive";
    (athenaProvider.runQuery as any).mockClear?.();
    // CREATE (ignored), then an introspection missing `signedsnapshot`.
    (athenaProvider.runQuery as any)
      .mockResolvedValueOnce({ rows: [], truncated: false })
      .mockResolvedValueOnce({
        rows: [{ column_name: "_id" }, { column_name: "timestamp" }],
        truncated: false,
      });

    await expect(createArchiveTable()).rejects.toThrow(/schema drift/);
  });
});
