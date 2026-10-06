import {
  AuditWipeRefused,
  runWipeCli,
} from "@/modules/audit-logs/helpers/wipe.helper";

runWipeCli().then(
  () => process.exit(0),
  (err) => {
    if (err instanceof AuditWipeRefused) {
      console.error(`[audit:wipe] refused: ${err.message}`);
    } else {
      console.error("[audit:wipe] failed", err);
    }
    process.exit(1);
  },
);
