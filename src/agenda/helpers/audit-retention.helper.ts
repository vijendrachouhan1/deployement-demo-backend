import { commitBatchToArchive } from "@/modules/audit-logs/helpers/retention/processor.helper";
import { runRetentionSweep } from "@/modules/audit-logs/helpers/retention/sweep.helper";

export async function runAuditRetentionSweep(): Promise<void> {
  try {
    await runRetentionSweep(new Date(), commitBatchToArchive);
  } catch (error) {
    console.error("[audit-retention] sweep failed:", error);
  }
}
