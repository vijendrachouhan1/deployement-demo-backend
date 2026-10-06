import { vi } from "vitest";

import envConfig from "@/config/env";

/*
 * Athena isn't reachable in tests, so the audit cold tier must read as
 * unconfigured by default — isColdTierConfigured() gates on AUDIT_ARCHIVE_BUCKET
 * (among others), and the verify path throws on the mocked empty COUNT if it runs.
 * A developer's local .env.development that sets this must not flip every suite
 * onto the cold path; cold-tier tests opt in by setting the vars themselves. The
 * bucket (not the ATHENA_* connection vars) is neutralized so real-provider tests
 * that construct AthenaProvider from env still work.
 */
envConfig.AUDIT_ARCHIVE_BUCKET = undefined;

export const ATHENA_RESULT_ROW_CAP = 100;

export const athenaProvider = {
  runQuery: vi.fn(async () => ({ rows: [] as any[], truncated: false })),
  // Parity with the real provider's E.3 paged read — default: no cold pages.
  streamQueryRows: vi.fn(async function* (): AsyncGenerator<
    Record<string, string | undefined>[]
  > {}),
};

export class AthenaProvider {
  runQuery = athenaProvider.runQuery;
  streamQueryRows = athenaProvider.streamQueryRows;
}

vi.mock(
  "@/providers/audit-logs/athena.provider",
  () => import("@/tests/mocks/athena-provider.mock.js"),
);
