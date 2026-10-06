import { TEST_USER_EMAIL_SUFFIX } from "@/modules/e2e-support/utils/e2e-support.constant";
import { getCapturedEmails } from "@/providers/email/local-email.store";

export function isTestAccountEmail(email: string): boolean {
  return email.endsWith(TEST_USER_EMAIL_SUFFIX);
}

export function normalizeEmail(rawEmail: unknown): string {
  return (typeof rawEmail === "string" ? rawEmail : "").trim().toLowerCase();
}

export function listCapturedEmails(to?: string, limit?: number) {
  const emails = getCapturedEmails(to);

  if (limit !== undefined && Number.isInteger(limit) && limit > 0) {
    return emails.slice(0, limit);
  }

  return emails;
}
