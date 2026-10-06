import { ParquetReader } from "@dsnp/parquetjs";
import mongoose from "mongoose";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { IAuditLog } from "@/db/models/audit-logs/audit-log";
import { USER_TYPE } from "@/enums";
import { ARCHIVE_COLUMNS } from "@/providers/audit-logs/archive-setup.provider";
import {
  batchToParquet,
  mapRowToArchiveColumns,
} from "@/providers/audit-logs/parquet-archive.provider";
import * as recompute from "@/db/plugins/audit/recompute-signed-bytes";
import { AuditCategory, AuditStatus } from "@/enums/audit.enum";

function makeRow(overrides: Partial<IAuditLog> = {}): IAuditLog {
  return {
    _id: new mongoose.Types.ObjectId(),
    timestamp: new Date("2026-05-15T12:34:56.000Z"),
    category: AuditCategory.ADMIN_ACTION,
    action: "user.update",
    status: AuditStatus.SUCCESS,
    companyRef: new mongoose.Types.ObjectId(),
    actorId: new mongoose.Types.ObjectId(),
    actorEmail: "admin@acme.test",
    actorRole: USER_TYPE.ADMIN,
    targetType: null,
    targetId: null,
    requestId: null,
    _sig: "sig-value",
    _prevSig: "prev-sig-value",
    signedSnapshot: '{"action":"user.update"}',
    subsystemMappingVersion: 1,
    actor: { name: "Admin Alice" },
    target: { label: null },
    context: { ip: null, userAgent: null, path: null, method: null },
    retentionDays: null,
    ...overrides,
  } as IAuditLog;
}

async function readRows(buffer: Buffer): Promise<Record<string, unknown>[]> {
  const reader = await ParquetReader.openBuffer(buffer);
  const cursor = reader.getCursor();
  const rows: Record<string, unknown>[] = [];
  let row: Record<string, unknown> | null;
  while ((row = (await cursor.next()) as Record<string, unknown> | null)) {
    if (Object.keys(row).length === 0) break;
    rows.push(row);
  }
  await reader.close();
  return rows;
}

describe("parquet-archive: schema contract", () => {
  it("schema column names + order match the frozen ARCHIVE_COLUMNS (no drift)", () => {
    const keys = Object.keys(mapRowToArchiveColumns(makeRow()));
    expect(keys).toEqual(ARCHIVE_COLUMNS.map(([name]) => name));
  });

  it("signedSnapshot is the last column (Epic E verification target)", () => {
    const names = ARCHIVE_COLUMNS.map(([name]) => name);
    expect(names[names.length - 1]).toBe("signedSnapshot");
  });

  it("does not include partition columns year/month/day", () => {
    const keys = Object.keys(mapRowToArchiveColumns(makeRow()));
    expect(keys).not.toContain("year");
    expect(keys).not.toContain("month");
    expect(keys).not.toContain("day");
  });
});

describe("parquet-archive: §11.8 mapping (round-trip)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("maps a full row and round-trips every column + the timestamp value (AC1, AC2, AC7)", async () => {
    const companyRef = new mongoose.Types.ObjectId();
    const actorId = new mongoose.Types.ObjectId();
    const targetId = new mongoose.Types.ObjectId();
    const impersonatedBy = new mongoose.Types.ObjectId();
    const ts = new Date("2026-05-15T12:34:56.000Z");

    const row = makeRow({
      timestamp: ts,
      companyRef,
      actorId,
      targetId,
      targetType: "User",
      requestId: "req-1",
      failureReason: "nope",
      actor: { name: "Alice", impersonatedBy },
      target: { label: "Bob" },
      context: {
        ip: "1.2.3.4",
        userAgent: "UA",
        path: "/x",
        method: "POST",
      },
      changes: [{ field: "name", before: "A", after: "B" }],
      metadata: { plan: "pro", seats: 5 },
      retentionDays: 30,
      subsystemMappingVersion: 2,
    });

    const result = await batchToParquet([row]);
    expect(result).not.toBeNull();
    const [decoded] = await readRows(result!.buffer);

    expect(decoded._id).toBe(row._id.toHexString());
    expect(decoded.companyRef).toBe(companyRef.toHexString());
    expect(decoded.actorId).toBe(actorId.toHexString());
    expect(decoded.targetId).toBe(targetId.toHexString());
    expect(decoded.actor_impersonatedBy).toBe(impersonatedBy.toHexString());
    expect(decoded.actor_name).toBe("Alice");
    expect(decoded.target_label).toBe("Bob");
    expect(decoded.context_ip).toBe("1.2.3.4");
    expect(decoded.context_method).toBe("POST");
    expect(decoded.changes).toBe(
      JSON.stringify([{ field: "name", before: "A", after: "B" }]),
    );
    expect(decoded.metadata).toBe(JSON.stringify({ plan: "pro", seats: 5 }));
    expect(decoded.failureReason).toBe("nope");
    expect(decoded.retentionDays).toBe(30);
    expect(decoded.subsystemMappingVersion).toBe(2);
    expect(decoded._sig).toBe("sig-value");
    expect(decoded._prevSig).toBe("prev-sig-value");

    // AC7: timestamp reads back as the same UTC instant.
    expect(decoded.timestamp).toBeInstanceOf(Date);
    expect((decoded.timestamp as Date).toISOString()).toBe(ts.toISOString());

    expect(result!.archivedIds).toEqual([row._id]);
  });

  it("writes null (not the string 'undefined') for absent optional fields", async () => {
    const row = makeRow({
      targetId: null,
      targetType: null,
      requestId: null,
      failureReason: undefined,
      changes: undefined,
      metadata: undefined,
      actorEmail: null,
    });

    const result = await batchToParquet([row]);
    const [decoded] = await readRows(result!.buffer);

    for (const col of [
      "targetId",
      "targetType",
      "requestId",
      "failureReason",
      "changes",
      "metadata",
      "actorEmail",
      "actor_impersonatedBy",
      "target_label",
      "context_ip",
    ]) {
      expect(decoded[col] ?? null).toBeNull();
    }
  });
});

describe("parquet-archive: signedSnapshot (FR13/AC3)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("writes the stored signedSnapshot bytes verbatim (no re-canonicalization)", async () => {
    const spy = vi.spyOn(recompute, "recomputeSignedBytes");
    const row = makeRow({ signedSnapshot: '{"stored":"bytes"}' });

    const result = await batchToParquet([row]);
    const [decoded] = await readRows(result!.buffer);

    expect(decoded.signedSnapshot).toBe('{"stored":"bytes"}');
    expect(spy).not.toHaveBeenCalled();
  });

  it("recomputes signedSnapshot for a legacy row lacking it", async () => {
    const spy = vi
      .spyOn(recompute, "recomputeSignedBytes")
      .mockReturnValue('{"recomputed":true}');
    const legacy = makeRow();
    delete (legacy as { signedSnapshot?: string }).signedSnapshot;

    const result = await batchToParquet([legacy]);
    const [decoded] = await readRows(result!.buffer);

    expect(spy).toHaveBeenCalledOnce();
    expect(decoded.signedSnapshot).toBe('{"recomputed":true}');
  });
});

describe("parquet-archive: per-row skip + empty (FR17/AC5, AC6)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("skips a row that throws during mapping and ships the rest", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const good1 = makeRow();
    const bad = makeRow();
    const good2 = makeRow();

    // Force the bad row's canonical recompute to throw; the good rows carry a
    // stored payload so they never hit the helper.
    delete (bad as { signedSnapshot?: string }).signedSnapshot;
    vi.spyOn(recompute, "recomputeSignedBytes").mockImplementation(() => {
      throw new Error("corrupt row");
    });

    const result = await batchToParquet([good1, bad, good2]);
    expect(result).not.toBeNull();

    const rows = await readRows(result!.buffer);
    expect(rows).toHaveLength(2);
    expect(result!.archivedIds).toEqual([good1._id, good2._id]);
    expect(result!.archivedIds).not.toContainEqual(bad._id);
  });

  it("returns null for an empty batch (AC6)", async () => {
    expect(await batchToParquet([])).toBeNull();
  });

  it("returns null when every row is skipped (AC6)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(recompute, "recomputeSignedBytes").mockImplementation(() => {
      throw new Error("all corrupt");
    });
    const rows = [makeRow(), makeRow()].map((r) => {
      delete (r as { signedSnapshot?: string }).signedSnapshot;
      return r;
    });
    expect(await batchToParquet(rows)).toBeNull();
  });
});
