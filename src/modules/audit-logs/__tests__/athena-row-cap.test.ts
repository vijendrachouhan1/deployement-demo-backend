import { describe, expect, it, vi } from "vitest";

// Stub the AWS SDK so the REAL AthenaProvider runs against a controllable
// `send`. Command classes store their `input` so we can assert MaxResults.
vi.mock("@aws-sdk/client-athena", () => {
  const send = vi.fn();
  class AthenaClient {
    send = send;
  }
  class StartQueryExecutionCommand {
    constructor(public input: any) {}
  }
  class GetQueryExecutionCommand {
    constructor(public input: any) {}
  }
  class GetQueryResultsCommand {
    constructor(public input: any) {}
  }
  return {
    AthenaClient,
    StartQueryExecutionCommand,
    GetQueryExecutionCommand,
    GetQueryResultsCommand,
    QueryExecutionState: {
      RUNNING: "RUNNING",
      QUEUED: "QUEUED",
      SUCCEEDED: "SUCCEEDED",
      FAILED: "FAILED",
      CANCELLED: "CANCELLED",
    },
    __send: send,
  };
});

import * as athenaSdk from "@aws-sdk/client-athena";

const send = (athenaSdk as any).__send as ReturnType<typeof vi.fn>;

function resultSet(dataRowCount: number) {
  const header = { Data: [{ VarCharValue: "actorEmail" }] };
  const dataRows = Array.from({ length: dataRowCount }, (_, i) => ({
    Data: [{ VarCharValue: `row-${i}` }],
  }));
  return {
    ResultSet: {
      Rows: [header, ...dataRows],
      ResultSetMetadata: { ColumnInfo: [{ Name: "actorEmail" }] },
    },
  };
}

function stageQuery(dataRowCount: number) {
  send
    .mockResolvedValueOnce({ QueryExecutionId: "q1" }) // StartQueryExecution
    .mockResolvedValueOnce({
      QueryExecution: { Status: { State: "SUCCEEDED" } },
    }) // GetQueryExecution (poll)
    .mockResolvedValueOnce(resultSet(dataRowCount)); // GetQueryResults
}

describe("AthenaProvider — 100-row result cap", () => {
  it("caps a large result at 100 data rows and flags truncation, MaxResults=102", async () => {
    const { AthenaProvider, ATHENA_RESULT_ROW_CAP } = await vi.importActual<
      typeof import("@/providers/audit-logs/athena.provider")
    >("@/providers/audit-logs/athena.provider");

    stageQuery(150);
    const provider = new AthenaProvider();
    const { rows, truncated } = await provider.runQuery(
      "SELECT * FROM audit_archive",
    );

    expect(ATHENA_RESULT_ROW_CAP).toBe(100);
    expect(rows).toHaveLength(100);
    expect(truncated).toBe(true);

    // Fetches cap + 1 data rows (+1 more for the page-1 header) to detect overflow.
    const resultsCalls = send.mock.calls.filter(
      ([cmd]) => cmd?.constructor?.name === "GetQueryResultsCommand",
    );
    expect(resultsCalls).toHaveLength(1); // no NextToken follow-up
    expect(resultsCalls[0][0].input.MaxResults).toBe(102);
  }, 10_000);

  it("follows NextToken across short pages, still capping at 100", async () => {
    const { AthenaProvider } = await vi.importActual<
      typeof import("@/providers/audit-logs/athena.provider")
    >("@/providers/audit-logs/athena.provider");

    const colMeta = { ColumnInfo: [{ Name: "actorEmail" }] };
    const dataRows = (n: number, offset: number) =>
      Array.from({ length: n }, (_, i) => ({
        Data: [{ VarCharValue: `row-${offset + i}` }],
      }));

    send
      .mockResolvedValueOnce({ QueryExecutionId: "q1" }) // Start
      .mockResolvedValueOnce({
        QueryExecution: { Status: { State: "SUCCEEDED" } },
      }) // poll
      // Page 1: short page (header + 60 data) WITH a NextToken.
      .mockResolvedValueOnce({
        ResultSet: {
          Rows: [
            { Data: [{ VarCharValue: "actorEmail" }] },
            ...dataRows(60, 0),
          ],
          ResultSetMetadata: colMeta,
        },
        NextToken: "page2",
      })
      // Page 2: 60 more data rows (no header on subsequent pages), no NextToken.
      .mockResolvedValueOnce({
        ResultSet: { Rows: dataRows(60, 60), ResultSetMetadata: colMeta },
      });

    const provider = new AthenaProvider();
    const { rows, truncated } = await provider.runQuery(
      "SELECT * FROM audit_archive",
    );

    expect(rows).toHaveLength(100); // 60 from page 1 + 40 from page 2, then stop
    expect(truncated).toBe(true);
    const resultsCalls = send.mock.calls.filter(
      ([cmd]) => cmd?.constructor?.name === "GetQueryResultsCommand",
    );
    expect(resultsCalls).toHaveLength(2); // followed NextToken once
    expect(resultsCalls[0][0].input.MaxResults).toBe(102); // page 1: cap+1 + header
    expect(resultsCalls[1][0].input.NextToken).toBe("page2");
    expect(resultsCalls[1][0].input.MaxResults).toBe(41); // remaining after 60 (cap+1)
  }, 10_000);

  it("returns all rows when under the cap (header stripped)", async () => {
    const { AthenaProvider } = await vi.importActual<
      typeof import("@/providers/audit-logs/athena.provider")
    >("@/providers/audit-logs/athena.provider");

    stageQuery(3);
    const provider = new AthenaProvider();
    const { rows, truncated } = await provider.runQuery(
      "SELECT * FROM audit_archive",
    );

    expect(rows).toHaveLength(3);
    expect(truncated).toBe(false);
    expect(rows[0]).toEqual({ actorEmail: "row-0" });
  }, 10_000);
});
