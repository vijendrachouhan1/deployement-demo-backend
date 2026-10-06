import { connectDB, disconnectDB } from "@/db";
import envConfig from "@/config/env";
import { AUDIT_CONSTANTS } from "@/providers/audit-logs/utils/audit.constant";
import { commitBatchToArchive } from "@/modules/audit-logs/helpers/retention/processor.helper";
import { runRetentionSweep } from "@/modules/audit-logs/helpers/retention/sweep.helper";

/**
 * Dev-only: run the nightly retention sweep once, immediately, with the real
 * archive processor (Mongo → Parquet → S3 → partition registration → delete).
 * Same code path as the 02:00 cron — errors propagate instead of being
 * swallowed so a failed run exits non-zero.
 */
async function sweepOnce(): Promise<void> {
  if (process.env.NODE_ENV === "production") {
    throw new Error("refusing to run a manual sweep in production");
  }
  if (!envConfig.AUDIT_ARCHIVE_BUCKET) {
    throw new Error(
      "AUDIT_ARCHIVE_BUCKET is not set — the sweep would run as a no-op. Configure the archive env vars first.",
    );
  }

  await connectDB();
  console.log(
    `[audit:sweep-once] sweeping rows older than ${envConfig.AUDIT_HOT_WINDOW_DAYS} days into s3://${envConfig.AUDIT_ARCHIVE_BUCKET}/${AUDIT_CONSTANTS.archivePrefix}/`,
  );

  await runRetentionSweep(new Date(), commitBatchToArchive);

  console.log("[audit:sweep-once] sweep complete");
  await disconnectDB();
}

sweepOnce().then(
  () => process.exit(0),
  (err) => {
    console.error(
      "[audit:sweep-once] FAILED:",
      err instanceof Error ? err.message : err,
    );
    process.exit(1);
  },
);
