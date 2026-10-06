import { IAuthProviderUser } from "@/providers/auth/utils/auth.types";

type TMfaChallengeBody = {
  code?: string;
  user?: {
    id?: string;
    email?: string;
    first_name?: string | null;
    last_name?: string | null;
    email_verified?: boolean;
    metadata?: Record<string, unknown>;
  };
};

/**
 * WorkOS throws 403 `mfa_challenge` when a factor is enrolled — the password was
 * accepted, so the payload carries the authenticated user. `rawData` is the
 * untouched HTTP body, hence snake_case rather than the SDK's camelCase.
 */
export function parseMfaChallenge(error: unknown): IAuthProviderUser | null {
  const rawData = (error as { rawData?: TMfaChallengeBody })?.rawData;
  const user = rawData?.user;

  if (rawData?.code !== "mfa_challenge" || !user?.id || !user.email) {
    return null;
  }

  return {
    id: user.id,
    email: user.email,
    firstName: user.first_name ?? null,
    lastName: user.last_name ?? null,
    emailVerified: user.email_verified,
    metadata: user.metadata,
  };
}
