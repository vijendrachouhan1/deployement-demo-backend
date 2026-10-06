import type mongoose from "mongoose";

import type { IAuditLog } from "@/db/models/audit-logs/audit-log";

export type RetentionBatchProcessor = (
  batch: IAuditLog[],
  meta: {
    batchIndex: number;
    firstId: mongoose.Types.ObjectId;
    lastId: mongoose.Types.ObjectId;
  },
) => Promise<void>;
