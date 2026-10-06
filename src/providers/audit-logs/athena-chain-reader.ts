import envConfig from "@/config/env";
import { AUDIT_CONSTANTS } from "@/providers/audit-logs/utils/audit.constant";
import { SAFE_TABLE } from "@/providers/audit-logs/archive-setup.provider";
import { athenaProvider } from "@/providers/audit-logs/athena.provider";
import type {
  AthenaRow,
  IColdChainRow,
} from "@/providers/audit-logs/utils/audit-provider.types";
import {
  parseSystemRefShortcut,
  SYSTEM_SUBSYSTEM_REFS,
} from "@/db/plugins/audit/utils/subsystem";

const HEX_24 = /^[a-f0-9]{24}$/i;

/*
 * Athena lowercases every column name, so `signedSnapshot` comes back as
 * `signedsnapshot`. Lowercase all keys once so the rest of the file can read
 * predictable names.
 */
function lowercaseKeys(row: AthenaRow): AthenaRow {
  return Object.fromEntries(
    Object.entries(row).map(([k, v]) => [k.toLowerCase(), v]),
  );
}

/*
 * Athena renders timestamps as "yyyy-MM-dd HH:mm:ss.SSS" in UTC with no zone
 * suffix. Rebuild a real Date (millisecond precision survives the round-trip).
 */
function parseAthenaTimestamp(value: string | undefined): Date | null {
  if (!value) return null;
  const date = new Date(`${value.replace(" ", "T")}Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function resolveCompanyRefHex(companyRef: string): string {
  const subsystem = parseSystemRefShortcut(companyRef);
  const hex = subsystem
    ? SYSTEM_SUBSYSTEM_REFS[subsystem].toHexString()
    : companyRef;
  /*
   * The hex is about to be interpolated into SQL, so re-validate it here and
   * refuse on anything unexpected — never trust the caller at the query edge.
   */
  if (!HEX_24.test(hex)) {
    throw new Error(
      `[audit-verify][cold] companyRef "${companyRef}" did not resolve to a 24-hex ref — refusing to build the Athena query`,
    );
  }
  return hex.toLowerCase();
}

function archiveTableName(): string {
  const table = AUDIT_CONSTANTS.archiveGlueTable;
  if (!SAFE_TABLE.test(table)) {
    throw new Error(
      `archiveGlueTable "${table}" is not a valid table identifier (expected [A-Za-z0-9_])`,
    );
  }
  return table;
}

export function buildColdChainQuery(companyRef: string): string {
  const hex = resolveCompanyRefHex(companyRef);
  return (
    `SELECT _id, timestamp, _sig, _prevSig, signedSnapshot ` +
    `FROM "${archiveTableName()}" WHERE companyRef = '${hex}' ` +
    `ORDER BY timestamp ASC, _id ASC`
  );
}

export function buildColdCountQuery(companyRef: string): string {
  const hex = resolveCompanyRefHex(companyRef);
  return `SELECT COUNT(*) AS cnt FROM "${archiveTableName()}" WHERE companyRef = '${hex}'`;
}

export const athenaChainReader = {
  /*
   * Cold walk/count only run when the archive is fully wired. Deployments
   * without it degrade to a hot-only walk (all archive env vars are optional).
   */
  isColdTierConfigured(): boolean {
    return Boolean(
      envConfig.ATHENA_DATABASE &&
      envConfig.ATHENA_OUTPUT_LOCATION &&
      envConfig.AUDIT_ARCHIVE_BUCKET,
    );
  },

  async countColdChain(companyRef: string): Promise<number> {
    const { rows } = await athenaProvider.runQuery(
      buildColdCountQuery(companyRef),
    );
    const first = rows[0] ? lowercaseKeys(rows[0]) : undefined;
    const count = Number(first?.cnt);
    /*
     * A garbage COUNT must not read as "no cold rows" — that would silently
     * waive the row-count cap for the whole cold tier. Fail closed; the throw
     * rides the controller's existing cold-count refund path.
     */
    if (!Number.isFinite(count)) {
      throw new Error(
        `[audit-verify][cold] COUNT(*) for ${companyRef} returned an unparseable value ("${String(first?.cnt)}")`,
      );
    }
    return count;
  },

  // One Athena execution, paged — not the 100-row-capped public runQuery.
  async *streamColdChain(companyRef: string): AsyncGenerator<IColdChainRow> {
    const query = buildColdChainQuery(companyRef);
    /*
     * Athena's ORDER BY runs on the typed Parquet timestamp, so arrival order
     * is chain order even when a row's string timestamp is corrupt. Carry the
     * previous row's timestamp instead of epoch — epoch would front-sort the
     * row out of place and cascade false linkage breaks onto its neighbors.
     */
    let lastParsed: Date | null = null;
    for await (const page of athenaProvider.streamQueryRows(query)) {
      for (const raw of page) {
        const row = lowercaseKeys(raw);
        const id = row._id;
        if (!id || !HEX_24.test(id)) {
          /*
           * Older archive files predate the _id column; without it the row
           * can't be ordered or attributed, so fail closed. The error says how
           * to fix it (rides the verify refund path).
           */
          throw new Error(
            `[audit-verify][cold] row carries a missing/malformed _id ("${id ?? "<null>"}") — if the archive table predates the _id column, DROP it and re-run audit:archive-setup (docs/runbooks/audit-logs/archive-table-setup.md)`,
          );
        }
        const parsed = parseAthenaTimestamp(row.timestamp);
        if (parsed === null) {
          console.error(
            `[audit-verify][cold] row ${id} has an unparseable timestamp "${row.timestamp}" — carrying its predecessor's timestamp; the walker records a break for it`,
          );
        } else {
          lastParsed = parsed;
        }
        yield {
          entryId: id.toLowerCase(),
          timestamp: parsed ?? lastParsed ?? new Date(0),
          sig: row._sig ?? "",
          prevSig: row._prevsig ?? "",
          signedSnapshot: row.signedsnapshot ?? null,
          ...(parsed === null ? { timestampUnparseable: true as const } : {}),
        };
      }
    }
  },
};
