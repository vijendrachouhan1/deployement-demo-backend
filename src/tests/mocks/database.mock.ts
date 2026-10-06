import mongoose from "mongoose";

import { clearTestDB, connectTestDB, disconnectTestDB } from "@/db";
import { drainPendingEmits } from "@/modules/audit-logs/helpers/emit.helper";
import { afterAll, afterEach, beforeAll, inject } from "vitest";

beforeAll(async () => {
  const uri = inject("MONGO_URI");
  const dbName = `test_${process.env.VITEST_POOL_ID ?? "1"}`;
  await connectTestDB(uri, dbName);

  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
});

afterEach(async () => {
  await drainPendingEmits();
  await clearTestDB();
});

afterAll(async () => {
  await disconnectTestDB();
});
