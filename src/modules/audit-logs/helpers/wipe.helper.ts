import mongoose from "mongoose";

import { connectDB, disconnectDB } from "@/db";
import { SERVER_ENV } from "@/enums";

export const CONFIRM_TOKEN = "I_KNOW_WHAT_I_AM_DOING";
export const AUDIT_COLLECTIONS = [
  "audit_logs",
  "chain_heads",
  "audit_logs_dlq",
] as const;

export class AuditWipeRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuditWipeRefused";
  }
}

function refuseInProduction(): void {
  if (process.env.NODE_ENV === SERVER_ENV.PRODUCTION) {
    throw new AuditWipeRefused(
      "refusing to wipe audit collections in production",
    );
  }
}

export async function wipeAuditCollections(): Promise<void> {
  refuseInProduction();

  const db = mongoose.connection.db;
  if (!db) throw new Error("[audit:wipe] no active mongoose connection");

  const present = new Set(
    (await db.listCollections({}, { nameOnly: true }).toArray()).map(
      (c) => c.name,
    ),
  );

  for (const name of AUDIT_COLLECTIONS) {
    if (!present.has(name)) {
      console.log(`[audit:wipe] ${name}: not present, skipping`);
      continue;
    }
    const count = await db.collection(name).countDocuments();
    console.log(`[audit:wipe] ${name}: ${count} rows`);
    await db.dropCollection(name);
    console.log(`[audit:wipe] ${name}: dropped`);
  }
}

export async function runWipeCli(): Promise<void> {
  refuseInProduction();

  if (process.env.AUDIT_WIPE_CONFIRM !== CONFIRM_TOKEN) {
    throw new AuditWipeRefused(
      `set AUDIT_WIPE_CONFIRM=${CONFIRM_TOKEN} to proceed`,
    );
  }
  await connectDB();
  try {
    await wipeAuditCollections();
  } finally {
    await disconnectDB();
  }
}
