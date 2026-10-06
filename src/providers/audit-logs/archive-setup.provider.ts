import envConfig from "@/config/env";

import { AUDIT_CONSTANTS } from "@/providers/audit-logs/utils/audit.constant";
import { athenaProvider } from "@/providers/audit-logs/athena.provider";

export const ARCHIVE_COLUMNS: ReadonlyArray<
  readonly [name: string, type: string]
> = [
  /*
   * Mongo _id as hex. Chain verification orders cold rows by (timestamp, _id),
   * so each row must carry its own id to report a real entryId on a break.
   * Changing this column list means DROPping the audit_archive table and
   * re-running setup — it's metadata only, no row data is lost.
   */
  ["_id", "string"],
  ["timestamp", "timestamp"],
  ["category", "string"],
  ["action", "string"],
  ["status", "string"],
  ["companyRef", "string"],
  ["actorId", "string"],
  ["actorEmail", "string"],
  ["actorRole", "string"],
  ["targetType", "string"],
  ["targetId", "string"],
  ["requestId", "string"],
  // Nested Mongo objects flattened to columns — a Parquet table can't nest.
  ["actor_name", "string"],
  ["actor_impersonatedBy", "string"],
  ["target_label", "string"],
  ["context_ip", "string"],
  ["context_userAgent", "string"],
  ["context_path", "string"],
  ["context_method", "string"],
  ["changes", "string"],
  ["metadata", "string"],
  ["failureReason", "string"],
  ["retentionDays", "int"],
  ["_sig", "string"],
  ["_prevSig", "string"],
  ["subsystemMappingVersion", "int"],
  ["signedSnapshot", "string"],
];

export const SAFE_TABLE = /^[A-Za-z0-9_]+$/;
const SAFE_S3_SEGMENT = /^[A-Za-z0-9._/-]+$/;

const PARTITION_COLUMNS = ["year", "month", "day"] as const;

export function buildArchiveLocationRoot(): string {
  const bucket = envConfig.AUDIT_ARCHIVE_BUCKET;
  if (!bucket) {
    throw new Error(
      "AUDIT_ARCHIVE_BUCKET is not set — cannot build the archive S3 location",
    );
  }
  if (!SAFE_S3_SEGMENT.test(bucket)) {
    throw new Error(
      `AUDIT_ARCHIVE_BUCKET "${bucket}" contains characters invalid in an S3 location`,
    );
  }

  /*
   * Strip leading/trailing slashes and collapse internal runs so an empty or
   * "/"-only prefix yields s3://bucket/ — never s3://bucket//, which S3 reads
   * as a distinct empty path segment.
   */
  const prefix = AUDIT_CONSTANTS.archivePrefix
    .replace(/\/+/g, "/")
    .replace(/^\/|\/$/g, "");
  if (prefix && !SAFE_S3_SEGMENT.test(prefix)) {
    throw new Error(
      `archivePrefix "${prefix}" contains characters invalid in an S3 location`,
    );
  }
  return prefix ? `s3://${bucket}/${prefix}/` : `s3://${bucket}/`;
}

export function buildCreateTableSql(): string {
  const table = AUDIT_CONSTANTS.archiveGlueTable;
  if (!SAFE_TABLE.test(table)) {
    throw new Error(
      `archiveGlueTable "${table}" is not a valid table identifier (expected [A-Za-z0-9_])`,
    );
  }

  const location = buildArchiveLocationRoot();

  const columnLines = ARCHIVE_COLUMNS.map(
    ([name, type]) => `  \`${name}\` ${type}`,
  ).join(",\n");

  return [
    `CREATE EXTERNAL TABLE IF NOT EXISTS \`${table}\` (`,
    columnLines,
    `)`,
    `PARTITIONED BY (\`year\` string, \`month\` string, \`day\` string)`,
    `STORED AS PARQUET`,
    `LOCATION '${location}'`,
    `TBLPROPERTIES ('parquet.compression'='SNAPPY')`,
  ].join("\n");
}

/**
 * One-time setup: create the cold-tier `audit_archive` external table in the
 * configured Glue database. Idempotent (IF NOT EXISTS) — safe to re-run. No
 * Mongo connection: this is pure Athena SQL.
 */
export async function createArchiveTable(): Promise<void> {
  if (!envConfig.ATHENA_DATABASE) {
    throw new Error(
      "ATHENA_DATABASE is not set — the archive table needs a target Glue database",
    );
  }

  if (
    envConfig.AUDIT_ARCHIVE_GLUE_DB &&
    envConfig.AUDIT_ARCHIVE_GLUE_DB !== envConfig.ATHENA_DATABASE
  ) {
    throw new Error(
      `AUDIT_ARCHIVE_GLUE_DB ("${envConfig.AUDIT_ARCHIVE_GLUE_DB}") must match ATHENA_DATABASE ("${envConfig.ATHENA_DATABASE}") — the archive table is created in the ATHENA_DATABASE query context`,
    );
  }

  const createTableSql = buildCreateTableSql();
  console.log(
    `[audit:archive-setup] target Glue db: ${envConfig.ATHENA_DATABASE}`,
  );
  console.log(
    `[audit:archive-setup] CREATE EXTERNAL TABLE IF NOT EXISTS \`${AUDIT_CONSTANTS.archiveGlueTable}\``,
  );

  await athenaProvider.runQuery(createTableSql);

  await assertArchiveSchemaMatches(
    envConfig.ATHENA_DATABASE,
    AUDIT_CONSTANTS.archiveGlueTable,
  );

  console.log("[audit:archive-setup] done — table present and schema verified");
}

function buildSchemaIntrospectionSql(db: string, table: string): string {
  const esc = (value: string) => value.replace(/'/g, "''");
  return (
    `SELECT column_name FROM information_schema.columns` +
    ` WHERE table_schema = '${esc(db)}' AND table_name = '${esc(table)}'`
  );
}

async function assertArchiveSchemaMatches(
  db: string,
  table: string,
): Promise<void> {
  let live: Set<string>;
  try {
    const { rows } = await athenaProvider.runQuery(
      buildSchemaIntrospectionSql(db, table),
    );
    live = new Set(
      rows
        .map((row) => {
          const key = Object.keys(row).find(
            (k) => k.toLowerCase() === "column_name",
          );
          return key ? String(row[key]).toLowerCase() : "";
        })
        .filter(Boolean),
    );
  } catch (err) {
    // Can't read the schema (permissions / metadata lag) — warn, don't block setup.
    console.warn(
      `[audit:archive-setup] could not introspect \`${table}\` to verify schema drift`,
      err,
    );
    return;
  }

  if (live.size === 0) {
    console.warn(
      `[audit:archive-setup] schema introspection for \`${table}\` returned no columns — skipping drift check`,
    );
    return;
  }

  const expected = new Set(
    [...ARCHIVE_COLUMNS.map(([name]) => name), ...PARTITION_COLUMNS].map((n) =>
      n.toLowerCase(),
    ),
  );
  const missing = [...expected].filter((c) => !live.has(c));
  const unexpected = [...live].filter((c) => !expected.has(c));

  if (missing.length || unexpected.length) {
    const detail = [
      missing.length ? `missing [${missing.join(", ")}]` : null,
      unexpected.length ? `unexpected [${unexpected.join(", ")}]` : null,
    ]
      .filter(Boolean)
      .join("; ");
    throw new Error(
      `[audit:archive-setup] \`${table}\` schema drift — ${detail}. CREATE ... IF NOT EXISTS left the stale table untouched; DROP it manually and re-run setup.`,
    );
  }

  console.log(
    `[audit:archive-setup] schema verified — ${live.size} columns match`,
  );
}
