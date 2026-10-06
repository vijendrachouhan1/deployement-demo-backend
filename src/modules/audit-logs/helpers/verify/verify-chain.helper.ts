import type mongoose from "mongoose";

import { ObjectId } from "@/helpers/common";
import { athenaChainReader } from "@/providers/audit-logs/athena-chain-reader";
import type { IColdChainRow } from "@/providers/audit-logs/utils/audit-provider.types";
import {
  ChainWalker,
  compareRows,
  normalizeCold,
  normalizeHot,
} from "@/modules/audit-logs/helpers/verify/chain-walker.helper";
import type {
  ColdChainReader,
  IChainVerifyReport,
  IHotWalkRow,
} from "@/modules/audit-logs/utils/verify.types";
import { ROOT_SIG } from "@/db/plugins/audit/utils/chain.constant";
import { AUDIT_CONSTANTS } from "@/providers/audit-logs/utils/audit.constant";
import { mongoAuditProvider } from "@/providers/audit-logs/mongo.provider";
import type {
  IAuditStorageProvider,
  IChainBatchCursor,
} from "@/providers/audit-logs/utils/audit-provider.types";
import {
  parseSystemRefShortcut,
  SYSTEM_SUBSYSTEM_REFS,
} from "@/db/plugins/audit/utils/subsystem";

export const VERIFY_BATCH_SIZE = 1000;

/*
 * Bounded mid-walk-emit tolerance for the head-anchor check: an emit landing
 * after the walk's last batch legitimately advances the chain head, so a
 * mismatch triggers a tail re-read before being declared a break.
 */
const HEAD_REREAD_ROUNDS = 2;

function resolveChainId(companyRef: string): mongoose.Types.ObjectId {
  const subsystem = parseSystemRefShortcut(companyRef);
  return subsystem ? SYSTEM_SUBSYSTEM_REFS[subsystem] : ObjectId(companyRef);
}

function resolveColdReader(
  coldReader: ColdChainReader | null | undefined,
  companyRef: string,
): ColdChainReader | null {
  if (coldReader !== undefined) return coldReader;
  if (athenaChainReader.isColdTierConfigured()) {
    return (ref) => athenaChainReader.streamColdChain(ref);
  }
  console.info(
    `[audit-verify] cold tier not configured — hot-only walk for ${companyRef}`,
  );
  return null;
}

async function* hotRows(
  provider: IAuditStorageProvider,
  companyRef: string,
  batchSize: number,
): AsyncGenerator<IHotWalkRow> {
  let cursor: IChainBatchCursor | null = null;
  while (true) {
    const batch = await provider.findChainBatch(companyRef, cursor, batchSize);
    if (batch.length === 0) return;
    for (const row of batch) yield normalizeHot(row);
    const last = batch[batch.length - 1];
    cursor = { timestamp: last.timestamp, _id: last._id };
    if (batch.length < batchSize) return;
  }
}

/*
 * Merge the hot and cold streams in unified chain order, feeding each row to the
 * walker. Cold wins ties so a both-tiers duplicate meets its cold twin first; a
 * hot row older than pending cold rows is a retention orphan walked in place.
 */
async function mergeWalk(
  walker: ChainWalker,
  provider: IAuditStorageProvider,
  companyRef: string,
  batchSize: number,
  reader: ColdChainReader | null,
): Promise<void> {
  const hotIt = hotRows(provider, companyRef, batchSize)[
    Symbol.asyncIterator
  ]();
  const coldIt = reader ? reader(companyRef)[Symbol.asyncIterator]() : null;

  let hotNext = await hotIt.next();
  let coldNext = coldIt ? await coldIt.next() : null;

  while (!hotNext.done || (coldNext !== null && !coldNext.done)) {
    const hotRow = hotNext.done ? null : hotNext.value;
    const coldRow =
      coldNext !== null && !coldNext.done
        ? normalizeCold(coldNext.value)
        : null;

    const takeCold =
      coldRow !== null &&
      (hotRow === null || compareRows(coldRow, hotRow) <= 0);

    if (takeCold && coldRow !== null) {
      walker.process(coldRow, false);
      coldNext = await (coldIt as AsyncIterator<IColdChainRow>).next();
    } else if (hotRow !== null) {
      walker.process(hotRow, coldRow !== null);
      hotNext = await hotIt.next();
    }
  }
}

/*
 * Head-anchor cross-check (closes the tail-truncation blind spot): the chain
 * head must equal the last walked row's _sig. A mid-walk emit advances the head
 * legitimately, so re-read the hot tail a bounded number of times before
 * declaring a break.
 */
async function reconcileChainHead(
  walker: ChainWalker,
  provider: IAuditStorageProvider,
  companyRef: string,
  batchSize: number,
): Promise<void> {
  const walkHotTail = async (): Promise<boolean> => {
    let walked = false;
    while (true) {
      const batch = await provider.findChainBatch(
        companyRef,
        walker.hotCursor,
        batchSize,
      );
      if (batch.length === 0) return walked;
      for (const row of batch) {
        walker.process(normalizeHot(row), false);
        walked = true;
      }
      if (batch.length < batchSize) return walked;
    }
  };

  const chainId = resolveChainId(companyRef);
  let head = await provider.getChainHead(chainId);

  let rounds = 0;
  while (
    head !== null &&
    head.lastSig !== walker.lastSig &&
    rounds < HEAD_REREAD_ROUNDS
  ) {
    const walkedNew = await walkHotTail();
    head = await provider.getChainHead(chainId);
    rounds += 1;
    if (!walkedNew) break;
  }

  if (head === null && walker.rowCount > 0) {
    // CAS creates the head doc at genesis — rows without a head is tampering.
    console.error(
      `[audit-verify] chain ${companyRef} has ${walker.rowCount} rows but no chain-head doc — recording a head break`,
    );
    walker.recordHeadBreak(walker.lastSig ?? ROOT_SIG, "<missing-chain-head>");
  } else if (
    head !== null &&
    (walker.rowCount === 0 || head.lastSig !== walker.lastSig)
  ) {
    /*
     * rowCount === 0 breaks unconditionally: CAS writes the first row's sig at
     * genesis, so no head doc legitimately exists for a rowless chain —
     * comparing lastSig (e.g. reset to ROOT after a full wipe) would pass it.
     */
    console.error(
      `[audit-verify] chain ${companyRef} head lastSig does not match the last walked row after ${rounds} tail re-read round(s) — recording a head break (tail truncation / head tamper)`,
    );
    walker.recordHeadBreak(walker.lastSig ?? "<no-rows-walked>", head.lastSig);
  }
}

/**
 * Walks a tenant's audit chain across BOTH tiers in unified
 * `(timestamp ASC, _id ASC)` order and verifies tamper-evidence.
 *
 * Tier-specific verification:
 * - HOT rows recompute the signed bytes from live fields (catches field edits)
 *   and cross-check the stored `signedSnapshot` (`payload_drift` — poisoned
 *   stored bytes would be archived verbatim and break cold verification later).
 * - COLD rows verify against the stored `signedSnapshot` ONLY — the other Athena
 *   columns went through Parquet/JSON flattening, so re-deriving the signed
 *   bytes from them would false-break every row.
 *
 * The merge — not a separate boundary rule — is what makes the boundary check
 * and the retention-orphan tolerance correct: an orphaned hot row older than the
 * newest cold row is linkage-checked in its true chain position
 * (cold(n-1) → orphan → cold(n+1) holds), surfaced as informational
 * `retentionLag`, never a false "tampered". A linkage break where the previous
 * row sits in the other tier is reported with tier "boundary".
 *
 * A row present in both tiers (crash residue: the sweep died between checkpoint
 * advance and Mongo delete — permanent, since resume skips it) is detected by an
 * identical `_sig` to the previous walked row and skipped into
 * `duplicatesSkipped`, not a break.
 *
 * After the walk, the chain head (`ChainHeadModel.lastSig`) must equal the last
 * walked row's `_sig` — this closes the tail-truncation blind spot (deleting the
 * newest N rows used to yield a clean report). Mid-walk emits are tolerated via
 * a bounded tail re-read; a persistent mismatch (or a head with rows missing /
 * rows with the head missing) is a `head` break. Caveat: the timestamp is
 * stamped before the CAS loop, so a rare same-ms pair can sort opposite to its
 * commit order — investigable, but both rows' signatures still verify.
 *
 * First-row anchor: `_prevSig === ROOT` verifies genesis on the true first row
 * across both tiers. A non-ROOT first row stays informational
 * (`anchorUnverified`) — a prefix wiped before archive-start is undetectable by
 * design.
 */
export async function verifyChain(
  companyRef: string,
  provider: IAuditStorageProvider = mongoAuditProvider,
  batchSize: number = VERIFY_BATCH_SIZE,
  coldReader?: ColdChainReader | null,
): Promise<IChainVerifyReport> {
  const reader = resolveColdReader(coldReader, companyRef);
  const walker = new ChainWalker(companyRef, AUDIT_CONSTANTS.verifyMaxRows);

  await mergeWalk(walker, provider, companyRef, batchSize, reader);
  await reconcileChainHead(walker, provider, companyRef, batchSize);

  return walker.buildReport(reader !== null);
}
