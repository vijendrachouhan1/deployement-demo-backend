import dayjs from "dayjs";
import { describe, expect, it } from "vitest";

import { ERROR_CODES } from "@/constants/error-codes";
import { STATUS, USER_TYPE } from "@/enums";
import {
  buildCompany,
  buildUser,
} from "@/modules/auth/__tests__/utils/auth-test.payload";
import {
  DEFAULT_PASSWORD_GRACE_DAYS,
  DEFAULT_PASSWORD_VALIDITY_DAYS,
} from "@/modules/auth/utils/auth.constant";
import {
  buildPasswordTimestamps,
  evaluatePasswordRotationState,
  generateRecoveryCodes,
  getPasswordRotationConfig,
  isUserInactiveOrDeleted,
  shouldPromptUserForMfaEnrollment,
} from "@/modules/auth/utils/auth.util";

/*
 * Unit tests for the pure auth utilities.
 *
 * These functions gate account access and password-rotation enforcement, but
 * every branch below is either unreachable or unobservable through the HTTP
 * routes, so they are exercised directly.
 */

describe("isUserInactiveOrDeleted", () => {
  it("blocks a deleted account", () => {
    expect(isUserInactiveOrDeleted(buildUser({ status: STATUS.DELETED }))).toBe(
      true,
    );
  });

  it("blocks an inactive account", () => {
    expect(
      isUserInactiveOrDeleted(buildUser({ status: STATUS.INACTIVE })),
    ).toBe(true);
  });

  it("allows an active account", () => {
    expect(isUserInactiveOrDeleted(buildUser({ status: STATUS.ACTIVE }))).toBe(
      false,
    );
  });

  it("allows a PAST_DUE account — only DELETED and INACTIVE are blocking", () => {
    expect(
      isUserInactiveOrDeleted(buildUser({ status: STATUS.PAST_DUE })),
    ).toBe(false);
  });
});

describe("getPasswordRotationConfig", () => {
  it("falls back to defaults when there is no company", () => {
    expect(getPasswordRotationConfig(null)).toEqual({
      rotatePassword: false,
      passwordValidityDays: DEFAULT_PASSWORD_VALIDITY_DAYS,
      passwordGraceDays: DEFAULT_PASSWORD_GRACE_DAYS,
    });
  });

  it("reports rotation as enabled when the company opts in", () => {
    const config = getPasswordRotationConfig(
      buildCompany({ rotatePassword: true }),
    );
    expect(config.rotatePassword).toBe(true);
  });

  it("reports rotation as disabled when the company opts out", () => {
    const config = getPasswordRotationConfig(
      buildCompany({ rotatePassword: false }),
    );
    expect(config.rotatePassword).toBe(false);
  });

  it("defaults rotation to off when the company leaves the flag unset", () => {
    expect(getPasswordRotationConfig(buildCompany({})).rotatePassword).toBe(
      false,
    );
  });

  it("keeps the company's own validity and grace windows", () => {
    const config = getPasswordRotationConfig(
      buildCompany({
        rotatePassword: true,
        passwordValidityDays: 30,
        passwordGraceDays: 3,
      }),
    );
    expect(config.passwordValidityDays).toBe(30);
    expect(config.passwordGraceDays).toBe(3);
  });
});

describe("buildPasswordTimestamps", () => {
  it("stamps the expiry the configured number of days out", () => {
    const { passwordExpiresAt } = buildPasswordTimestamps(30);
    const daysOut = dayjs(passwordExpiresAt).diff(dayjs(), "day", true);
    expect(daysOut).toBeGreaterThan(29.9);
    expect(daysOut).toBeLessThanOrEqual(30);
  });

  it("uses the default validity window when none is supplied", () => {
    const { passwordExpiresAt } = buildPasswordTimestamps();
    const daysOut = dayjs(passwordExpiresAt).diff(dayjs(), "day", true);
    expect(daysOut).toBeGreaterThan(DEFAULT_PASSWORD_VALIDITY_DAYS - 0.1);
    expect(daysOut).toBeLessThanOrEqual(DEFAULT_PASSWORD_VALIDITY_DAYS);
  });
});

describe("evaluatePasswordRotationState", () => {
  const now = new Date("2026-06-01T12:00:00Z");
  const rotatingCompany = buildCompany({
    rotatePassword: true,
    passwordValidityDays: 90,
    passwordGraceDays: 7,
  });

  it("never blocks a user with no password (OAuth / magic-link accounts)", () => {
    const state = evaluatePasswordRotationState({
      user: buildUser({
        hasPassword: false,
        forcePasswordChange: true,
        passwordExpiresAt: new Date("2020-01-01T00:00:00Z"),
      }),
      company: rotatingCompany,
      now,
    });

    expect(state).toEqual({ isBlocked: false });
  });

  it("never blocks when the company has rotation disabled", () => {
    const state = evaluatePasswordRotationState({
      user: buildUser({
        forcePasswordChange: true,
        passwordExpiresAt: new Date("2020-01-01T00:00:00Z"),
      }),
      company: buildCompany({ rotatePassword: false }),
      now,
    });

    expect(state).toEqual({ isBlocked: false });
  });

  it("never blocks when there is no company at all", () => {
    const state = evaluatePasswordRotationState({
      user: buildUser({ forcePasswordChange: true }),
      company: null,
      now,
    });

    expect(state).toEqual({ isBlocked: false });
  });

  it("blocks a user flagged for a forced password change", () => {
    const state = evaluatePasswordRotationState({
      user: buildUser({
        forcePasswordChange: true,
        passwordExpiresAt: dayjs(now).add(60, "day").toDate(),
      }),
      company: rotatingCompany,
      now,
    });

    expect(state).toEqual({
      isBlocked: true,
      errorCode: ERROR_CODES.PASSWORD_CHANGE_REQUIRED,
    });
  });

  it("does not block while the password is still valid", () => {
    const state = evaluatePasswordRotationState({
      user: buildUser({ passwordExpiresAt: dayjs(now).add(1, "day").toDate() }),
      company: rotatingCompany,
      now,
    });

    expect(state).toEqual({ isBlocked: false });
  });

  it("does not block on the exact expiry instant", () => {
    const state = evaluatePasswordRotationState({
      user: buildUser({ passwordExpiresAt: now }),
      company: rotatingCompany,
      now,
    });

    expect(state).toEqual({ isBlocked: false });
  });

  it("warns with the remaining days while inside the grace period", () => {
    const state = evaluatePasswordRotationState({
      user: buildUser({
        passwordExpiresAt: dayjs(now).subtract(2, "day").toDate(),
      }),
      company: rotatingCompany,
      now,
    });

    expect(state.isBlocked).toBe(false);
    expect(state.errorCode).toBe(ERROR_CODES.PASSWORD_EXPIRING_SOON);
    expect(state.daysLeft).toBe(5);
  });

  it("does not block on the final day of the grace period", () => {
    const state = evaluatePasswordRotationState({
      user: buildUser({
        passwordExpiresAt: dayjs(now).subtract(7, "day").toDate(),
      }),
      company: rotatingCompany,
      now,
    });

    expect(state.isBlocked).toBe(false);
    expect(state.errorCode).toBe(ERROR_CODES.PASSWORD_EXPIRING_SOON);
  });

  it("blocks once the grace period has elapsed", () => {
    const state = evaluatePasswordRotationState({
      user: buildUser({
        passwordExpiresAt: dayjs(now).subtract(8, "day").toDate(),
      }),
      company: rotatingCompany,
      now,
    });

    expect(state).toEqual({
      isBlocked: true,
      errorCode: ERROR_CODES.PASSWORD_EXPIRED,
    });
  });

  it("blocks immediately when the company allows no grace days", () => {
    const state = evaluatePasswordRotationState({
      user: buildUser({
        passwordExpiresAt: dayjs(now).subtract(1, "day").toDate(),
      }),
      company: buildCompany({ rotatePassword: true, passwordGraceDays: 0 }),
      now,
    });

    expect(state).toEqual({
      isBlocked: true,
      errorCode: ERROR_CODES.PASSWORD_EXPIRED,
    });
  });

  it("derives the expiry from createdAt when the user has no stamped expiry", () => {
    // createdAt + 90 days validity + 7 grace is long past `now`, so the fallback
    // base date has to be honoured for this to block.
    const state = evaluatePasswordRotationState({
      user: buildUser({
        passwordExpiresAt: undefined,
        createdAt: new Date("2025-01-01T00:00:00Z"),
      }),
      company: rotatingCompany,
      now,
    });

    expect(state.isBlocked).toBe(true);
    expect(state.errorCode).toBe(ERROR_CODES.PASSWORD_EXPIRED);
  });

  it("does not block a recently created user with no stamped expiry", () => {
    const state = evaluatePasswordRotationState({
      user: buildUser({
        passwordExpiresAt: undefined,
        createdAt: dayjs(now).subtract(1, "day").toDate(),
      }),
      company: rotatingCompany,
      now,
    });

    expect(state).toEqual({ isBlocked: false });
  });
});

describe("generateRecoveryCodes", () => {
  it("returns ten codes by default", () => {
    expect(generateRecoveryCodes()).toHaveLength(10);
  });

  it("honours an explicit count", () => {
    expect(generateRecoveryCodes(3)).toHaveLength(3);
  });

  it("returns distinct uppercase hex codes", () => {
    const codes = generateRecoveryCodes(20);

    codes.forEach((code) => expect(code).toMatch(/^[0-9A-F]{8}$/));
    expect(new Set(codes).size).toBe(codes.length);
  });
});

describe("shouldPromptUserForMfaEnrollment", () => {
  it("prompts the roles that require MFA at signup", () => {
    expect(shouldPromptUserForMfaEnrollment(USER_TYPE.ADMIN)).toBe(true);
    expect(shouldPromptUserForMfaEnrollment(USER_TYPE.SUPER_ADMIN)).toBe(true);
    expect(shouldPromptUserForMfaEnrollment(USER_TYPE.USER)).toBe(true);
  });

  it("does not prompt a role outside the required set", () => {
    expect(shouldPromptUserForMfaEnrollment(USER_TYPE.SYSTEM)).toBe(false);
  });
});
