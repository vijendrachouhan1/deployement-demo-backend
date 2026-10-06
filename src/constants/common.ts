export const CLIENT_PLATFORM = {
  HEADER: "x-client-platform",
  VALUES: {
    MOBILE: "mobile",
  },
} as const;

/** Carries the pending-MFA token for mobile clients, which hold no cookies. */
export const PENDING_MFA_TOKEN_HEADER = "x-pending-mfa-token";
