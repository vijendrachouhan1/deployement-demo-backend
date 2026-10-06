# Runbook — Audit-log archive table setup (one-time)

Audit logs live in two tiers: a **hot tier** in Mongo (recent entries) and a
**cold tier** in S3 (older entries, stored as Parquet and queried through
Athena). This runbook creates the Athena/Glue table `audit_archive` that the
cold tier reads from.

Run it **once per environment**, after the AWS infrastructure is provisioned.
The command is idempotent — re-running it is a safe no-op.

> **Pair this with [archive-worm-setup.md](./archive-worm-setup.md).** That runbook configures
> write-once protection and retention on the archive bucket. Without it the archive is deletable,
> and the audit trail is tamper-evident but not tamper-proof. Do both in the same sitting.

## What it does

- Runs `CREATE EXTERNAL TABLE IF NOT EXISTS audit_archive` in the configured
  Glue database. The table has one column per audit-log field, is
  `PARTITIONED BY (year, month, day)`, is `STORED AS PARQUET` with SNAPPY
  compression, and points its `LOCATION` at the archive S3 prefix.

## What it does not do

- It does **not** create any AWS resources (S3 bucket, Glue database, IAM user)
  — those are provisioned separately (see [Prerequisites](#prerequisites)).
- It does **not** write any data or register partitions. The table is empty
  until the archive sweep runs and moves rows from Mongo into S3.

## Prerequisites

The following AWS resources must already exist (all in the **same region**, e.g.
`us-east-2`). The names below are placeholders — substitute your own:

- Glue database — `<glue-database>`
- Archive S3 bucket — `<archive-bucket>` (partition root prefix `archive/`)
- Athena results bucket — `<athena-results-bucket>`, **separate from the archive bucket** (see
  [archive-worm-setup.md](./archive-worm-setup.md) — Object Lock applies bucket-wide, so results
  written inside the archive bucket become undeletable for the whole retention period)
- An IAM user with S3 + Athena + Glue access — provides the shared
  `AWS_USER_KEY` / `AWS_USER_SECRET` (the same credentials S3 and SES use;
  there are no Athena-specific keys)

Then set these environment variables (`.env` or deploy env). They drive both the
`CREATE TABLE` statement and the cold-tier query provider:

```bash
# Credentials come from the shared AWS_USER_KEY / AWS_USER_SECRET (already set
# for S3 + SES) — nothing Athena-specific to add here.
ATHENA_DATABASE=<glue-database>
ATHENA_OUTPUT_LOCATION=s3://<athena-results-bucket>/
ATHENA_REGION=us-east-2

AUDIT_ARCHIVE_BUCKET=<archive-bucket>
AUDIT_ARCHIVE_GLUE_DB=<glue-database>   # optional; if set, must equal ATHENA_DATABASE
```

These variables are optional in the config schema, so deployments that don't use
the archive still boot normally. If they're missing when you run the setup
script, it fails with a clear error naming the missing variable.

> **Which database does the table land in?** The table is created in
> **`ATHENA_DATABASE`** — that is the source of truth. `AUDIT_ARCHIVE_GLUE_DB`
> is a documentation knob; keep it **equal to** `ATHENA_DATABASE`. The script
> refuses to run if the two differ, so you can't accidentally create the table
> in the wrong database.

## Housekeeping — expire temporary audit exports

Separate from the archive: the audit **export** feature writes short-lived
download files to the `audit-exports/` prefix of the **upload** bucket
(`S3_BUCKET_NAME`) — not the archive bucket. Add a one-time S3 lifecycle rule so
they clean themselves up:

- Bucket: your upload bucket (`S3_BUCKET_NAME`)
- Rule name: `expire-audit-exports`
- Scope (prefix filter): `audit-exports/`
- Action: expire current versions of objects **1 day** after creation

Optional — nothing breaks without it — but without it the export files
accumulate in the upload bucket indefinitely.

## Run

```bash
cd boilerplate-backend
npm run audit:archive-setup
```

Expected output on success:

```
[audit:archive-setup] target Glue db: <glue-database>
[audit:archive-setup] CREATE EXTERNAL TABLE IF NOT EXISTS `audit_archive`
[audit:archive-setup] done — idempotent, no-op if the table already existed
```

Exit code `0` on success, `1` on failure (the error is logged).

Because the statement is `CREATE EXTERNAL TABLE IF NOT EXISTS`, re-running it
against an existing table completes without error and changes nothing. It's safe
to run in every environment and to re-run after redeploys.

## Verify

In the Athena console (or via the super-admin Athena endpoint), against your
Glue database (`<glue-database>`):

1. Confirm the columns and partitions exist:

   ```sql
   DESCRIBE audit_archive;
   ```

   You should see the audit-log columns (including `signedSnapshot`) and the
   partition columns `year` / `month` / `day`.

2. Confirm the table is queryable (it's empty until the sweep populates it):

   ```sql
   SELECT * FROM audit_archive LIMIT 1;   -- returns 0 rows, no error
   SHOW PARTITIONS audit_archive;         -- empty until the sweep runs
   ```

A clean `SELECT` that returns no rows (rather than an error) means the table
exists and is correctly pointed at the archive S3 location.

## Recreating the table

`CREATE EXTERNAL TABLE IF NOT EXISTS` will **not** modify an existing table. So
if the column list changes, you must drop and recreate:

```sql
DROP TABLE audit_archive;   -- metadata only; does NOT delete S3 data
```

Then run `npm run audit:archive-setup` again. `DROP TABLE` on an external table
removes only the Glue catalog entry — the underlying S3 objects are never
touched.

### If a column was renamed or added

Parquet files already in S3 carry the **old** column names. After recreating the
table, any row written under the old schema reads the renamed/new column back as
`NULL`, and the cold-tier verifier treats a `NULL` there as an unverifiable
(tampered) row. So a rename/add is a full cold-tier reset:

1. `DROP TABLE audit_archive;` (metadata only).
2. Delete the existing Parquet objects under the archive prefix
   (`s3://$AUDIT_ARCHIVE_BUCKET/archive/`).
3. `npm run audit:archive-setup` — recreates the table with the new columns.
4. Repopulate the archive by running the dev seed script directly
   (`ts-node -r tsconfig-paths/register src/scripts/audit-seed-archive.ts`) or
   let the sweep refill it.

This only applies to dev/test, where mixed-schema partitions are cheap to throw
away. Do a real reset like this only when no production archive data exists.
