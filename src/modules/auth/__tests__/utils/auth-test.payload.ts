import { faker } from "@faker-js/faker";

import { ICompany } from "@/db/models/company";
import { OTP_PURPOSE } from "@/db/models/otpVerification";
import { IUserDocument } from "@/db/models/user";
import { STATUS } from "@/enums";
import {
  DEFAULT_TEST_OTP,
  VALID_OAUTH_PROVIDER,
} from "@/modules/auth/__tests__/utils/auth-test.constant";

// ---------------------------------------------------------------------------
// Request payload builders — one per endpoint, valid by default, override to
// break a specific field.
// ---------------------------------------------------------------------------

/** POST /api/auth/login — loginType "password" */
export function buildPasswordLoginPayload(
  overrides: Record<string, unknown> = {},
) {
  return {
    email: faker.internet.email().toLowerCase(),
    password: "StrongPass@123",
    loginType: "password",
    ...overrides,
  };
}

/** POST /api/auth/login — loginType "otp" */
export function buildOtpLoginPayload(overrides: Record<string, unknown> = {}) {
  return {
    email: faker.internet.email().toLowerCase(),
    loginType: "otp",
    otp: DEFAULT_TEST_OTP,
    ...overrides,
  };
}

/** POST /api/auth/register */
export function buildRegisterPayload(overrides: Record<string, unknown> = {}) {
  return {
    name: { first: faker.person.firstName(), last: faker.person.lastName() },
    email: faker.internet.email().toLowerCase(),
    password: "StrongPass@123",
    ...overrides,
  };
}

/** POST /api/auth/social-signup */
export function buildOauthRegisterPayload(
  overrides: Record<string, unknown> = {},
) {
  return {
    code: faker.string.alphanumeric(32),
    oauthProvider: VALID_OAUTH_PROVIDER,
    ...overrides,
  };
}

/** POST /api/auth/request-otp and /api/auth/resend-otp */
export function buildRequestOtpPayload(
  overrides: Record<string, unknown> = {},
) {
  return {
    identifier: faker.internet.email().toLowerCase(),
    purpose: OTP_PURPOSE.SIGNUP,
    ...overrides,
  };
}

/** POST /api/auth/verify-otp */
export function buildVerifyOtpPayload(overrides: Record<string, unknown> = {}) {
  return {
    identifier: faker.internet.email().toLowerCase(),
    purpose: OTP_PURPOSE.SIGNUP,
    otp: DEFAULT_TEST_OTP,
    ...overrides,
  };
}

/** POST /api/auth/reset-password */
export function buildResetEmailPayload(
  overrides: Record<string, unknown> = {},
) {
  return {
    email: faker.internet.email().toLowerCase(),
    ...overrides,
  };
}

/** POST /api/auth/update-password */
export function buildUpdatePasswordPayload(
  overrides: Record<string, unknown> = {},
) {
  return {
    email: faker.internet.email().toLowerCase(),
    token: faker.string.alphanumeric(32),
    password: "NewPass@123",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Object stand-ins — not HTTP payloads, but fake domain objects tests hand to
// mocks or pure functions.
// ---------------------------------------------------------------------------

/** A fake external-provider user object (like a WorkOS User) */
export function buildAuthProviderUser(id = faker.string.uuid()) {
  return {
    id,
    email: faker.internet.email(),
    firstName: faker.person.firstName(),
    lastName: faker.person.lastName(),
    emailVerified: true,
    metadata: {},
  };
}

/**
 * Minimal user stand-in for unit tests of the pure auth utilities — only the
 * fields those utilities read. Not persisted.
 */
export function buildUser(overrides: Partial<IUserDocument> = {}) {
  return {
    status: STATUS.ACTIVE,
    hasPassword: true,
    forcePasswordChange: false,
    ...overrides,
  } as IUserDocument;
}

/** Minimal company stand-in for unit tests of the pure auth utilities. */
export function buildCompany(
  overrides: Partial<ICompany> = {},
): Partial<ICompany> {
  return { ...overrides };
}
