import { describe, expect, it } from "vitest";

import {
  assertReadOnlySelect,
  AthenaSqlNotAllowedError,
} from "@/modules/audit-logs/utils/athena-sql-guard.util";

describe("assertReadOnlySelect", () => {
  it("accepts a plain read-only SELECT", () => {
    expect(assertReadOnlySelect("SELECT * FROM audit_archive")).toBe(
      "SELECT * FROM audit_archive",
    );
  });

  it("accepts a WITH ... SELECT", () => {
    const q = "WITH t AS (SELECT 1) SELECT * FROM t";
    expect(assertReadOnlySelect(q)).toBe(q);
  });

  it("tolerates a single trailing semicolon", () => {
    expect(assertReadOnlySelect("SELECT 1;")).toBe("SELECT 1");
    expect(assertReadOnlySelect("SELECT 1;  \n")).toBe("SELECT 1");
  });

  it("rejects a second statement", () => {
    expect(() => assertReadOnlySelect("SELECT 1; DROP TABLE t")).toThrow(
      AthenaSqlNotAllowedError,
    );
  });

  it("rejects DDL/DML leading keywords", () => {
    for (const q of ["DROP TABLE t", "DELETE FROM t", "UPDATE t SET a=1"]) {
      expect(() => assertReadOnlySelect(q)).toThrow(AthenaSqlNotAllowedError);
    }
  });

  it("rejects a statement smuggled behind a line comment", () => {
    expect(() => assertReadOnlySelect("SELECT 1 -- x\n; DROP TABLE t")).toThrow(
      AthenaSqlNotAllowedError,
    );
  });

  it("strips comments outside literals", () => {
    expect(assertReadOnlySelect("SELECT 1 -- trailing comment")).toBe(
      "SELECT 1",
    );
    expect(assertReadOnlySelect("SELECT /* inline */ 1")).toBe("SELECT   1");
  });

  it("preserves a comment-looking sequence inside a string literal", () => {
    const q = "SELECT * FROM t WHERE name = '--x'";
    expect(assertReadOnlySelect(q)).toBe(q);
  });

  it("preserves a semicolon inside a string literal", () => {
    const q = "SELECT * FROM t WHERE name = 'a;b'";
    expect(assertReadOnlySelect(q)).toBe(q);
  });

  it("preserves a block-comment sequence inside a string literal", () => {
    const q = "SELECT * FROM t WHERE name = '/* not a comment */'";
    expect(assertReadOnlySelect(q)).toBe(q);
  });

  it("handles a doubled-quote escape inside a Presto string literal", () => {
    const q = "SELECT * FROM t WHERE name = 'O''Brien; DROP'";
    expect(assertReadOnlySelect(q)).toBe(q);
  });

  it("rejects an empty query", () => {
    expect(() => assertReadOnlySelect("   ")).toThrow(AthenaSqlNotAllowedError);
    expect(() => assertReadOnlySelect("-- only a comment")).toThrow(
      AthenaSqlNotAllowedError,
    );
  });
});
