import { createArchiveTable } from "@/providers/audit-logs/archive-setup.provider";

createArchiveTable().then(
  () => process.exit(0),
  (err) => {
    console.error("[audit:archive-setup] failed", err);
    process.exit(1);
  },
);
