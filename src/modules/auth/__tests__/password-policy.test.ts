import {
  PASSWORD_MIN_LENGTH,
  PASSWORD_VALIDATION_MESSAGES,
} from "@/modules/auth/utils/auth.constant";
import {
  RegisterBodySchema,
  UpdatePasswordValidationSchema,
  strongPasswordSchema,
} from "@/modules/auth/utils/auth.validation";
import {
  ChangePasswordBodySchema,
  ChangeUserPasswordBodySchema,
} from "@/modules/users/utils/users.validation";
import { describe, expect, it } from "vitest";

/**
 * Backend safety-layer tests for the canonical strong-password policy.
 * These assert the SHARED schema and every create/reset/change path enforce
 * the identical rules (min 8 + upper + lower + number + special [@$%*&?!]).
 */

const VALID_PASSWORD = "StrongPass@123";

// Each invalid case documents WHICH rule it breaks.
const INVALID_CASES: Array<{ label: string; password: string }> = [
  { label: "too short (< 8 chars)", password: "Ab@1" },
  { label: "missing a number", password: "StrongPass@" },
  { label: "missing a special character", password: "StrongPass123" },
  { label: "missing an uppercase letter", password: "strongpass@123" },
  { label: "missing a lowercase letter", password: "STRONGPASS@123" },
];

describe("strongPasswordSchema (single source of truth)", () => {
  it("has a minimum length of 8", () => {
    expect(PASSWORD_MIN_LENGTH).toBe(8);
  });

  it("accepts a strong password", () => {
    expect(strongPasswordSchema.safeParse(VALID_PASSWORD).success).toBe(true);
  });

  for (const { label, password } of INVALID_CASES) {
    it(`rejects a password that is ${label}`, () => {
      expect(strongPasswordSchema.safeParse(password).success).toBe(false);
    });
  }

  it("reports a clear, specific message for a too-short password", () => {
    const result = strongPasswordSchema.safeParse("Ab@1");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe(
        PASSWORD_VALIDATION_MESSAGES.MIN_LENGTH,
      );
    }
  });
});

describe("RegisterBodySchema.password enforces the strong policy", () => {
  const base = {
    name: { first: "Jane", last: "Doe" },
    email: "jane@example.com",
  };

  it("accepts a strong password", () => {
    expect(
      RegisterBodySchema.safeParse({ ...base, password: VALID_PASSWORD })
        .success,
    ).toBe(true);
  });

  for (const { label, password } of INVALID_CASES) {
    it(`rejects registration when the password is ${label}`, () => {
      expect(RegisterBodySchema.safeParse({ ...base, password }).success).toBe(
        false,
      );
    });
  }
});

describe("UpdatePasswordValidationSchema (reset flow) enforces the strong policy", () => {
  const base = { email: "jane@example.com", token: "reset-token" };

  it("accepts a strong password", () => {
    expect(
      UpdatePasswordValidationSchema.body.safeParse({
        ...base,
        password: VALID_PASSWORD,
      }).success,
    ).toBe(true);
  });

  for (const { label, password } of INVALID_CASES) {
    it(`rejects a reset when the password is ${label}`, () => {
      expect(
        UpdatePasswordValidationSchema.body.safeParse({ ...base, password })
          .success,
      ).toBe(false);
    });
  }
});

describe("ChangePasswordBodySchema.newPassword enforces the strong policy", () => {
  it("accepts a strong new password and keeps the match refine", () => {
    expect(
      ChangePasswordBodySchema.safeParse({
        currentPassword: "whatever",
        newPassword: VALID_PASSWORD,
        confirmedPassword: VALID_PASSWORD,
      }).success,
    ).toBe(true);
  });

  it("rejects when the confirmed password does not match (refine preserved)", () => {
    expect(
      ChangePasswordBodySchema.safeParse({
        currentPassword: "whatever",
        newPassword: VALID_PASSWORD,
        confirmedPassword: "DifferentPass@123",
      }).success,
    ).toBe(false);
  });

  for (const { label, password } of INVALID_CASES) {
    it(`rejects a change when the new password is ${label}`, () => {
      expect(
        ChangePasswordBodySchema.safeParse({
          currentPassword: "whatever",
          newPassword: password,
          confirmedPassword: password,
        }).success,
      ).toBe(false);
    });
  }
});

describe("ChangeUserPasswordBodySchema.newPassword enforces the strong policy", () => {
  it("accepts a strong new password", () => {
    expect(
      ChangeUserPasswordBodySchema.safeParse({
        currentPassword: "whatever",
        newPassword: VALID_PASSWORD,
        confirmedPassword: VALID_PASSWORD,
      }).success,
    ).toBe(true);
  });

  for (const { label, password } of INVALID_CASES) {
    it(`rejects a change when the new password is ${label}`, () => {
      expect(
        ChangeUserPasswordBodySchema.safeParse({
          currentPassword: "whatever",
          newPassword: password,
          confirmedPassword: password,
        }).success,
      ).toBe(false);
    });
  }
});
