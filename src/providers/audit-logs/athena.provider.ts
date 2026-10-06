import {
  AthenaClient,
  StartQueryExecutionCommand,
  GetQueryExecutionCommand,
  GetQueryResultsCommand,
  QueryExecutionState,
  GetQueryResultsCommandOutput,
} from "@aws-sdk/client-athena";
import envConfig from "@/config/env";
import type { AthenaRow } from "@/providers/audit-logs/utils/audit-provider.types";

export const ATHENA_RESULT_ROW_CAP = 100;

export class AthenaProvider {
  private client: AthenaClient;
  private database?: string;
  private outputLocation?: string;

  constructor() {
    this.client = new AthenaClient({
      region: envConfig.ATHENA_REGION || envConfig.S3_BUCKET_REGION,
      credentials: {
        accessKeyId: envConfig.AWS_USER_KEY,
        secretAccessKey: envConfig.AWS_USER_SECRET,
      },
    });

    this.database = envConfig.ATHENA_DATABASE;
    this.outputLocation = envConfig.ATHENA_OUTPUT_LOCATION;
  }

  private async startAndPoll(query: string): Promise<string> {
    if (!this.database) {
      throw new Error(
        "ATHENA_DATABASE is not set — cannot run an Athena query without a target Glue database",
      );
    }
    if (!this.outputLocation) {
      throw new Error(
        "ATHENA_OUTPUT_LOCATION is not set — cannot run an Athena query without an S3 results location",
      );
    }

    const startCommand = new StartQueryExecutionCommand({
      QueryString: query,
      QueryExecutionContext: { Database: this.database },
      ResultConfiguration: { OutputLocation: this.outputLocation },
    });

    const { QueryExecutionId } = await this.client.send(startCommand);
    if (!QueryExecutionId)
      throw new Error("Failed to start Athena query execution");

    // Re-check status every second until Athena finishes, fails, or cancels.
    let state: QueryExecutionState | string = QueryExecutionState.RUNNING;
    while (
      state === QueryExecutionState.RUNNING ||
      state === QueryExecutionState.QUEUED
    ) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const getCommand = new GetQueryExecutionCommand({ QueryExecutionId });
      const { QueryExecution } = await this.client.send(getCommand);
      state = QueryExecution?.Status?.State || "UNKNOWN";

      if (state === QueryExecutionState.FAILED) {
        throw new Error(
          `Athena query failed: ${QueryExecution?.Status?.StateChangeReason}`,
        );
      }
      if (state === QueryExecutionState.CANCELLED) {
        throw new Error("Athena query was cancelled");
      }
    }

    return QueryExecutionId;
  }

  // Row 0 of the FIRST page is the column header — callers skip it via startIdx.
  private parseResultRows(
    response: GetQueryResultsCommandOutput,
    skipHeader: boolean,
  ): AthenaRow[] {
    const rows = response.ResultSet?.Rows || [];
    const columns = response.ResultSet?.ResultSetMetadata?.ColumnInfo || [];
    const parsed: AthenaRow[] = [];

    const startIdx = skipHeader ? 1 : 0;
    for (let i = startIdx; i < rows.length; i++) {
      const rowData: AthenaRow = {};
      rows[i].Data?.forEach((data, index) => {
        const columnName = columns[index]?.Name || `col_${index}`;
        rowData[columnName] = data.VarCharValue;
      });
      parsed.push(rowData);
    }
    return parsed;
  }

  async runQuery(
    query: string,
  ): Promise<{ rows: AthenaRow[]; truncated: boolean }> {
    const queryExecutionId = await this.startAndPoll(query);

    const fetchLimit = ATHENA_RESULT_ROW_CAP + 1;
    const collected: AthenaRow[] = [];
    let nextToken: string | undefined;

    do {
      const remaining = fetchLimit - collected.length;
      const resultsCommand: GetQueryResultsCommand = new GetQueryResultsCommand(
        {
          QueryExecutionId: queryExecutionId,
          NextToken: nextToken,
          MaxResults: remaining + (nextToken ? 0 : 1), // +1 on page 1 for the header row
        },
      );

      const response: GetQueryResultsCommandOutput =
        await this.client.send(resultsCommand);
      const parsed = this.parseResultRows(response, !nextToken);
      for (const row of parsed) {
        if (collected.length >= fetchLimit) break;
        collected.push(row);
      }

      nextToken = response.NextToken;
    } while (nextToken && collected.length < fetchLimit);

    const truncated = collected.length > ATHENA_RESULT_ROW_CAP;
    const rows = truncated
      ? collected.slice(0, ATHENA_RESULT_ROW_CAP)
      : collected;
    return { rows, truncated };
  }

  /**
   * Internal paged read for the chain verifier: ONE query execution, results
   * streamed page-by-page with no row cap — the caller bounds the walk
   * (AUDIT_CONSTANTS.verifyMaxRows). The public `runQuery` keeps ATHENA_RESULT_ROW_CAP
   * to guard the user-facing query endpoint; reusing that cap here would mean a
   * fresh query per 100 rows, and each Athena execution scans ~10MB minimum.
   */
  async *streamQueryRows(
    query: string,
    pageSize = 1000, // AWS GetQueryResults MaxResults hard max
  ): AsyncGenerator<AthenaRow[]> {
    const queryExecutionId = await this.startAndPoll(query);

    let nextToken: string | undefined;
    do {
      const resultsCommand: GetQueryResultsCommand = new GetQueryResultsCommand(
        {
          QueryExecutionId: queryExecutionId,
          NextToken: nextToken,
          MaxResults: Math.min(pageSize, 1000),
        },
      );
      const response: GetQueryResultsCommandOutput =
        await this.client.send(resultsCommand);

      const parsed = this.parseResultRows(response, !nextToken);
      if (parsed.length > 0) yield parsed;

      nextToken = response.NextToken;
    } while (nextToken);
  }
}

export const athenaProvider = new AthenaProvider();
