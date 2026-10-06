import mongoose from "mongoose";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import "@/tests/mocks/database.mock";

import {
  AUDIT_COLLECTIONS,
  AuditWipeRefused,
  CONFIRM_TOKEN,
  runWipeCli,
  wipeAuditCollections,
} from "@/modules/audit-logs/helpers/wipe.helper";

async function listCollectionNames(): Promise<Set<string>> {
  const db = mongoose.connection.db;
  if (!db) throw new Error("no connection");
  const cols = await db.listCollections({}, { nameOnly: true }).toArray();
  return new Set(cols.map((c) => c.name));
}

describe("scripts/audit-wipe — wipeAuditCollections", () => {
  beforeEach(async () => {
    const db = mongoose.connection.db;
    if (!db) throw new Error("no connection");
    for (const name of AUDIT_COLLECTIONS) {
      const exists = (await db.listCollections({ name }).toArray()).length > 0;
      if (!exists) await db.createCollection(name);
      await db.collection(name).insertOne({ seeded: true, at: new Date() });
    }
  });

  it("drops all three collections when confirm token is set and they are seeded", async () => {
    const before = await listCollectionNames();
    for (const name of AUDIT_COLLECTIONS) {
      expect(before.has(name)).toBe(true);
    }

    await wipeAuditCollections();

    const after = await listCollectionNames();
    for (const name of AUDIT_COLLECTIONS) {
      expect(after.has(name)).toBe(false);
    }
  });
});

describe("scripts/audit-wipe — runWipeCli confirm gate", () => {
  const originalEnv = process.env.AUDIT_WIPE_CONFIRM;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.AUDIT_WIPE_CONFIRM;
    } else {
      process.env.AUDIT_WIPE_CONFIRM = originalEnv;
    }
  });

  it("rejects with AuditWipeRefused when confirm env var is missing", async () => {
    delete process.env.AUDIT_WIPE_CONFIRM;

    const db = mongoose.connection.db;
    if (!db) throw new Error("no connection");
    await db.createCollection("audit_logs").catch(() => undefined);
    await db.collection("audit_logs").insertOne({ canary: true });

    await expect(runWipeCli()).rejects.toBeInstanceOf(AuditWipeRefused);

    const names = await listCollectionNames();
    expect(names.has("audit_logs")).toBe(true);
    const remaining = await db.collection("audit_logs").countDocuments();
    expect(remaining).toBe(1);
  });

  it("rejects with AuditWipeRefused when confirm env var is set to a wrong value", async () => {
    process.env.AUDIT_WIPE_CONFIRM = "nope";

    await expect(runWipeCli()).rejects.toBeInstanceOf(AuditWipeRefused);
  });

  it("exposes CONFIRM_TOKEN constant matching documented sentinel", () => {
    expect(CONFIRM_TOKEN).toBe("I_KNOW_WHAT_I_AM_DOING");
  });
});
