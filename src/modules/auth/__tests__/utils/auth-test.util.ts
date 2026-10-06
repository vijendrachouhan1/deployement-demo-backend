import { faker } from "@faker-js/faker";
import request from "supertest";

import envConfig from "@/config/env";
import { COOKIE_NAME } from "@/enums";
import { jwtHelper } from "@/helpers/jwt";
import { generatePendingMfaToken } from "@/modules/auth/helpers/pending-mfa.helper";
import {
  LOGIN_METHOD,
  PENDING_MFA_PURPOSE,
} from "@/modules/auth/utils/auth.enum";
import { mockAuthKitProvider } from "@/tests/mocks/authkit-provider.mock";
import { mockEmailService } from "@/tests/mocks/email-service.mock";

// ---------------------------------------------------------------------------
// Cookie helpers
// ---------------------------------------------------------------------------

/** Reads the `set-cookie` header as a string array (supertest types it loosely). */
export function setCookies(res: request.Response): string[] {
  return (res.headers["set-cookie"] as unknown as string[]) ?? [];
}

/**
 * Collapses `set-cookie` into the `name=value` pairs a browser would hold. A
 * handler that clears a cookie and re-sets it in the same response emits both,
 * and replaying the raw header sends the cleared one first — so the server reads
 * an empty value. Last write wins here, and expired entries drop out.
 */
export function cookieJar(res: request.Response): string[] {
  const jar = new Map<string, string>();

  for (const header of setCookies(res)) {
    const [pair] = header.split(";");
    const separator = pair.indexOf("=");
    const name = pair.slice(0, separator);
    const value = pair.slice(separator + 1);

    if (value === "") jar.delete(name);
    else jar.set(name, value);
  }

  return [...jar].map(([name, value]) => `${name}=${value}`);
}

/** True when the response sets a cookie with the given name. */
export function hasCookie(res: request.Response, name: COOKIE_NAME): boolean {
  return setCookies(res).some((c) => c.startsWith(`${name}=`));
}

/** Formats a refresh token as the cookie the refresh/revoke endpoints read. */
export function refreshCookie(token: string) {
  return [`refreshToken=${token}`];
}

// ---------------------------------------------------------------------------
// MFA credential helpers
// ---------------------------------------------------------------------------

/**
 * Signs a pending-MFA token the way a real flow does, then formats it as a
 * cookie. The purpose decides which routes it opens, so tests that cross flows
 * pass it explicitly; the default is the login challenge.
 */
export function pendingMfaCookie(
  userId: string,
  purpose: PENDING_MFA_PURPOSE = PENDING_MFA_PURPOSE.LOGIN,
  binding: {
    challengeId?: string;
    factorId?: string;
    loginMethod?: LOGIN_METHOD;
  } = {},
): string {
  const token = generatePendingMfaToken({
    userId,
    email: `${userId}@example.com`,
    purpose,
    ...binding,
  });
  return `${COOKIE_NAME.PENDING_MFA_TOKEN}=${token}`;
}

export function boundLoginMfa(
  challengeId = "auth_challenge_test",
  factorId = "auth_factor_test",
) {
  return { challengeId, factorId, loginMethod: LOGIN_METHOD.PASSWORD };
}

/** A pending token with no `purpose` claim, as minted before purposes existed. */
export function legacyPendingMfaCookie(userId: string): string {
  const token = jwtHelper.generateToken(
    { _id: userId },
    "15m",
    envConfig.MFA_JWT_TOKEN_SECRET,
  );
  return `${COOKIE_NAME.PENDING_MFA_TOKEN}=${token}`;
}

/** Formats the transient setup cookies (challenge / factor ids) the controller reads. */
export function mfaSetupCookies({
  challengeId,
  factorId,
}: {
  challengeId?: string;
  factorId?: string;
}): string[] {
  const cookies: string[] = [];
  if (challengeId)
    cookies.push(`${COOKIE_NAME.MFA_CHALLENGE_ID}=${challengeId}`);
  if (factorId) cookies.push(`${COOKIE_NAME.MFA_FACTOR_ID}=${factorId}`);
  return cookies;
}

// ---------------------------------------------------------------------------
// Email helpers
// ---------------------------------------------------------------------------

export function lastResetLink(): URL {
  const call = mockEmailService.sendEmail.mock.calls.at(-1);
  const html = (call?.[0] as { html: string }).html;
  const href = html.match(/href='([^']+)'/)?.[1];
  return new URL(href as string);
}

// ---------------------------------------------------------------------------
// Provider mock helpers
// ---------------------------------------------------------------------------

/**
 * Stubs the auth provider to authenticate `user`'s password login — the mock
 * returns the provider-side user the controller maps back to a local account.
 */
export function mockPasswordLogin(user: {
  externalUserId?: string;
  email: string;
}) {
  mockAuthKitProvider.authenticateWithPassword.mockResolvedValue({
    user: { id: user.externalUserId, email: user.email },
  });
}

/**
 * Stubs the OAuth code exchange to return `profile` as the provider-side user.
 * `id` defaults to a fresh uuid — pass a seeded user's externalUserId to make
 * the exchange resolve to an existing local account.
 */
export function mockOauthLogin(
  profile: {
    email: string;
    id?: string;
    firstName?: string;
    lastName?: string;
  },
  metadata: Record<string, unknown> = {},
) {
  mockAuthKitProvider.authenticateWithCode.mockResolvedValue({
    user: { id: faker.string.uuid(), metadata, ...profile },
  });
}
