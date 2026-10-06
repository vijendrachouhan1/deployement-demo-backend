import { describe, expect, it } from "vitest";

import {
  assertWithinBsonLimit,
  truncateOversized,
} from "@/db/plugins/audit/utils/truncate";

describe("truncateOversized", () => {
  it("leaves small metadata unchanged", () => {
    const event = { metadata: { name: "alice" } };
    truncateOversized(event);
    expect(event.metadata).toEqual({ name: "alice" });
  });

  it("truncates metadata > 1 MB to marker", () => {
    const event: { metadata?: Record<string, unknown> } = {
      metadata: { blob: "x".repeat(2 * 1024 * 1024) },
    };
    truncateOversized(event);
    const keys = Object.keys(event.metadata!);
    expect(keys[0]).toMatch(/^\[truncated, \d+ KB original\]$/);
  });

  it("truncates changes array > 1 MB to single marker entry that satisfies ChangeSchema", () => {
    const big = "x".repeat(2 * 1024 * 1024);
    const event: { changes?: unknown } = {
      changes: [{ field: "metadata", before: big, after: "" }],
    };
    truncateOversized(event);
    expect(Array.isArray(event.changes)).toBe(true);
    const arr = event.changes as Array<{
      field: string;
      before: unknown;
      after: unknown;
    }>;
    expect(arr.length).toBe(1);
    expect(arr[0].field).toBe("[truncated]");
    expect(arr[0].before).toBeNull();
    expect(typeof arr[0].after).toBe("number");
  });
});

describe("assertWithinBsonLimit", () => {
  it("passes for a small doc", () => {
    expect(() => assertWithinBsonLimit({ action: "user.login" })).not.toThrow();
  });

  it("throws for a doc > 15 MB", () => {
    const big = { blob: "x".repeat(16 * 1024 * 1024) };
    expect(() => assertWithinBsonLimit(big)).toThrow(/exceeds limit/);
  });
});
