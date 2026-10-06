import { beforeEach, describe, expect, it, vi } from "vitest";

const envState = vi.hoisted(() => ({ development: false, staging: false }));

vi.mock("@/helpers/common", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/helpers/common")>();
  return {
    ...actual,
    isDevEnvironment: () => envState.development,
    isStaging: () => envState.staging,
  };
});

import { OTP_PURPOSE } from "@/db/models/otpVerification";
import { requestOtp, verifyOtp } from "@/modules/auth/helpers/otp.helper";
import { DEV_FIXED_OTP } from "@/modules/auth/utils/auth.constant";
import { mockEmailService } from "@/tests/mocks/email-service.mock";

/**
 * SOC 2 item N1 — the fixed OTP is gated on the environment alone.
 *
 * resolveOtp() used to return DEV_FIXED_OTP for any address containing
 * "bylddtest" in every environment, production included, and sendOtp() rerouted
 * that address's mail to the shared SES sandbox inbox. Both are removed.
 *
 * Each case runs the full request -> deliver -> verify round trip, because the
 * defect was only exploitable end to end: a predictable code is harmless until
 * verifyOtp() accepts it. Purpose is LOGIN with returnToken false, which is the
 * call login.helper.ts:104 makes for passwordless sign-in — the exploit path.
 *
 * Expiry, the attempt cap and payload validation are verifyOtp's own concerns
 * and are covered in otp.test.ts; they are not repeated here.
 *
 * Write-up: soc2/N1-fixed-otp-test-addresses.md
 */

const TEST_SHAPED_ADDRESS = "qa.bylddtest@test.com";
const ORDINARY_ADDRESS = "member@example.com";
const WRONG_OTP = "0000";

// Math.random() === 0.5 puts generateOtp(4) at a fixed 5500, so "not the
// shortcut" is asserted against a known value rather than a 1-in-9000 chance.
const SEEDED_RANDOM_OTP = "5500";

function lastEmail(): { to: string; html: string } {
  const call = mockEmailService.sendEmail.mock.calls.at(-1);
  return call?.[0] as { to: string; html: string };
}

function deliveredOtp(): string {
  return /(\d{4})/.exec(lastEmail().html)?.[1] as string;
}

async function requestLoginOtp(identifier: string): Promise<string> {
  await requestOtp(identifier, OTP_PURPOSE.LOGIN);
  return deliveredOtp();
}

function verifyLoginOtp(identifier: string, otp: string) {
  return verifyOtp(identifier, OTP_PURPOSE.LOGIN, otp, false);
}

describe("OTP environment gate", () => {
  beforeEach(() => {
    envState.development = false;
    envState.staging = false;
  });

  // =========================================================================
  // 1. Production — no request-supplied value may reach the OTP
  // =========================================================================

  describe("in production", () => {
    beforeEach(() => {
      vi.spyOn(Math, "random").mockReturnValue(0.5);
    });

    // ---- Issuing ----------------------------------------------------------

    it("generates a random OTP for an address containing bylddtest", async () => {
      const otp = await requestLoginOtp(TEST_SHAPED_ADDRESS);

      expect(otp).toBe(SEEDED_RANDOM_OTP);
      expect(otp).not.toBe(DEV_FIXED_OTP);
    });

    it("generates a random OTP for an ordinary address", async () => {
      const otp = await requestLoginOtp(ORDINARY_ADDRESS);

      expect(otp).toBe(SEEDED_RANDOM_OTP);
    });

    it("sends the OTP to the address that asked for it", async () => {
      await requestLoginOtp(TEST_SHAPED_ADDRESS);

      expect(lastEmail().to).toBe(TEST_SHAPED_ADDRESS);
    });

    // ---- Happy path -------------------------------------------------------

    it("accepts the generated OTP for an address containing bylddtest", async () => {
      const otp = await requestLoginOtp(TEST_SHAPED_ADDRESS);

      const result = await verifyLoginOtp(TEST_SHAPED_ADDRESS, otp);

      expect(result.success).toBe(true);
    });

    it("accepts the generated OTP for an ordinary address", async () => {
      const otp = await requestLoginOtp(ORDINARY_ADDRESS);

      const result = await verifyLoginOtp(ORDINARY_ADDRESS, otp);

      expect(result.success).toBe(true);
    });

    // ---- Bad path — the closed exploit ------------------------------------

    it("rejects the development code for an address containing bylddtest", async () => {
      await requestLoginOtp(TEST_SHAPED_ADDRESS);

      const result = await verifyLoginOtp(TEST_SHAPED_ADDRESS, DEV_FIXED_OTP);

      expect(result).toMatchObject({ success: false, statusCode: 401 });
    });

    it("rejects the development code for an ordinary address", async () => {
      await requestLoginOtp(ORDINARY_ADDRESS);

      const result = await verifyLoginOtp(ORDINARY_ADDRESS, DEV_FIXED_OTP);

      expect(result).toMatchObject({ success: false, statusCode: 401 });
    });

    it("rejects any other wrong code", async () => {
      await requestLoginOtp(TEST_SHAPED_ADDRESS);

      const result = await verifyLoginOtp(TEST_SHAPED_ADDRESS, WRONG_OTP);

      expect(result).toMatchObject({ success: false, statusCode: 401 });
    });
  });

  // =========================================================================
  // 2. Development and staging — the predictable code still works
  // =========================================================================

  describe.each([
    ["development", () => (envState.development = true)],
    ["staging", () => (envState.staging = true)],
  ])("in %s", (_environment, enter) => {
    beforeEach(() => {
      enter();
    });

    it("issues the fixed OTP", async () => {
      const otp = await requestLoginOtp(ORDINARY_ADDRESS);

      expect(otp).toBe(DEV_FIXED_OTP);
    });

    it("issues the fixed OTP for an address containing bylddtest", async () => {
      const otp = await requestLoginOtp(TEST_SHAPED_ADDRESS);

      expect(otp).toBe(DEV_FIXED_OTP);
    });

    it("accepts the fixed OTP", async () => {
      await requestLoginOtp(ORDINARY_ADDRESS);

      const result = await verifyLoginOtp(ORDINARY_ADDRESS, DEV_FIXED_OTP);

      expect(result.success).toBe(true);
    });

    it("rejects a wrong code", async () => {
      await requestLoginOtp(ORDINARY_ADDRESS);

      const result = await verifyLoginOtp(ORDINARY_ADDRESS, WRONG_OTP);

      expect(result).toMatchObject({ success: false, statusCode: 401 });
    });

    it("sends the OTP to the address that asked for it", async () => {
      await requestLoginOtp(TEST_SHAPED_ADDRESS);

      expect(lastEmail().to).toBe(TEST_SHAPED_ADDRESS);
    });
  });
});
