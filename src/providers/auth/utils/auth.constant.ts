/**
 * Client-facing copy for known password failures surfaced by the auth provider.
 * Deliberately generic and friendly — we don't leak the provider's raw wording.
 */
export const PASSWORD_ERROR_MESSAGES = {
  PASSWORD_TOO_WEAK: "Your password is too weak. Please choose a stronger one.",
  PASSWORD_REUSED: "You've used this password before. Please choose a new one.",
} as const;
