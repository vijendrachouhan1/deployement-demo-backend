import { afterEach, describe, expect, it, vi } from "vitest";

// Stub the AWS SDK so the REAL AthenaProvider runs against a controllable
// `send`; command classes keep their `input` so we can assert the targeted
// Database / OutputLocation. (The global athena-provider mock is bypassed via
// vi.importActual below.)
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
import envConfig from "@/config/env";

const send = (athenaSdk as any).__send as ReturnType<typeof vi.fn>;

function loadProvider() {
  return vi.importActual<
    typeof import("@/providers/audit-logs/athena.provider")
  >("@/providers/audit-logs/athena.provider");
}

describe("AthenaProvider env-driven target (AC3)", () => {
  const origDb = envConfig.ATHENA_DATABASE;
  const origOut = envConfig.ATHENA_OUTPUT_LOCATION;

  afterEach(() => {
    envConfig.ATHENA_DATABASE = origDb;
    envConfig.ATHENA_OUTPUT_LOCATION = origOut;
    send.mockReset();
  });

  it("targets ATHENA_DATABASE + ATHENA_OUTPUT_LOCATION from env, not the old hardcoded values", async () => {
    envConfig.ATHENA_DATABASE = "audit_archive_db";
    envConfig.ATHENA_OUTPUT_LOCATION =
      "s3://suraj-audit-archive/athena-results/";
    send
      .mockResolvedValueOnce({ QueryExecutionId: "q1" })
      .mockResolvedValueOnce({
        QueryExecution: { Status: { State: "SUCCEEDED" } },
      })
      .mockResolvedValueOnce({
        ResultSet: { Rows: [], ResultSetMetadata: { ColumnInfo: [] } },
      });

    const { AthenaProvider } = await loadProvider();
    await new AthenaProvider().runQuery("SELECT 1");

    const startCall = send.mock.calls.find(
      ([cmd]) => cmd?.constructor?.name === "StartQueryExecutionCommand",
    );
    expect(startCall![0].input.QueryExecutionContext.Database).toBe(
      "audit_archive_db",
    );
    expect(startCall![0].input.QueryExecutionContext.Database).not.toBe(
      "boilerplate-byldd",
    );
    expect(startCall![0].input.ResultConfiguration.OutputLocation).toBe(
      "s3://suraj-audit-archive/athena-results/",
    );
  }, 10_000);

  it("throws a clear error (no query sent) when ATHENA_DATABASE is absent", async () => {
    envConfig.ATHENA_DATABASE = undefined;
    envConfig.ATHENA_OUTPUT_LOCATION = "s3://x/y/";

    const { AthenaProvider } = await loadProvider();

    await expect(new AthenaProvider().runQuery("SELECT 1")).rejects.toThrow(
      /ATHENA_DATABASE is not set/,
    );
    expect(send).not.toHaveBeenCalled();
  });

  it("throws a clear error (no query sent) when ATHENA_OUTPUT_LOCATION is absent", async () => {
    envConfig.ATHENA_DATABASE = "audit_archive_db";
    envConfig.ATHENA_OUTPUT_LOCATION = undefined;

    const { AthenaProvider } = await loadProvider();

    await expect(new AthenaProvider().runQuery("SELECT 1")).rejects.toThrow(
      /ATHENA_OUTPUT_LOCATION is not set/,
    );
    expect(send).not.toHaveBeenCalled();
  });
});

describe("AthenaProvider.streamQueryRows (E.3 internal pager)", () => {
  const origDb = envConfig.ATHENA_DATABASE;
  const origOut = envConfig.ATHENA_OUTPUT_LOCATION;

  afterEach(() => {
    envConfig.ATHENA_DATABASE = origDb;
    envConfig.ATHENA_OUTPUT_LOCATION = origOut;
    send.mockReset();
  });

  function resultRow(value: string) {
    return { Data: [{ VarCharValue: value }] };
  }

  function resultPage(values: string[], nextToken?: string) {
    return {
      ResultSet: {
        Rows: values.map(resultRow),
        ResultSetMetadata: { ColumnInfo: [{ Name: "col" }] },
      },
      NextToken: nextToken,
    };
  }

  it("pages ONE execution via NextToken, no row cap, header skipped on page 1 only", async () => {
    envConfig.ATHENA_DATABASE = "db";
    envConfig.ATHENA_OUTPUT_LOCATION = "s3://x/y/";
    const page1Values = [
      "header",
      ...Array.from({ length: 50 }, (_, i) => `p1-${i}`),
    ];
    const page2Values = Array.from({ length: 60 }, (_, i) => `p2-${i}`);
    send
      .mockResolvedValueOnce({ QueryExecutionId: "q1" })
      .mockResolvedValueOnce({
        QueryExecution: { Status: { State: "SUCCEEDED" } },
      })
      .mockResolvedValueOnce(resultPage(page1Values, "t1"))
      .mockResolvedValueOnce(resultPage(page2Values));

    const { AthenaProvider } = await loadProvider();
    const pages: Record<string, string | undefined>[][] = [];
    for await (const page of new AthenaProvider().streamQueryRows("SELECT 1")) {
      pages.push(page);
    }

    // 110 data rows total — well past the public runQuery's 100-row cap.
    expect(pages.map((p) => p.length)).toEqual([50, 60]);
    expect(pages[0][0].col).toBe("p1-0"); // header skipped
    expect(pages[1][0].col).toBe("p2-0"); // no header skip on page 2

    // One StartQueryExecution only; result pages request the AWS max.
    const startCalls = send.mock.calls.filter(
      ([cmd]) => cmd?.constructor?.name === "StartQueryExecutionCommand",
    );
    expect(startCalls).toHaveLength(1);
    const resultCalls = send.mock.calls.filter(
      ([cmd]) => cmd?.constructor?.name === "GetQueryResultsCommand",
    );
    expect(resultCalls[0][0].input.MaxResults).toBe(1000);
    expect(resultCalls[1][0].input.NextToken).toBe("t1");
  }, 10_000);

  it("propagates a FAILED query state", async () => {
    envConfig.ATHENA_DATABASE = "db";
    envConfig.ATHENA_OUTPUT_LOCATION = "s3://x/y/";
    send
      .mockResolvedValueOnce({ QueryExecutionId: "q1" })
      .mockResolvedValueOnce({
        QueryExecution: {
          Status: { State: "FAILED", StateChangeReason: "no such table" },
        },
      });

    const { AthenaProvider } = await loadProvider();
    const iter = new AthenaProvider().streamQueryRows("SELECT 1");

    await expect(iter.next()).rejects.toThrow(/no such table/);
  }, 10_000);
});
