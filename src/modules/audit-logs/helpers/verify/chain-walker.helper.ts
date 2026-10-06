import type { IAuditLog } from "@/db/models/audit-logs/audit-log";
import type { IColdChainRow } from "@/providers/audit-logs/utils/audit-provider.types";
import type {
  IChainBreak,
  IChainVerifyReport,
  IHotWalkRow,
  IColdWalkRow,
  IWalkRow,
} from "@/modules/audit-logs/utils/verify.types";
import {
  HASH_INPUT_SEPARATOR,
  ROOT_SIG,
} from "@/db/plugins/audit/utils/chain.constant";
import { recomputeSignedBytes } from "@/db/plugins/audit/recompute-signed-bytes";
import { sha256 } from "@/db/plugins/audit/utils/sha256";
import type { IChainBatchCursor } from "@/providers/audit-logs/utils/audit-provider.types";

// Breaks can embed signed payloads (KBs each) — bound what the report carries.
const PAYLOAD_PREVIEW_CHARS = 256;

/**
 * Thrown when the walk hits AUDIT_CONSTANTS.verifyMaxRows mid-stream (the chain grew
 * past the pre-walk estimate). The controller maps it to the same 413 refusal
 * as the estimate guard — a partial report would read as a verified chain.
 */
export class ChainTooLargeError extends Error {
  constructor(companyRef: string, cap: number) {
    super(
      `Chain for ${companyRef} exceeded the inline verify cap (${cap} rows) during the walk. Offline verification is not available.`,
    );
    this.name = "ChainTooLargeError";
  }
}

export function normalizeHot(row: IAuditLog): IHotWalkRow {
  const idHex = row._id.toString();
  return {
    entryId: idHex,
    idHex,
    mongoId: row._id,
    timestamp: row.timestamp,
    sig: row._sig,
    prevSig: row._prevSig,
    tier: "hot",
    hotRow: row,
    storedPayload: row.signedSnapshot ?? null,
  };
}

export function normalizeCold(row: IColdChainRow): IColdWalkRow {
  return {
    entryId: row.entryId,
    idHex: row.entryId,
    mongoId: null,
    timestamp: row.timestamp,
    sig: row.sig,
    prevSig: row.prevSig,
    tier: "cold",
    hotRow: null,
    storedPayload: row.signedSnapshot,
    ...(row.timestampUnparseable
      ? { timestampUnparseable: true as const }
      : {}),
  };
}

/*
 * Unified chain order across tiers: (timestamp, _id-hex). Fixed-length hex
 * compares lexicographically == numerically. Ties return 0 and the merge takes
 * cold first, so a both-tiers duplicate meets its cold twin before its hot copy.
 */
export function compareRows(a: IWalkRow, b: IWalkRow): number {
  const dt = a.timestamp.getTime() - b.timestamp.getTime();
  if (dt !== 0) return dt;
  if (a.idHex < b.idHex) return -1;
  if (a.idHex > b.idHex) return 1;
  return 0;
}

/**
 * Accumulates the cross-tier walk: the caller feeds rows in unified chain order
 * via `process()`, the walker verifies each one and records any breaks, and
 * `buildReport()` returns the final tamper-evidence report. Holds all the
 * running state (counts, previous-row carry, retention lag) so the orchestrator
 * stays a thin loop.
 */
export class ChainWalker {
  private readonly breaks: IChainBreak[] = [];
  private totalEntries = 0;
  private hotEntries = 0;
  private coldEntries = 0;
  private duplicatesSkipped = 0;
  private firstEntry: Date | null = null;
  private lastEntry: Date | null = null;
  private anchorUnverified = false;
  private prevSig: string | null = null;
  private prevTier: "hot" | "cold" | null = null;
  private prevIdHex: string | null = null;
  private prevRowPrevSig: string | null = null;
  private lastEntryId: string | null = null;
  private lastHotCursor: IChainBatchCursor | null = null;
  private retentionLagCount = 0;
  private retentionLagOldest: Date | null = null;
  private retentionLagNewest: Date | null = null;

  constructor(
    private readonly companyRef: string,
    private readonly maxRows: number,
  ) {}

  get lastSig(): string | null {
    return this.prevSig;
  }

  get rowCount(): number {
    return this.totalEntries;
  }

  get hotCursor(): IChainBatchCursor | null {
    return this.lastHotCursor;
  }

  process(row: IWalkRow, coldPending: boolean): void {
    /*
     * Both-tiers crash residue: the same chain entry in both tiers (the sweep
     * died between checkpoint advance and Mongo delete) — skip the verified
     * twin, never a break. (A legit chain can't repeat a _sig: it hashes
     * prevSig + the signed bytes.)
     */
    if (
      this.prevSig !== null &&
      row.sig === this.prevSig &&
      this.isVerifiedTwin(row)
    ) {
      this.duplicatesSkipped += 1;
      if (row.tier === "hot") {
        this.lastHotCursor = { timestamp: row.timestamp, _id: row.mongoId };
      }
      return;
    }

    if (this.totalEntries >= this.maxRows) {
      console.warn(
        `[audit-verify] chain for ${this.companyRef} exceeded the ${this.maxRows}-row cap mid-walk (grew past the pre-walk estimate) — refusing instead of returning a partial report`,
      );
      throw new ChainTooLargeError(this.companyRef, this.maxRows);
    }

    const position = this.totalEntries;

    if (position === 0) {
      this.firstEntry = row.timestamp;
      if (row.prevSig !== ROOT_SIG) {
        this.anchorUnverified = true;
      }
    } else if (row.prevSig !== this.prevSig) {
      this.breaks.push({
        entryId: row.entryId,
        position,
        expected: this.prevSig as string,
        actual: row.prevSig,
        tier: row.tier !== this.prevTier ? "boundary" : row.tier,
        type: "linkage",
      });
    }

    if (row.tier === "cold") {
      this.verifyCold(row, position);
    } else {
      this.verifyHot(row, position);
    }

    if (row.tier === "hot" && coldPending) {
      this.retentionLagCount += 1;
      if (this.retentionLagOldest === null)
        this.retentionLagOldest = row.timestamp;
      this.retentionLagNewest = row.timestamp;
    }

    this.prevSig = row.sig;
    this.prevTier = row.tier;
    this.prevIdHex = row.idHex;
    this.prevRowPrevSig = row.prevSig;
    this.lastEntryId = row.entryId;
    this.lastEntry = row.timestamp;
    if (row.tier === "hot") {
      this.lastHotCursor = { timestamp: row.timestamp, _id: row.mongoId };
      this.hotEntries += 1;
    } else {
      this.coldEntries += 1;
    }
    this.totalEntries += 1;
  }

  /*
   * A skip with no verification would be a tamper blind spot: a forged row
   * wearing the previous row's _sig (a value readable from the chain) would walk
   * straight through. A true twin must PROVE it is the same entry — same id,
   * same _prevSig as the walked twin, and its signature verifies over its OWN
   * bytes. Anything unproven falls through to the normal checks as breaks.
   */
  private isVerifiedTwin(row: IWalkRow): boolean {
    if (row.idHex !== this.prevIdHex || row.prevSig !== this.prevRowPrevSig) {
      return false;
    }
    if (row.tier === "cold") {
      return (
        row.storedPayload !== null &&
        sha256(row.prevSig + HASH_INPUT_SEPARATOR + row.storedPayload) ===
          row.sig
      );
    }
    try {
      const signedBytes = recomputeSignedBytes(row.hotRow);
      return (
        sha256(row.prevSig + HASH_INPUT_SEPARATOR + signedBytes) === row.sig
      );
    } catch {
      return false;
    }
  }

  /*
   * Cold rows verify against the stored signedSnapshot only — the other Athena
   * columns went through Parquet/JSON flattening and can't be re-derived.
   */
  private verifyCold(row: IColdWalkRow, position: number): void {
    if (row.timestampUnparseable) {
      /*
       * The row's merge position came from its predecessor, not its own
       * timestamp rendering — the verifier can't vouch for its chain order, so
       * it records a break rather than passing it silently.
       */
      this.breaks.push({
        entryId: row.entryId,
        position,
        expected: "<unparseable-timestamp>",
        actual: row.sig,
        tier: "cold",
        type: "signature",
      });
    }
    if (!row.storedPayload) {
      console.error(
        `[audit-verify][cold] row ${row.entryId} carries no signedSnapshot — recording a signature break`,
      );
      this.breaks.push({
        entryId: row.entryId,
        position,
        expected: "<no-stored-payload>",
        actual: row.sig,
        tier: "cold",
        type: "signature",
      });
      return;
    }
    const expectedSig = sha256(
      row.prevSig + HASH_INPUT_SEPARATOR + row.storedPayload,
    );
    if (expectedSig !== row.sig) {
      this.breaks.push({
        entryId: row.entryId,
        position,
        expected: expectedSig,
        actual: row.sig,
        tier: "cold",
        type: "signature",
      });
    }
  }

  /*
   * Hot rows recompute the signed bytes from live fields (catches field edits)
   * and cross-check the stored snapshot for drift.
   */
  private verifyHot(row: IHotWalkRow, position: number): void {
    let signedBytes: string | null = null;
    try {
      signedBytes = recomputeSignedBytes(row.hotRow);
    } catch (err) {
      /*
       * A row whose signed bytes can't be rebuilt can't be verified — record a
       * break and keep walking rather than skipping it silently.
       */
      console.error(
        `[audit-verify] row ${row.entryId} signed bytes could not be rebuilt — recording a signature break`,
        err,
      );
      this.breaks.push({
        entryId: row.entryId,
        position,
        expected: "<signed-bytes-rebuild-failed>",
        actual: row.sig,
        tier: "hot",
        type: "signature",
      });
    }

    if (signedBytes === null) return;

    const expectedSig = sha256(
      row.prevSig + HASH_INPUT_SEPARATOR + signedBytes,
    );
    if (expectedSig !== row.sig) {
      this.breaks.push({
        entryId: row.entryId,
        position,
        expected: expectedSig,
        actual: row.sig,
        tier: "hot",
        type: "signature",
      });
    }

    if (row.storedPayload != null && row.storedPayload !== signedBytes) {
      this.breaks.push({
        entryId: row.entryId,
        position,
        expected: signedBytes.slice(0, PAYLOAD_PREVIEW_CHARS),
        actual: row.storedPayload.slice(0, PAYLOAD_PREVIEW_CHARS),
        tier: "hot",
        type: "payload_drift",
      });
    }
  }

  /*
   * Record a chain-head break (missing head, or head/last-row mismatch). The
   * entry position is the head, just past the last walked row.
   */
  recordHeadBreak(expected: string, actual: string): void {
    this.breaks.push({
      entryId: this.lastEntryId ?? "CHAIN_HEAD",
      position: this.totalEntries,
      expected,
      actual,
      tier: "hot",
      type: "head",
    });
  }

  buildReport(coldTier: boolean): IChainVerifyReport {
    return {
      companyRef: this.companyRef,
      totalEntries: this.totalEntries,
      hotEntries: this.hotEntries,
      coldEntries: this.coldEntries,
      coldTier,
      breaksFound: this.breaks.length,
      breaks: this.breaks,
      firstEntry: this.firstEntry,
      lastEntry: this.lastEntry,
      verifiedAt: new Date(),
      status: this.breaks.length === 0 ? "clean" : "tampered",
      ...(this.anchorUnverified ? { anchorUnverified: true as const } : {}),
      ...(this.retentionLagCount > 0
        ? {
            retentionLag: {
              count: this.retentionLagCount,
              oldestTimestamp: this.retentionLagOldest!,
              newestTimestamp: this.retentionLagNewest!,
            },
          }
        : {}),
      ...(this.duplicatesSkipped > 0
        ? { duplicatesSkipped: this.duplicatesSkipped }
        : {}),
    };
  }
}
