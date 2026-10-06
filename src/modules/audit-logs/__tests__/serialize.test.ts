import mongoose from "mongoose";
import { describe, expect, it } from "vitest";

import type { IAuditLog } from "@/db/models/audit-logs/audit-log";
import { serializeAuditLogs } from "@/modules/audit-logs/utils/audit-log-serializer.util";

function makeRow(overrides: Partial<IAuditLog> = {}): IAuditLog {
  return {
    _id: new mongoose.Types.ObjectId(),
    timestamp: new Date("2026-01-02T03:04:05.000Z"),
    category: "admin_action" as IAuditLog["category"],
    action: "user.updated",
    status: "success" as IAuditLog["status"],
    companyRef: new mongoose.Types.ObjectId(),
    actorId: new mongoose.Types.ObjectId(),
    actorEmail: "actor@a.test",
    actorRole: "admin" as IAuditLog["actorRole"],
    targetType: "users",
    targetId: new mongoose.Types.ObjectId(),
    requestId: "req-1",
    _sig: "sig-1",
    _prevSig: "ROOT",
    subsystemMappingVersion: 1,
    actor: { name: "Alice" },
    target: { label: null },
    context: { ip: "1.2.3.4", userAgent: null, path: "/x", method: "GET" },
    retentionDays: null,
    ...overrides,
  } as IAuditLog;
}

describe("serializeAuditLogs — json", () => {
  it("returns a JSON array buffer with application/json mime", () => {
    const rows = [makeRow({ action: "a" }), makeRow({ action: "b" })];
    const out = serializeAuditLogs(rows, "json");

    expect(out.mimeType).toBe("application/json");
    expect(out.ext).toBe("json");
    const parsed = JSON.parse(out.body.toString("utf-8"));
    expect(parsed).toHaveLength(2);
    expect(parsed.map((r: { action: string }) => r.action)).toEqual(["a", "b"]);
  });

  it("serializes an empty set to []", () => {
    const out = serializeAuditLogs([], "json");
    expect(out.body.toString("utf-8")).toBe("[]");
  });
});

describe("serializeAuditLogs — csv", () => {
  it("emits a header row plus one row per entry with csv mime", () => {
    const out = serializeAuditLogs([makeRow()], "csv");
    expect(out.mimeType).toBe("text/csv");
    expect(out.ext).toBe("csv");

    const lines = out.body.toString("utf-8").split("\r\n");
    expect(lines[0]).toContain("_id,timestamp,category,action,status");
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain("user.updated");
    expect(lines[1]).toContain("actor@a.test");
    // actor.name is flattened into the actorName column.
    expect(lines[1]).toContain("Alice");
  });

  it("escapes commas, quotes and newlines per RFC-4180", () => {
    const out = serializeAuditLogs([makeRow({ action: 'a,b"c\nd' })], "csv");
    const line = out.body.toString("utf-8").split("\r\n")[1];
    // Whole cell quoted; embedded quote doubled.
    expect(line).toContain('"a,b""c\nd"');
  });

  it("JSON-stringifies object-valued cells (context)", () => {
    const out = serializeAuditLogs(
      [
        makeRow({
          context: { ip: "9.9.9.9", userAgent: null, path: null, method: null },
        }),
      ],
      "csv",
    );
    const line = out.body.toString("utf-8").split("\r\n")[1];
    // The context object becomes a quoted JSON string (contains commas → quoted).
    expect(line).toContain('"{""ip"":""9.9.9.9""');
  });

  it("renders null/undefined cells as empty", () => {
    const out = serializeAuditLogs(
      [makeRow({ actorEmail: null, targetType: null })],
      "csv",
    );
    const line = out.body.toString("utf-8").split("\r\n")[1];
    // Two consecutive commas where actorEmail sits empty.
    expect(line).toContain(",,");
  });

  it("includes a target column and JSON-stringifies it (AC#2)", () => {
    const out = serializeAuditLogs(
      [makeRow({ target: { label: "Acme Co" } })],
      "csv",
    );
    const lines = out.body.toString("utf-8").split("\r\n");
    expect(lines[0]).toContain(",target,");
    expect(lines[1]).toContain("Acme Co");
  });

  it("neutralizes spreadsheet formula injection (leading = + - @)", () => {
    for (const payload of ["=1+1", "+1", "-1", "@SUM(A1)"]) {
      const out = serializeAuditLogs([makeRow({ action: payload })], "csv");
      const line = out.body.toString("utf-8").split("\r\n")[1];
      // Prefixed with a literal quote so Excel/Sheets won't evaluate it.
      expect(line).toContain(`'${payload}`);
    }
  });

  it("renders ObjectId cells as bare hex, not opaque JSON", () => {
    const id = new mongoose.Types.ObjectId();
    const out = serializeAuditLogs([makeRow({ _id: id })], "csv");
    const line = out.body.toString("utf-8").split("\r\n")[1];
    expect(line.startsWith(id.toHexString())).toBe(true);
  });

  it("renders top-level Date as bare ISO (no surrounding JSON quotes)", () => {
    const out = serializeAuditLogs(
      [makeRow({ timestamp: new Date("2026-01-02T03:04:05.000Z") })],
      "csv",
    );
    const line = out.body.toString("utf-8").split("\r\n")[1];
    expect(line).toContain("2026-01-02T03:04:05.000Z");
    expect(line).not.toContain('"2026-01-02');
  });
});
