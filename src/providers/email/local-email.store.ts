export type TCapturedEmail = {
  to: string[];
  from?: string;
  cc?: string[];
  bcc?: string[];
  subject?: string;
  html?: string;
  text?: string;
  templateName?: string;
  templateData?: Record<string, unknown>;
  sentAt: string;
};

const MAX_CAPTURED_EMAILS = 200;

const captured: TCapturedEmail[] = [];

export function recordEmail(email: Omit<TCapturedEmail, "sentAt">): void {
  captured.push({ ...email, sentAt: new Date().toISOString() });
  if (captured.length > MAX_CAPTURED_EMAILS) {
    captured.shift();
  }
}

/** Newest first, optionally filtered by recipient (case-insensitive). */
export function getCapturedEmails(to?: string): TCapturedEmail[] {
  const emails = to
    ? captured.filter((email) =>
        email.to.some(
          (recipient) => recipient.toLowerCase() === to.toLowerCase(),
        ),
      )
    : [...captured];
  return emails.reverse();
}

export function clearCapturedEmails(): void {
  captured.length = 0;
}
