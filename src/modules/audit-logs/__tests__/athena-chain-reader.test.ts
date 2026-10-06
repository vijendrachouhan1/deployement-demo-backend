import { afterEach, describe, expect, it, vi } from "vitest";

import envConfig from "@/config/env";
import { AUDIT_CONSTANTS } from "@/providers/audit-logs/utils/audit.constant";
import {
  athenaChainReader,
  buildColdChainQuery,
  buildColdCountQuery,
} from "@/providers/audit-logs/athena-chain-reader";
import type { IColdChainRow } from "@/providers/audit-logs/utils/audit-provider.types";
import { athenaProvider } from "@/providers/audit-logs/athena.provider";
import {
  SystemSubsystem,
  SYSTEM_SUBSYSTEM_REFS,
} from "@/db/plugins/audit/utils/subsystem";

// athenaProvider resolves to the global test mock (tests/setup.ts) — the reader
// is exercised against controllable runQuery / streamQueryRows.
const runQuery = athenaProvider.runQuery as ReturnType<typeof vi.fn>;
const streamQueryRows = athenaProvider.streamQueryRows as ReturnType<
  typeof vi.fn
>;

const HEX = "a1b2c3d4e5f6a1b2c3d4e5f6";

async function collect(
  iter: AsyncIterable<IColdChainRow>,
): Promise<IColdChainRow[]> {
  const out: IColdChainRow[] = [];
  for await (const row of iter) out.push(row);
  return out;
}

describe("buildColdChainQuery / buildColdCountQuery", () => {
  it("builds the chain-order SELECT against the configured table with a quoted hex ref", () => {
    const sql = buildColdChainQuery(HEX);
    expect(sql).toContain(
      "SELECT _id, timestamp, _sig, _prevSig, signedSnapshot",
    );
    expect(sql).toContain(`FROM "${AUDIT_CONSTANTS.archiveGlueTable}"`);
    expect(sql).toContain(`WHERE companyRef = '${HEX}'`);
    expect(sql).toContain("ORDER BY timestamp ASC, _id ASC");
  });

  it("resolves a SYSTEM:<subsystem> ref to its sentinel hex", () => {
    const sql = buildColdChainQuery("SYSTEM:auth");
    const sentinel = SYSTEM_SUBSYSTEM_REFS[SystemSubsystem.AUTH].toHexString();
    expect(sql).toContain(`WHERE companyRef = '${sentinel}'`);
  });

  it("fails closed on a ref that does not resolve to 24-hex (SQL-interpolation guard)", () => {
    expect(() => buildColdChainQuery("xyz")).toThrow(/did not resolve/);
    expect(() => buildColdCountQuery("'; DROP TABLE x; --")).toThrow(
      /did not resolve/,
    );
  });

  it("builds a COUNT(*) query aliased as cnt", () => {
    expect(buildColdCountQuery(HEX)).toContain("SELECT COUNT(*) AS cnt");
  });
});

describe("athenaChainReader.streamColdChain", () => {
  it("normalizes Athena's lowercase-folded columns into cold chain rows", async () => {
    streamQueryRows.mockImplementationOnce(async function* () {
      yield [
        {
          _id: "f1e2d3c4b5a6f1e2d3c4b5a6",
          timestamp: "2026-05-15 12:34:56.789",
          _sig: "sig-1",
          _prevsig: "ROOT",
          signedsnapshot: '{"a":1}',
        },
        {
          // Mixed-case labels must normalize the same way.
          _ID: "f1e2d3c4b5a6f1e2d3c4b5a7",
          TIMESTAMP: "2026-05-15 12:34:56.999",
          _SIG: "sig-2",
          _PrevSig: "sig-1",
          _CanonicalPayload: '{"a":2}',
        },
      ];
    });

    const rows = await collect(athenaChainReader.streamColdChain(HEX));

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      entryId: "f1e2d3c4b5a6f1e2d3c4b5a6",
      sig: "sig-1",
      prevSig: "ROOT",
      signedSnapshot: '{"a":1}',
    });
    expect(rows[0].timestamp.getTime()).toBe(
      Date.UTC(2026, 4, 15, 12, 34, 56, 789),
    );
    expect(rows[1]).toMatchObject({
      entryId: "f1e2d3c4b5a6f1e2d3c4b5a7",
      sig: "sig-2",
      prevSig: "sig-1",
    });
  });

  it("yields null signedSnapshot when the column is NULL (verifier records the break)", async () => {
    streamQueryRows.mockImplementationOnce(async function* () {
      yield [
        {
          _id: "f1e2d3c4b5a6f1e2d3c4b5a6",
          timestamp: "2026-05-15 12:34:56.789",
          _sig: "sig-1",
          _prevsig: "ROOT",
          signedsnapshot: undefined,
        },
      ];
    });

    const rows = await collect(athenaChainReader.streamColdChain(HEX));
    expect(rows[0].signedSnapshot).toBeNull();
  });

  it("carries the predecessor's timestamp for an unparseable rendering and flags the row (never epoch)", async () => {
    streamQueryRows.mockImplementationOnce(async function* () {
      yield [
        {
          _id: "f1e2d3c4b5a6f1e2d3c4b5a6",
          timestamp: "2026-05-15 12:34:56.789",
          _sig: "sig-1",
          _prevsig: "ROOT",
          signedsnapshot: "{}",
        },
        {
          _id: "f1e2d3c4b5a6f1e2d3c4b5a7",
          timestamp: "not-a-date",
          _sig: "sig-2",
          _prevsig: "sig-1",
          signedsnapshot: "{}",
        },
      ];
    });

    const rows = await collect(athenaChainReader.streamColdChain(HEX));
    expect(rows).toHaveLength(2);
    // Adjacent to its predecessor in merge order — not front-sorted to epoch.
    expect(rows[1].timestamp.getTime()).toBe(rows[0].timestamp.getTime());
    expect(rows[1].timestampUnparseable).toBe(true);
    expect(rows[0].timestampUnparseable).toBeUndefined();
  });

  it("falls back to epoch only when the FIRST row's timestamp is unparseable", async () => {
    streamQueryRows.mockImplementationOnce(async function* () {
      yield [
        {
          _id: "f1e2d3c4b5a6f1e2d3c4b5a6",
          timestamp: "not-a-date",
          _sig: "sig-1",
          _prevsig: "ROOT",
          signedsnapshot: "{}",
        },
      ];
    });

    const rows = await collect(athenaChainReader.streamColdChain(HEX));
    expect(rows[0].timestamp.getTime()).toBe(0);
    expect(rows[0].timestampUnparseable).toBe(true);
  });

  it("fails closed on a missing or malformed _id (pre-revision archive objects)", async () => {
    streamQueryRows.mockImplementationOnce(async function* () {
      yield [
        {
          _id: undefined,
          timestamp: "2026-05-15 12:34:56.789",
          _sig: "sig-1",
          _prevsig: "ROOT",
          signedsnapshot: "{}",
        },
      ];
    });

    await expect(
      collect(athenaChainReader.streamColdChain(HEX)),
    ).rejects.toThrow(/missing\/malformed _id/);
  });

  it("lowercases a non-lowercase _id so the merge tie-break stays hex-ordered", async () => {
    streamQueryRows.mockImplementationOnce(async function* () {
      yield [
        {
          _id: "F1E2D3C4B5A6F1E2D3C4B5A6",
          timestamp: "2026-05-15 12:34:56.789",
          _sig: "sig-1",
          _prevsig: "ROOT",
          signedsnapshot: "{}",
        },
      ];
    });

    const rows = await collect(athenaChainReader.streamColdChain(HEX));
    expect(rows[0].entryId).toBe("f1e2d3c4b5a6f1e2d3c4b5a6");
  });
});

describe("athenaChainReader.countColdChain", () => {
  it("parses the single COUNT row", async () => {
    runQuery.mockResolvedValueOnce({ rows: [{ cnt: "42" }], truncated: false });
    await expect(athenaChainReader.countColdChain(HEX)).resolves.toBe(42);
  });

  it("normalizes an upper-cased label", async () => {
    runQuery.mockResolvedValueOnce({ rows: [{ CNT: "7" }], truncated: false });
    await expect(athenaChainReader.countColdChain(HEX)).resolves.toBe(7);
  });

  it("fails closed on an unparseable or missing COUNT instead of waiving the cap", async () => {
    runQuery.mockResolvedValueOnce({
      rows: [{ cnt: "not-a-number" }],
      truncated: false,
    });
    await expect(athenaChainReader.countColdChain(HEX)).rejects.toThrow(
      /unparseable value/,
    );

    runQuery.mockResolvedValueOnce({ rows: [], truncated: false });
    await expect(athenaChainReader.countColdChain(HEX)).rejects.toThrow(
      /unparseable value/,
    );
  });
});

describe("athenaChainReader.isColdTierConfigured", () => {
  const orig = {
    db: envConfig.ATHENA_DATABASE,
    out: envConfig.ATHENA_OUTPUT_LOCATION,
    bucket: envConfig.AUDIT_ARCHIVE_BUCKET,
  };

  afterEach(() => {
    envConfig.ATHENA_DATABASE = orig.db;
    envConfig.ATHENA_OUTPUT_LOCATION = orig.out;
    envConfig.AUDIT_ARCHIVE_BUCKET = orig.bucket;
  });

  it("requires the full archive surface: database + output location + bucket", () => {
    envConfig.ATHENA_DATABASE = "db";
    envConfig.ATHENA_OUTPUT_LOCATION = "s3://x/y/";
    envConfig.AUDIT_ARCHIVE_BUCKET = "bucket";
    expect(athenaChainReader.isColdTierConfigured()).toBe(true);

    envConfig.AUDIT_ARCHIVE_BUCKET = undefined;
    expect(athenaChainReader.isColdTierConfigured()).toBe(false);

    envConfig.AUDIT_ARCHIVE_BUCKET = "bucket";
    envConfig.ATHENA_DATABASE = undefined;
    expect(athenaChainReader.isColdTierConfigured()).toBe(false);

    envConfig.ATHENA_DATABASE = "db";
    envConfig.ATHENA_OUTPUT_LOCATION = undefined;
    expect(athenaChainReader.isColdTierConfigured()).toBe(false);
  });
});
