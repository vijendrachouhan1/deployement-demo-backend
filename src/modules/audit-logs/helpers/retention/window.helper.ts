import envConfig from "@/config/env";

const MS_PER_DAY = 24 * 60 * 60_000;

/**
 * Effective hot-tier cutoff: rows with `timestamp` older than the returned Date
 * are eligible for the archive sweep (D.3+). The window is `AUDIT_HOT_WINDOW_DAYS`
 * (default 90).
 */
export function resolveHotWindowCutoff(now: Date): Date {
  const windowMs = envConfig.AUDIT_HOT_WINDOW_DAYS * MS_PER_DAY;
  return new Date(now.getTime() - windowMs);
}
