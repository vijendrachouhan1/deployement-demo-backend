/*
 * Central tuning knobs for the audit-log subsystem: export/verify rate limits,
 * the inline-verify row ceiling, Athena per-user concurrency, and the S3/Glue
 * names for exports and the cold-tier archive. Change a value here to retune
 * behaviour across the whole subsystem.
 *
 * Deployment-specific settings do NOT belong here — Athena credentials, the Glue
 * database / archive bucket, and the retention window (AUDIT_HOT_WINDOW_DAYS)
 * live in env config because they differ per environment.
 *
 * Not `as const` so tests can override a single field.
 */
export const AUDIT_CONSTANTS = {
  // S3 key prefix for exported audit-log files within the upload bucket.
  exportS3Prefix: "audit-exports",
  // Lifetime of a presigned export-download URL, in seconds.
  exportUrlTtlSeconds: 900,
  // Exports allowed per user per rolling window.
  exportMaxPerWindow: 10,
  // Inline chain-verify runs allowed per user per rolling window.
  verifyMaxPerWindow: 10,
  // Largest chain the API verifies inline; above this it refuses with 413.
  verifyMaxRows: 100000,
  // Concurrent Athena queries a single user may hold at once.
  athenaMaxConcurrentPerUser: 3,
  // Seconds an Athena concurrency slot is held before it is reclaimed.
  athenaSlotTtlSeconds: 90,
  // Partition-root prefix under the archive bucket for cold-tier Parquet.
  archivePrefix: "archive",
  // Glue/Athena external table name for the cold-tier archive.
  archiveGlueTable: "audit_archive",
};
