import { afterEach, describe, expect, it } from "vitest";

import envConfig from "@/config/env";
import { resolveHotWindowCutoff } from "@/modules/audit-logs/helpers/retention/window.helper";

const MS_PER_MINUTE = 60_000;
const MS_PER_DAY = 24 * 60 * MS_PER_MINUTE;
const NOW = new Date("2026-06-03T12:00:00.000Z");

describe("resolveHotWindowCutoff", () => {
  const origDays = envConfig.AUDIT_HOT_WINDOW_DAYS;

  afterEach(() => {
    envConfig.AUDIT_HOT_WINDOW_DAYS = origDays;
  });

  it("uses AUDIT_HOT_WINDOW_DAYS for the window", () => {
    envConfig.AUDIT_HOT_WINDOW_DAYS = 90;

    const cutoff = resolveHotWindowCutoff(NOW);

    expect(NOW.getTime() - cutoff.getTime()).toBe(90 * MS_PER_DAY);
  });

  it("computes the cutoff relative to the passed-in now", () => {
    envConfig.AUDIT_HOT_WINDOW_DAYS = 1;

    const cutoff = resolveHotWindowCutoff(NOW);

    expect(cutoff.toISOString()).toBe("2026-06-02T12:00:00.000Z");
  });
});
