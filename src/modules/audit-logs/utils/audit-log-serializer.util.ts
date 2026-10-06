import type { IAuditLog } from "@/db/models/audit-logs/audit-log";
import { scrubSensitiveKeys } from "@/db/plugins/audit/utils/sensitive-keys";
import type {
  AuditExportFormat,
  ISerializedAuditLogs,
} from "@/modules/audit-logs/utils/audit-log.types";

/*
 * Fixed, explicit CSV column order. Do NOT derive from Object.keys of a row —
 * rows have sparse optional fields, so column order must be stable across rows.
 */
const CSV_COLUMNS = [
  "_id",
  "timestamp",
  "category",
  "action",
  "status",
  "actorId",
  "actorEmail",
  "actorName",
  "targetType",
  "targetId",
  "target",
  "companyRef",
  "context",
  "changes",
  "metadata",
  "_sig",
] as const;

/*
 * Mongoose `.lean()` leaves ObjectId instances on the row; render them as bare
 * hex, not the opaque object JSON.stringify would emit.
 */
function isObjectIdLike(value: object): boolean {
  return typeof (value as { toHexString?: unknown }).toHexString === "function";
}

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";

  let raw: string;
  if (value instanceof Date) {
    raw = value.toISOString();
  } else if (typeof value === "object") {
    raw = isObjectIdLike(value) ? String(value) : JSON.stringify(value);
  } else {
    raw = String(value);
  }

  /*
   * Neutralize spreadsheet formula injection: Excel/Sheets execute a cell that
   * begins with one of these. Audit fields (actorEmail, actor.name, action,
   * metadata) are user-influenced, so prefix a literal quote to defuse it.
   */
  if (/^[=+\-@\t\r]/.test(raw)) {
    raw = `'${raw}`;
  }

  /*
   * RFC-4180: quote when the cell contains a comma, quote, CR or LF; double
   * any embedded quote.
   */
  if (/[",\r\n]/.test(raw)) {
    return `"${raw.replace(/"/g, '""')}"`;
  }
  return raw;
}

function rowToCsvValues(row: IAuditLog): unknown[] {
  return [
    row._id,
    row.timestamp,
    row.category,
    row.action,
    row.status,
    row.actorId,
    row.actorEmail,
    row.actor?.name ?? null,
    row.targetType,
    row.targetId,
    row.target,
    row.companyRef,
    row.context,
    row.changes,
    row.metadata,
    row._sig,
  ];
}

export function serializeAuditLogs(
  rows: IAuditLog[],
  format: AuditExportFormat,
): ISerializedAuditLogs {
  const safeRows = rows.map((row) => scrubSensitiveKeys(row) as IAuditLog);

  if (format === "csv") {
    const lines = [CSV_COLUMNS.join(",")];
    for (const row of safeRows) {
      lines.push(rowToCsvValues(row).map(csvCell).join(","));
    }
    return {
      body: Buffer.from(lines.join("\r\n"), "utf-8"),
      mimeType: "text/csv",
      ext: "csv",
    };
  }

  return {
    body: Buffer.from(JSON.stringify(safeRows), "utf-8"),
    mimeType: "application/json",
    ext: "json",
  };
}
