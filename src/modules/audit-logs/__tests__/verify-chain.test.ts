import mongoose from "mongoose";
import { beforeEach, describe, expect, it } from "vitest";

import "@/tests/mocks/database.mock";

import { AUDIT_CONSTANTS } from "@/providers/audit-logs/utils/audit.constant";
import { AuditLogModel } from "@/db/models/audit-logs/audit-log";
import { ChainHeadModel } from "@/db/models/audit-logs/chain-head";
import { USER_TYPE } from "@/enums";
import { appendAuditLog } from "@/db/plugins/audit/append-audit-log";
import type { IColdChainRow } from "@/providers/audit-logs/utils/audit-provider.types";
import { mongoAuditProvider } from "@/providers/audit-logs/mongo.provider";
import { verifyChain } from "@/modules/audit-logs/helpers/verify/verify-chain.helper";
import { ChainTooLargeError } from "@/modules/audit-logs/helpers/verify/chain-walker.helper";
import type { ColdChainReader } from "@/modules/audit-logs/utils/verify.types";
import type { IAuditStorageProvider } from "@/providers/audit-logs/utils/audit-provider.types";
import { AuditCategory, AuditStatus } from "@/enums/audit.enum";
import { SystemSubsystem } from "@/db/plugins/audit/utils/subsystem";

function makeSkeleton(overrides: Record<string, unknown> = {}) {
  return {
    category: AuditCategory.ADMIN_ACTION,
    action: "user.update",
    status: AuditStatus.SUCCESS,
    targetType: null,
    targetId: null,
    requestId: null,
    target: { label: null },
    context: { ip: null, userAgent: null, path: null, method: null },
    retentionDays: null,
    ...overrides,
  };
}

function makePrincipal(companyRef = new mongoose.Types.ObjectId()) {
  return {
    _id: new mongoose.Types.ObjectId(),
    companyRef,
    role: USER_TYPE.ADMIN,
    email: "admin@acme.test",
    name: "Admin Alice",
  };
}

// Genuine signed chain through the real emit pipeline; tampering happens
// afterwards via direct model writes (bypassing the pipeline, by design).
async function seedChain(companyRef: mongoose.Types.ObjectId, n: number) {
  const principal = makePrincipal(companyRef);
  for (let i = 0; i < n; i++) {
    await appendAuditLog(
      makeSkeleton({ action: `evt.${i}` }),
      principal,
      null,
      {
        throwOnFailure: true,
      },
    );
  }
  return AuditLogModel.find({ companyRef })
    .sort({ timestamp: 1, _id: 1 })
    .lean();
}

describe("verifyChain", () => {
  beforeEach(async () => {
    await AuditLogModel.deleteMany({});
    await ChainHeadModel.deleteMany({});
  });

  it("reports a clean chain with totals, bounds, and verified genesis", async () => {
    const companyRef = new mongoose.Types.ObjectId();
    const rows = await seedChain(companyRef, 5);

    const report = await verifyChain(companyRef.toString());

    expect(report).toMatchObject({
      companyRef: companyRef.toString(),
      totalEntries: 5,
      breaksFound: 0,
      breaks: [],
      status: "clean",
    });
    expect(report.firstEntry).toEqual(rows[0].timestamp);
    expect(report.lastEntry).toEqual(rows[4].timestamp);
    expect(report.verifiedAt).toBeInstanceOf(Date);
    expect(report.anchorUnverified).toBeUndefined();
  });

  it("returns an empty clean report for a chain with no rows", async () => {
    const report = await verifyChain(new mongoose.Types.ObjectId().toString());

    expect(report).toMatchObject({
      totalEntries: 0,
      breaksFound: 0,
      breaks: [],
      firstEntry: null,
      lastEntry: null,
      status: "clean",
    });
  });

  it("records a signature break for a tampered field (legacy row, no stored payload)", async () => {
    const companyRef = new mongoose.Types.ObjectId();
    const rows = await seedChain(companyRef, 3);
    await AuditLogModel.updateOne(
      { _id: rows[1]._id },
      { $set: { action: "evil.rewrite" }, $unset: { signedSnapshot: 1 } },
    );

    const report = await verifyChain(companyRef.toString());

    expect(report.status).toBe("tampered");
    expect(report.breaksFound).toBe(1);
    expect(report.breaks[0]).toMatchObject({
      entryId: rows[1]._id.toString(),
      position: 1,
      tier: "hot",
      type: "signature",
    });
    expect(report.breaks[0].actual).toBe(rows[1]._sig);
    expect(report.breaks[0].expected).not.toBe(rows[1]._sig);
  });

  it("records BOTH signature and payload_drift breaks when a payload-bearing row's field is tampered", async () => {
    const companyRef = new mongoose.Types.ObjectId();
    const rows = await seedChain(companyRef, 3);
    await AuditLogModel.updateOne(
      { _id: rows[1]._id },
      { $set: { action: "evil.rewrite" } },
    );

    const report = await verifyChain(companyRef.toString());

    expect(report.status).toBe("tampered");
    const types = report.breaks
      .filter((b) => b.entryId === rows[1]._id.toString())
      .map((b) => b.type)
      .sort();
    expect(types).toEqual(["payload_drift", "signature"]);
  });

  it("records a payload_drift break when only the stored signedSnapshot is poisoned (sig still verifies)", async () => {
    const companyRef = new mongoose.Types.ObjectId();
    const rows = await seedChain(companyRef, 3);
    await AuditLogModel.updateOne(
      { _id: rows[2]._id },
      { $set: { signedSnapshot: '{"poisoned":true}' } },
    );

    const report = await verifyChain(companyRef.toString());

    expect(report.status).toBe("tampered");
    expect(report.breaksFound).toBe(1);
    expect(report.breaks[0]).toMatchObject({
      entryId: rows[2]._id.toString(),
      position: 2,
      tier: "hot",
      type: "payload_drift",
      actual: '{"poisoned":true}',
    });
  });

  it("records a linkage break at the successor when a middle row is deleted", async () => {
    const companyRef = new mongoose.Types.ObjectId();
    const rows = await seedChain(companyRef, 5);
    await AuditLogModel.deleteOne({ _id: rows[2]._id });

    const report = await verifyChain(companyRef.toString());

    expect(report.status).toBe("tampered");
    expect(report.totalEntries).toBe(4);
    expect(report.breaksFound).toBe(1);
    expect(report.breaks[0]).toMatchObject({
      entryId: rows[3]._id.toString(),
      position: 2, // walk position of the successor after the deletion
      expected: rows[1]._sig, // the row it now follows in walk order
      actual: rows[2]._sig, // its stored _prevSig still points at the deleted row
      tier: "hot",
      type: "linkage",
    });
  });

  it("verifies a legacy row without signedSnapshot via recompute (clean)", async () => {
    const companyRef = new mongoose.Types.ObjectId();
    const rows = await seedChain(companyRef, 3);
    await AuditLogModel.updateOne(
      { _id: rows[1]._id },
      { $unset: { signedSnapshot: 1 } },
    );

    const report = await verifyChain(companyRef.toString());

    expect(report.status).toBe("clean");
    expect(report.totalEntries).toBe(3);
  });

  it("flags a non-ROOT anchor as anchorUnverified (informational, not a break) — the post-retention shape", async () => {
    const companyRef = new mongoose.Types.ObjectId();
    const rows = await seedChain(companyRef, 5);
    // Simulate Epic D retention: the oldest rows were archived out of the hot
    // tier. The oldest remaining row chains back to an archived sig, not ROOT.
    await AuditLogModel.deleteMany({
      _id: { $in: [rows[0]._id, rows[1]._id] },
    });

    const report = await verifyChain(companyRef.toString());

    expect(report.status).toBe("clean");
    expect(report.totalEntries).toBe(3);
    expect(report.breaksFound).toBe(0);
    expect(report.anchorUnverified).toBe(true);
    expect(report.firstEntry).toEqual(rows[2].timestamp);
  });

  it("walks across batch boundaries with linkage intact (small batch size)", async () => {
    const companyRef = new mongoose.Types.ObjectId();
    await seedChain(companyRef, 5);

    const report = await verifyChain(companyRef.toString(), undefined, 2);

    expect(report.status).toBe("clean");
    expect(report.totalEntries).toBe(5);
  });

  it("catches a deletion AT the batch boundary (cross-batch linkage carry)", async () => {
    const companyRef = new mongoose.Types.ObjectId();
    const rows = await seedChain(companyRef, 5);
    // batchSize 2 → batches [r0,r1] [r2,r3] [r4]; deleting r2 breaks the link
    // right at the first batch seam.
    await AuditLogModel.deleteOne({ _id: rows[2]._id });

    const report = await verifyChain(companyRef.toString(), undefined, 2);

    expect(report.status).toBe("tampered");
    expect(report.breaksFound).toBe(1);
    expect(report.breaks[0]).toMatchObject({
      entryId: rows[3]._id.toString(),
      type: "linkage",
    });
  });

  it("throws ChainTooLargeError when the walk exceeds AUDIT_VERIFY_MAX_ROWS mid-stream", async () => {
    const companyRef = new mongoose.Types.ObjectId();
    await seedChain(companyRef, 5);
    const originalCap = AUDIT_CONSTANTS.verifyMaxRows;
    AUDIT_CONSTANTS.verifyMaxRows = 3;
    try {
      await expect(
        verifyChain(companyRef.toString(), undefined, 2),
      ).rejects.toBeInstanceOf(ChainTooLargeError);
    } finally {
      AUDIT_CONSTANTS.verifyMaxRows = originalCap;
    }
  });

  it("walks only the requested tenant's chain (multi-tenant isolation)", async () => {
    const tenantA = new mongoose.Types.ObjectId();
    const tenantB = new mongoose.Types.ObjectId();
    const principalA = makePrincipal(tenantA);
    const principalB = makePrincipal(tenantB);
    // Interleave emits so B's rows sit between A's in global (timestamp, _id) order.
    for (let i = 0; i < 3; i++) {
      await appendAuditLog(
        makeSkeleton({ action: `a.${i}` }),
        principalA,
        null,
        {
          throwOnFailure: true,
        },
      );
      await appendAuditLog(
        makeSkeleton({ action: `b.${i}` }),
        principalB,
        null,
        {
          throwOnFailure: true,
        },
      );
    }
    // Tamper tenant B — must not affect tenant A's verdict.
    const bRow = await AuditLogModel.findOne({ companyRef: tenantB }).lean();
    await AuditLogModel.updateOne(
      { _id: bRow!._id },
      { $set: { action: "evil" } },
    );

    const reportA = await verifyChain(tenantA.toString());
    expect(reportA.status).toBe("clean");
    expect(reportA.totalEntries).toBe(3);

    const reportB = await verifyChain(tenantB.toString());
    expect(reportB.status).toBe("tampered");
  });

  it("verifies a SYSTEM:<subsystem> chain (system refs are real chains)", async () => {
    for (let i = 0; i < 3; i++) {
      await appendAuditLog(
        makeSkeleton({
          category: AuditCategory.AUTHENTICATION,
          action: `auth.${i}`,
        }),
        null,
        SystemSubsystem.AUTH,
        { throwOnFailure: true },
      );
    }

    const report = await verifyChain("SYSTEM:auth");

    expect(report.status).toBe("clean");
    expect(report.totalEntries).toBe(3);
    expect(report.companyRef).toBe("SYSTEM:auth");
  });

  it("records a break and keeps walking when a row's signed bytes can't be rebuilt", async () => {
    const companyRef = new mongoose.Types.ObjectId();
    const rows = await seedChain(companyRef, 3);
    // NaN round-trips through BSON as double NaN — deterministic-json refuses it.
    await AuditLogModel.updateOne(
      { _id: rows[1]._id },
      { $set: { metadata: { bad: NaN } } },
    );

    const report = await verifyChain(companyRef.toString());

    expect(report.status).toBe("tampered");
    expect(report.totalEntries).toBe(3); // walk continued past the bad row
    const badBreaks = report.breaks.filter(
      (b) => b.entryId === rows[1]._id.toString(),
    );
    expect(badBreaks.some((b) => b.type === "signature")).toBe(true);
    expect(badBreaks[0].expected).toBe("<signed-bytes-rebuild-failed>");
  });
});

// Map a genuinely-signed hot row to the cold-row shape the Athena reader yields
// — the signatures and canonical bytes are real, so cold verification exercises
// the true algorithm with zero AWS plumbing.
function toColdRow(row: {
  _id: mongoose.Types.ObjectId;
  timestamp: Date;
  _sig: string;
  _prevSig: string;
  signedSnapshot?: string;
}): IColdChainRow {
  return {
    entryId: row._id.toString(),
    timestamp: row.timestamp,
    sig: row._sig,
    prevSig: row._prevSig,
    signedSnapshot: row.signedSnapshot ?? null,
  };
}

function coldReaderFor(rows: IColdChainRow[]): ColdChainReader {
  return async function* () {
    for (const row of rows) yield row;
  };
}

// Simulate the D.6 archive: cold copies exist, hot originals deleted.
async function archiveRows(
  rows: Parameters<typeof toColdRow>[0][],
): Promise<IColdChainRow[]> {
  const cold = rows.map(toColdRow);
  await AuditLogModel.deleteMany({ _id: { $in: rows.map((r) => r._id) } });
  return cold;
}

describe("verifyChain — cross-tier merge (E.3)", () => {
  beforeEach(async () => {
    await AuditLogModel.deleteMany({});
    await ChainHeadModel.deleteMany({});
  });

  it("verifies a clean chain across both tiers (§11.9: oldest hot _prevSig === newest cold _sig)", async () => {
    const companyRef = new mongoose.Types.ObjectId();
    const rows = await seedChain(companyRef, 6);
    const cold = await archiveRows(rows.slice(0, 3));
    // The boundary the §11.9 example describes, by construction:
    expect(rows[3]._prevSig).toBe(cold[2].sig);

    const report = await verifyChain(
      companyRef.toString(),
      undefined,
      undefined,
      coldReaderFor(cold),
    );

    expect(report).toMatchObject({
      totalEntries: 6,
      hotEntries: 3,
      coldEntries: 3,
      coldTier: true,
      breaksFound: 0,
      status: "clean",
    });
    expect(report.firstEntry).toEqual(rows[0].timestamp);
    expect(report.lastEntry).toEqual(rows[5].timestamp);
    expect(report.anchorUnverified).toBeUndefined(); // genesis is in the cold tier
    expect(report.retentionLag).toBeUndefined();
    expect(report.duplicatesSkipped).toBeUndefined();
  });

  it("records a signature break with tier cold for a tampered stored cold payload", async () => {
    const companyRef = new mongoose.Types.ObjectId();
    const rows = await seedChain(companyRef, 5);
    const cold = await archiveRows(rows.slice(0, 3));
    cold[1] = { ...cold[1], signedSnapshot: '{"poisoned":true}' };

    const report = await verifyChain(
      companyRef.toString(),
      undefined,
      undefined,
      coldReaderFor(cold),
    );

    expect(report.status).toBe("tampered");
    expect(report.breaksFound).toBe(1);
    expect(report.breaks[0]).toMatchObject({
      entryId: rows[1]._id.toString(),
      position: 1,
      tier: "cold",
      type: "signature",
      actual: rows[1]._sig,
    });
  });

  it("records a linkage break with tier cold when a cold row is missing mid-span", async () => {
    const companyRef = new mongoose.Types.ObjectId();
    const rows = await seedChain(companyRef, 5);
    const cold = await archiveRows(rows.slice(0, 3));
    cold.splice(1, 1); // drop the middle cold row

    const report = await verifyChain(
      companyRef.toString(),
      undefined,
      undefined,
      coldReaderFor(cold),
    );

    expect(report.status).toBe("tampered");
    expect(report.breaksFound).toBe(1);
    expect(report.breaks[0]).toMatchObject({
      entryId: rows[2]._id.toString(),
      position: 1,
      expected: rows[0]._sig,
      actual: rows[1]._sig,
      tier: "cold",
      type: "linkage",
    });
  });

  it("records a linkage break with tier boundary when the newest cold row is missing (§11.9 boundary tamper)", async () => {
    const companyRef = new mongoose.Types.ObjectId();
    const rows = await seedChain(companyRef, 5);
    const cold = await archiveRows(rows.slice(0, 3));
    cold.pop(); // newest cold row gone → the oldest hot row's anchor dangles

    const report = await verifyChain(
      companyRef.toString(),
      undefined,
      undefined,
      coldReaderFor(cold),
    );

    expect(report.status).toBe("tampered");
    expect(report.breaksFound).toBe(1);
    expect(report.breaks[0]).toMatchObject({
      entryId: rows[3]._id.toString(),
      position: 2,
      expected: rows[1]._sig,
      actual: rows[2]._sig,
      tier: "boundary",
      type: "linkage",
    });
  });

  it("walks a D.6 retention orphan in its true chain position — informational retentionLag, no break", async () => {
    const companyRef = new mongoose.Types.ObjectId();
    const rows = await seedChain(companyRef, 6);
    // D.6 archived rows 0-2 and 4, but row 3 was valid-but-unconvertible and
    // stayed hot — older than the newest cold row.
    const cold = await archiveRows([rows[0], rows[1], rows[2], rows[4]]);

    const report = await verifyChain(
      companyRef.toString(),
      undefined,
      undefined,
      coldReaderFor(cold),
    );

    expect(report.status).toBe("clean");
    expect(report.breaksFound).toBe(0);
    expect(report.totalEntries).toBe(6);
    expect(report.hotEntries).toBe(2);
    expect(report.coldEntries).toBe(4);
    expect(report.retentionLag).toMatchObject({ count: 1 });
    expect(report.retentionLag?.oldestTimestamp).toEqual(rows[3].timestamp);
    expect(report.retentionLag?.newestTimestamp).toEqual(rows[3].timestamp);
  });

  it("skips a row present in BOTH tiers (FR16 crash residue) as duplicatesSkipped, not a break", async () => {
    const companyRef = new mongoose.Types.ObjectId();
    const rows = await seedChain(companyRef, 4);
    // Sweep crashed between checkpoint and delete: rows 0-2 archived, but row 2
    // was never deleted from Mongo — it exists in both tiers.
    const cold = rows.slice(0, 3).map(toColdRow);
    await AuditLogModel.deleteMany({
      _id: { $in: [rows[0]._id, rows[1]._id] },
    });

    const report = await verifyChain(
      companyRef.toString(),
      undefined,
      undefined,
      coldReaderFor(cold),
    );

    expect(report.status).toBe("clean");
    expect(report.breaksFound).toBe(0);
    expect(report.duplicatesSkipped).toBe(1);
    expect(report.totalEntries).toBe(4); // the duplicate counts once
    expect(report.hotEntries).toBe(1);
    expect(report.coldEntries).toBe(3);
  });

  it("records a signature break for a cold row with no stored payload and keeps walking", async () => {
    const companyRef = new mongoose.Types.ObjectId();
    const rows = await seedChain(companyRef, 4);
    const cold = await archiveRows(rows.slice(0, 2));
    cold[0] = { ...cold[0], signedSnapshot: null };

    const report = await verifyChain(
      companyRef.toString(),
      undefined,
      undefined,
      coldReaderFor(cold),
    );

    expect(report.status).toBe("tampered");
    expect(report.totalEntries).toBe(4); // walk continued
    expect(report.breaks[0]).toMatchObject({
      entryId: rows[0]._id.toString(),
      expected: "<no-stored-payload>",
      tier: "cold",
      type: "signature",
    });
  });

  it("throws ChainTooLargeError when the MERGED total exceeds the cap", async () => {
    const companyRef = new mongoose.Types.ObjectId();
    const rows = await seedChain(companyRef, 5);
    const cold = await archiveRows(rows.slice(0, 3));
    const originalCap = AUDIT_CONSTANTS.verifyMaxRows;
    AUDIT_CONSTANTS.verifyMaxRows = 4; // 3 cold + 2 hot = 5 > 4
    try {
      await expect(
        verifyChain(
          companyRef.toString(),
          undefined,
          undefined,
          coldReaderFor(cold),
        ),
      ).rejects.toBeInstanceOf(ChainTooLargeError);
    } finally {
      AUDIT_CONSTANTS.verifyMaxRows = originalCap;
    }
  });

  it("does NOT skip a forged row wearing the previous row's _sig (different id) — breaks surface", async () => {
    const companyRef = new mongoose.Types.ObjectId();
    const rows = await seedChain(companyRef, 4);
    const cold = await archiveRows(rows.slice(0, 3));
    // Injection: copy the newest cold row's sig badge onto a forged row with
    // its own id and payload, placed adjacent to its victim.
    const forged: IColdChainRow = {
      entryId: "ffffffffffffffffffffffff",
      timestamp: cold[2].timestamp,
      sig: cold[2].sig,
      prevSig: "FORGED",
      signedSnapshot: '{"forged":true}',
    };
    const coldWithForgery = [...cold, forged];

    const report = await verifyChain(
      companyRef.toString(),
      undefined,
      undefined,
      coldReaderFor(coldWithForgery),
    );

    expect(report.status).toBe("tampered");
    expect(report.duplicatesSkipped).toBeUndefined();
    const forgedBreaks = report.breaks.filter(
      (b) => b.entryId === forged.entryId,
    );
    expect(forgedBreaks.some((b) => b.type === "linkage")).toBe(true);
    expect(forgedBreaks.some((b) => b.type === "signature")).toBe(true);
    // The forgery doesn't cascade: the next real row still chains cleanly.
    expect(
      report.breaks.filter((b) => b.entryId === rows[3]._id.toString()),
    ).toHaveLength(0);
  });

  it("does NOT skip a tampered hot copy of an FR16 residue row (same id + sig, payload fails to verify)", async () => {
    const companyRef = new mongoose.Types.ObjectId();
    const rows = await seedChain(companyRef, 4);
    // FR16 residue: rows 0-2 archived, row 2 also still hot — then the hot
    // copy is tampered. A sig+id match alone would skip it unverified.
    const cold = rows.slice(0, 3).map(toColdRow);
    await AuditLogModel.deleteMany({
      _id: { $in: [rows[0]._id, rows[1]._id] },
    });
    await AuditLogModel.updateOne(
      { _id: rows[2]._id },
      { $set: { action: "evil.rewrite" } },
    );

    const report = await verifyChain(
      companyRef.toString(),
      undefined,
      undefined,
      coldReaderFor(cold),
    );

    expect(report.status).toBe("tampered");
    expect(report.duplicatesSkipped).toBeUndefined();
    expect(
      report.breaks.some(
        (b) => b.entryId === rows[2]._id.toString() && b.type === "signature",
      ),
    ).toBe(true);
  });

  it("records a signature break for an unparseable-timestamp cold row without cascading onto neighbors", async () => {
    const companyRef = new mongoose.Types.ObjectId();
    const rows = await seedChain(companyRef, 4);
    const cold = await archiveRows(rows.slice(0, 3));
    // The reader carries the predecessor's timestamp and flags the row.
    cold[1] = {
      ...cold[1],
      timestamp: cold[0].timestamp,
      timestampUnparseable: true,
    };

    const report = await verifyChain(
      companyRef.toString(),
      undefined,
      undefined,
      coldReaderFor(cold),
    );

    expect(report.status).toBe("tampered");
    expect(report.totalEntries).toBe(4); // walk continued
    expect(report.breaksFound).toBe(1); // the flagged row only — no cascade
    expect(report.breaks[0]).toMatchObject({
      entryId: rows[1]._id.toString(),
      position: 1,
      expected: "<unparseable-timestamp>",
      tier: "cold",
      type: "signature",
    });
  });

  it("verifies a fully-archived tenant (0 hot rows) against the chain head via the newest cold sig", async () => {
    const companyRef = new mongoose.Types.ObjectId();
    const rows = await seedChain(companyRef, 3);
    const cold = await archiveRows(rows);

    const report = await verifyChain(
      companyRef.toString(),
      undefined,
      undefined,
      coldReaderFor(cold),
    );

    expect(report.status).toBe("clean");
    expect(report.totalEntries).toBe(3);
    expect(report.hotEntries).toBe(0);
    expect(report.coldEntries).toBe(3);
  });
});

describe("verifyChain — head-anchor cross-check (E.3, closes the E.2 tail-truncation blind spot)", () => {
  beforeEach(async () => {
    await AuditLogModel.deleteMany({});
    await ChainHeadModel.deleteMany({});
  });

  it("detects tail truncation: deleting the newest N rows is no longer a clean report", async () => {
    const companyRef = new mongoose.Types.ObjectId();
    const rows = await seedChain(companyRef, 5);
    await AuditLogModel.deleteMany({
      _id: { $in: [rows[3]._id, rows[4]._id] },
    });

    const report = await verifyChain(
      companyRef.toString(),
      undefined,
      undefined,
      null,
    );

    expect(report.status).toBe("tampered");
    expect(report.breaksFound).toBe(1);
    expect(report.breaks[0]).toMatchObject({
      entryId: rows[2]._id.toString(),
      position: 3,
      expected: rows[2]._sig,
      actual: rows[4]._sig, // the head still points at the truncated tail
      tier: "hot",
      type: "head",
    });
  });

  it("records a head break when rows exist but the chain-head doc is missing", async () => {
    const companyRef = new mongoose.Types.ObjectId();
    const rows = await seedChain(companyRef, 3);
    await ChainHeadModel.deleteMany({});

    const report = await verifyChain(
      companyRef.toString(),
      undefined,
      undefined,
      null,
    );

    expect(report.status).toBe("tampered");
    expect(report.breaks[0]).toMatchObject({
      expected: rows[2]._sig,
      actual: "<missing-chain-head>",
      tier: "hot",
      type: "head",
    });
  });

  it("records a head break when a head exists but the chain has zero rows", async () => {
    const companyRef = new mongoose.Types.ObjectId();
    const rows = await seedChain(companyRef, 1);
    await AuditLogModel.deleteMany({ companyRef });

    const report = await verifyChain(
      companyRef.toString(),
      undefined,
      undefined,
      null,
    );

    expect(report.status).toBe("tampered");
    expect(report.totalEntries).toBe(0);
    expect(report.breaks[0]).toMatchObject({
      entryId: "CHAIN_HEAD",
      position: 0,
      expected: "<no-rows-walked>",
      actual: rows[0]._sig,
      type: "head",
    });
  });

  it("records a head break even when the wiped chain's head was reset to ROOT (no rowless head is legitimate)", async () => {
    const companyRef = new mongoose.Types.ObjectId();
    await seedChain(companyRef, 2);
    await AuditLogModel.deleteMany({ companyRef });
    await ChainHeadModel.updateOne(
      { _id: companyRef },
      { $set: { lastSig: "ROOT" } },
    );

    const report = await verifyChain(
      companyRef.toString(),
      undefined,
      undefined,
      null,
    );

    expect(report.status).toBe("tampered");
    expect(report.totalEntries).toBe(0);
    expect(report.breaks[0]).toMatchObject({
      entryId: "CHAIN_HEAD",
      position: 0,
      expected: "<no-rows-walked>",
      actual: "ROOT",
      type: "head",
    });
  });

  it("tolerates a mid-walk emit: the tail re-read absorbs a row that landed after the last batch", async () => {
    const companyRef = new mongoose.Types.ObjectId();
    const principal = makePrincipal(companyRef);
    await seedChain(companyRef, 3);

    // Wrap the provider so a new emit lands right after the walk's final batch
    // — the head is then legitimately ahead of the last walked row.
    let emitted = false;
    const provider: IAuditStorageProvider = {
      ...mongoAuditProvider,
      findChainBatch: async (ref, after, limit) => {
        const batch = await mongoAuditProvider.findChainBatch(
          ref,
          after,
          limit,
        );
        if (!emitted && batch.length > 0 && batch.length < limit) {
          emitted = true;
          await appendAuditLog(
            makeSkeleton({ action: "late.emit" }),
            principal,
            null,
            { throwOnFailure: true },
          );
        }
        return batch;
      },
    };

    const report = await verifyChain(
      companyRef.toString(),
      provider,
      undefined,
      null,
    );

    expect(report.status).toBe("clean");
    expect(report.breaksFound).toBe(0);
    expect(report.totalEntries).toBe(4); // the late row was walked, not flagged
  });

  it("stays clean for an empty chain with no head", async () => {
    const report = await verifyChain(
      new mongoose.Types.ObjectId().toString(),
      undefined,
      undefined,
      null,
    );
    expect(report.status).toBe("clean");
    expect(report.totalEntries).toBe(0);
  });
});
