import { faker } from "@faker-js/faker";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createApp } from "@/app";
import { OTP_PURPOSE, OtpVerificationModel } from "@/db/models/otpVerification";
import {
  buildRequestOtpPayload,
  buildVerifyOtpPayload,
} from "@/modules/auth/__tests__/utils/auth-test.payload";
import { seedOtp } from "@/modules/auth/__tests__/utils/auth-test.seed";
import { setCookies } from "@/modules/auth/__tests__/utils/auth-test.util";
import { ENROLLED_MFA } from "@/modules/auth/__tests__/utils/auth-test.constant";
import { COOKIE_NAME, USER_TYPE } from "@/enums";
import {
  AUTH_RESPONSE_MESSAGES,
  OTP_EXPIRY_MINUTES,
} from "@/modules/auth/utils/auth.constant";
import { mockEmailService } from "@/tests/mocks/email-service.mock";
import { createTestSession } from "@/tests/utils/auth";

/**
 * OTP Routes
 *
 * POST /api/auth/request-otp
 *   Auth required : No
 *   Body : identifier (email or E.164 phone, required), purpose (OTP_PURPOSE enum, required)
 *   Success  : 200 – OTP dispatched
 *   Failures : 400 bad input | 404 user not found | 500 server error
 *
 * POST /api/auth/resend-otp
 *   Same contract as request-otp — different helper (invalidates previous OTP)
 *
 * POST /api/auth/verify-otp
 *   Auth required : No
 *   Body : identifier (required), purpose (OTP_PURPOSE, required), otp (required)
 *   Success  : 200 – returns { email } for SIGNUP purpose, or { user, token } for others
 *   Failures : 400 bad input | 401 invalid / expired OTP | 500 server error
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Route-invocation shorthand for the suite's most-hit endpoint. */
function postVerifyOtp(
  app: ReturnType<typeof createApp>,
  overrides: Record<string, unknown>,
) {
  return request(app)
    .post("/api/auth/verify-otp")
    .send(buildVerifyOtpPayload(overrides))
    .set("Accept", "application/json");
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("OTP routes", () => {
  const app = createApp();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // =========================================================================
  // POST /api/auth/request-otp
  // =========================================================================

  describe("POST /api/auth/request-otp", () => {
    describe("success", () => {
      it("returns 200 when a valid email identifier and purpose are provided", async () => {
        const { user } = await createTestSession();

        const res = await request(app)
          .post("/api/auth/request-otp")
          .send(
            buildRequestOtpPayload({
              identifier: user.email,
              purpose: OTP_PURPOSE.VERIFICATION,
            }),
          )
          .set("Accept", "application/json");

        expect(res.status).toBe(200);
        expect(res.body.message).toBe(AUTH_RESPONSE_MESSAGES.OTP_SENT);
        expect(mockEmailService.sendEmail).toHaveBeenCalledTimes(1);
      });

      it("issues a LOGIN OTP for an email that already has an account", async () => {
        // Only SIGNUP treats an existing account as a conflict.
        const { user } = await createTestSession();

        const res = await request(app)
          .post("/api/auth/request-otp")
          .send(
            buildRequestOtpPayload({
              identifier: user.email,
              purpose: OTP_PURPOSE.LOGIN,
            }),
          )
          .set("Accept", "application/json");

        expect(res.status).toBe(200);
        expect(res.body.message).toBe(AUTH_RESPONSE_MESSAGES.OTP_SENT);

        const record = await OtpVerificationModel.findOne({
          identifier: user.email,
          purpose: OTP_PURPOSE.LOGIN,
        });
        expect(record).toBeTruthy();
      });

      it("replaces the previous pending OTP for the same identifier and purpose", async () => {
        const email = faker.internet.email().toLowerCase();

        await request(app)
          .post("/api/auth/request-otp")
          .send(buildRequestOtpPayload({ identifier: email }))
          .set("Accept", "application/json");

        await request(app)
          .post("/api/auth/resend-otp")
          .send(buildRequestOtpPayload({ identifier: email }))
          .set("Accept", "application/json");

        const count = await OtpVerificationModel.countDocuments({
          identifier: email,
          purpose: OTP_PURPOSE.SIGNUP,
        });
        expect(count).toBe(1);
      });
    });

    describe("purpose-specific behaviour", () => {
      it("returns 409 for a SIGNUP OTP when the email already has an account", async () => {
        const { user } = await createTestSession();

        const res = await request(app)
          .post("/api/auth/request-otp")
          .send(
            buildRequestOtpPayload({
              identifier: user.email,
              purpose: OTP_PURPOSE.SIGNUP,
            }),
          )
          .set("Accept", "application/json");

        expect(res.status).toBe(409);
        expect(res.body.success).toBe(false);
        expect(res.body.message).toBe(
          AUTH_RESPONSE_MESSAGES.USER_ALREADY_EXISTS_EMAIL,
        );
        // No OTP may be stored or sent for a conflicting signup.
        expect(mockEmailService.sendEmail).not.toHaveBeenCalled();
        expect(
          await OtpVerificationModel.countDocuments({
            identifier: user.email,
          }),
        ).toBe(0);
      });

      /*
       * SIGNUP and LOGIN carry different expiry windows (10 vs 5 minutes). These
       * two assertions are what keep the purpose→expiry mapping from collapsing.
       */
      it("gives a SIGNUP OTP the signup expiry window", async () => {
        const email = faker.internet.email().toLowerCase();
        const before = Date.now();

        await request(app)
          .post("/api/auth/request-otp")
          .send(
            buildRequestOtpPayload({
              identifier: email,
              purpose: OTP_PURPOSE.SIGNUP,
            }),
          )
          .set("Accept", "application/json");

        const record = await OtpVerificationModel.findOne({
          identifier: email,
        });
        const minutesOut = (record!.expiresAt.getTime() - before) / (60 * 1000);
        // Bounded on both sides so the SIGNUP window can't be confused with LOGIN's.
        expect(minutesOut).toBeGreaterThanOrEqual(OTP_EXPIRY_MINUTES.SIGNUP);
        expect(minutesOut).toBeLessThan(OTP_EXPIRY_MINUTES.SIGNUP + 1);
      });

      it("gives a LOGIN OTP the shorter login expiry window", async () => {
        const { user } = await createTestSession();
        const before = Date.now();

        await request(app)
          .post("/api/auth/request-otp")
          .send(
            buildRequestOtpPayload({
              identifier: user.email,
              purpose: OTP_PURPOSE.LOGIN,
            }),
          )
          .set("Accept", "application/json");

        const record = await OtpVerificationModel.findOne({
          identifier: user.email,
        });
        const minutesOut = (record!.expiresAt.getTime() - before) / (60 * 1000);
        expect(minutesOut).toBeGreaterThanOrEqual(OTP_EXPIRY_MINUTES.LOGIN);
        expect(minutesOut).toBeLessThan(OTP_EXPIRY_MINUTES.LOGIN + 1);
      });
    });

    describe("validation errors", () => {
      it("returns 400 when identifier is missing", async () => {
        const res = await request(app)
          .post("/api/auth/request-otp")
          .send({ purpose: OTP_PURPOSE.SIGNUP })
          .set("Accept", "application/json");

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
      });

      it("returns 400 when identifier is not a valid email or phone", async () => {
        const res = await request(app)
          .post("/api/auth/request-otp")
          .send({ identifier: "not-valid", purpose: OTP_PURPOSE.SIGNUP })
          .set("Accept", "application/json");

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
      });

      it("returns 400 when purpose is missing", async () => {
        const res = await request(app)
          .post("/api/auth/request-otp")
          .send({ identifier: faker.internet.email() })
          .set("Accept", "application/json");

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
      });

      it("returns 400 when purpose is not a valid OTP_PURPOSE value", async () => {
        const res = await request(app)
          .post("/api/auth/request-otp")
          .send(buildRequestOtpPayload({ purpose: "UNKNOWN_PURPOSE" }))
          .set("Accept", "application/json");

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
      });

      it("returns 400 when the request body is empty", async () => {
        const res = await request(app)
          .post("/api/auth/request-otp")
          .send({})
          .set("Accept", "application/json");

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
      });
    });
  });

  // =========================================================================
  // POST /api/auth/resend-otp
  // =========================================================================

  describe("POST /api/auth/resend-otp", () => {
    describe("validation errors", () => {
      it("returns 400 when identifier is missing", async () => {
        const res = await request(app)
          .post("/api/auth/resend-otp")
          .send({ purpose: OTP_PURPOSE.LOGIN })
          .set("Accept", "application/json");

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
      });

      it("returns 400 when purpose is missing", async () => {
        const res = await request(app)
          .post("/api/auth/resend-otp")
          .send({ identifier: faker.internet.email() })
          .set("Accept", "application/json");

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
      });

      it("returns 400 when purpose is invalid", async () => {
        const res = await request(app)
          .post("/api/auth/resend-otp")
          .send(buildRequestOtpPayload({ purpose: "BAD" }))
          .set("Accept", "application/json");

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
      });
    });
  });

  // =========================================================================
  // POST /api/auth/verify-otp
  // =========================================================================

  describe("POST /api/auth/verify-otp", () => {
    describe("validation errors", () => {
      it("returns 400 when identifier is missing", async () => {
        const res = await request(app)
          .post("/api/auth/verify-otp")
          .send({ purpose: OTP_PURPOSE.LOGIN, otp: "1234" })
          .set("Accept", "application/json");

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
      });

      it("returns 400 when purpose is missing", async () => {
        const res = await request(app)
          .post("/api/auth/verify-otp")
          .send({ identifier: faker.internet.email(), otp: "1234" })
          .set("Accept", "application/json");

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
      });

      it("returns 400 when otp is missing", async () => {
        const res = await request(app)
          .post("/api/auth/verify-otp")
          .send({
            identifier: faker.internet.email(),
            purpose: OTP_PURPOSE.LOGIN,
          })
          .set("Accept", "application/json");

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
      });

      it("returns 400 when the request body is empty", async () => {
        const res = await request(app)
          .post("/api/auth/verify-otp")
          .send({})
          .set("Accept", "application/json");

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
      });
    });

    describe("success", () => {
      it("issues a session cookie for a valid LOGIN-purpose OTP (web)", async () => {
        const { user } = await createTestSession();
        await seedOtp({ identifier: user.email, purpose: OTP_PURPOSE.LOGIN });

        const res = await postVerifyOtp(app, {
          identifier: user.email,
          purpose: OTP_PURPOSE.LOGIN,
          otp: "1234",
        });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.user).toHaveProperty("email", user.email);

        const cookies = setCookies(res);
        expect(cookies.some((c) => c.startsWith("token="))).toBe(true);
      });

      it("returns a token in the body for a valid LOGIN-purpose OTP (mobile)", async () => {
        const { user } = await createTestSession();
        await seedOtp({ identifier: user.email, purpose: OTP_PURPOSE.LOGIN });

        // returnToken defaults to true, so a non-signup flow must issue a session.
        const res = await request(app)
          .post("/api/auth/verify-otp")
          .send(
            buildVerifyOtpPayload({
              identifier: user.email,
              purpose: OTP_PURPOSE.LOGIN,
              otp: "1234",
            }),
          )
          .set("Accept", "application/json")
          .set("x-client-platform", "mobile");

        expect(res.status).toBe(200);
        expect(typeof res.body.data.token).toBe("string");
        expect(res.body.data.token.length).toBeGreaterThan(0);
      });

      /*
       * A second factor guards the password flow only. The OTP is itself proof of
       * a channel the account owns, so enrolment must not add a step here — the
       * frontend has no MFA screen on this path and would strand the user on a
       * challenge it never renders.
       */
      it("issues a session directly when the user has MFA on", async () => {
        const { user } = await createTestSession(USER_TYPE.ADMIN, {
          mfa: ENROLLED_MFA,
        });
        await seedOtp({ identifier: user.email, purpose: OTP_PURPOSE.LOGIN });

        const res = await postVerifyOtp(app, {
          identifier: user.email,
          purpose: OTP_PURPOSE.LOGIN,
          otp: "1234",
        });

        expect(res.status).toBe(200);
        expect(res.body.messageCode).toBeUndefined();

        const cookies = setCookies(res);
        expect(cookies.some((c) => c.startsWith("token="))).toBe(true);
        expect(
          cookies.some((c) =>
            c.startsWith(`${COOKIE_NAME.PENDING_MFA_TOKEN}=`),
          ),
        ).toBe(false);
      });

      it("consumes the OTP on success", async () => {
        const { user } = await createTestSession();
        await seedOtp({ identifier: user.email, purpose: OTP_PURPOSE.LOGIN });

        await postVerifyOtp(app, {
          identifier: user.email,
          purpose: OTP_PURPOSE.LOGIN,
          otp: "1234",
        });

        const record = await OtpVerificationModel.findOne({
          identifier: user.email,
        });
        expect(record?.isUsed).toBe(true);
        expect(record?.verifiedAt).toBeTruthy();
      });

      it("returns only the email — no token — for an email SIGNUP OTP", async () => {
        const email = faker.internet.email().toLowerCase();
        await seedOtp({ identifier: email, purpose: OTP_PURPOSE.SIGNUP });

        const res = await postVerifyOtp(app, {
          identifier: email,
          purpose: OTP_PURPOSE.SIGNUP,
          otp: "1234",
        });

        expect(res.status).toBe(200);
        expect(res.body.data.email).toBe(email);
        // SIGNUP only confirms the address; registration issues the session later.
        expect(res.body.data.token).toBeUndefined();
      });
    });

    describe("business scenarios", () => {
      it("returns 401 when OTP is incorrect", async () => {
        const { user } = await createTestSession();
        await seedOtp({
          identifier: user.email,
          purpose: OTP_PURPOSE.VERIFICATION,
          otp: "5678",
        });

        const res = await postVerifyOtp(app, {
          identifier: user.email,
          purpose: OTP_PURPOSE.VERIFICATION,
          otp: "0000",
        });

        expect(res.status).toBe(401);
        expect(res.body.success).toBe(false);
        expect(res.body.message).toBe(AUTH_RESPONSE_MESSAGES.INCORRECT_OTP);
      });

      it("counts a wrong attempt against the record", async () => {
        const { user } = await createTestSession();
        await seedOtp({
          identifier: user.email,
          purpose: OTP_PURPOSE.VERIFICATION,
          otp: "5678",
        });

        await postVerifyOtp(app, {
          identifier: user.email,
          purpose: OTP_PURPOSE.VERIFICATION,
          otp: "0000",
        });

        const record = await OtpVerificationModel.findOne({
          identifier: user.email,
        });
        expect(record?.attempts).toBe(1);
        expect(record?.isUsed).toBe(false);
      });

      it("returns 401 when the OTP is expired", async () => {
        const { user } = await createTestSession();
        await seedOtp({
          identifier: user.email,
          purpose: OTP_PURPOSE.VERIFICATION,
          expiresInMs: -1000,
        });

        const res = await postVerifyOtp(app, {
          identifier: user.email,
          purpose: OTP_PURPOSE.VERIFICATION,
          otp: "1234",
        });

        expect(res.status).toBe(401);
        expect(res.body.message).toBe(
          AUTH_RESPONSE_MESSAGES.INVALID_OR_EXPIRED_OTP,
        );
      });

      it("returns 401 when no OTP was ever issued for the identifier", async () => {
        const { user } = await createTestSession();

        const res = await postVerifyOtp(app, {
          identifier: user.email,
          purpose: OTP_PURPOSE.LOGIN,
          otp: "1234",
        });

        expect(res.status).toBe(401);
        expect(res.body.message).toBe(
          AUTH_RESPONSE_MESSAGES.INVALID_OR_EXPIRED_OTP,
        );
      });

      it("rejects a replayed OTP — the same code cannot be verified twice", async () => {
        const { user } = await createTestSession();
        await seedOtp({ identifier: user.email, purpose: OTP_PURPOSE.LOGIN });

        const first = await postVerifyOtp(app, {
          identifier: user.email,
          purpose: OTP_PURPOSE.LOGIN,
          otp: "1234",
        });
        expect(first.status).toBe(200);

        const second = await postVerifyOtp(app, {
          identifier: user.email,
          purpose: OTP_PURPOSE.LOGIN,
          otp: "1234",
        });

        expect(second.status).toBe(401);
        expect(second.body.message).toBe(
          AUTH_RESPONSE_MESSAGES.INVALID_OR_EXPIRED_OTP,
        );
        expect(second.body.data?.token).toBeUndefined();
      });

      /*
       * Lockout boundary. `attempts` is incremented AFTER the check, so at check
       * time it equals the number of attempts already consumed: with maxAttempts
       * 3, attempts 0/1/2 are still allowed and attempts 3 is locked out. The two
       * tests below pin each side of that boundary.
       */
      it("still accepts the last allowed attempt (one below maxAttempts)", async () => {
        const { user } = await createTestSession();
        const record = await seedOtp({
          identifier: user.email,
          purpose: OTP_PURPOSE.LOGIN,
          attempts: 2,
        });
        expect(record.maxAttempts).toBe(3);

        const res = await postVerifyOtp(app, {
          identifier: user.email,
          purpose: OTP_PURPOSE.LOGIN,
          otp: "1234",
        });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
      });

      it("locks out once maxAttempts have been consumed", async () => {
        const { user } = await createTestSession();
        const record = await seedOtp({
          identifier: user.email,
          purpose: OTP_PURPOSE.LOGIN,
          attempts: 3,
        });
        expect(record.attempts).toBe(record.maxAttempts);

        const res = await postVerifyOtp(app, {
          identifier: user.email,
          purpose: OTP_PURPOSE.LOGIN,
          otp: "1234",
        });

        expect(res.status).toBe(401);
        expect(res.body.message).toBe(AUTH_RESPONSE_MESSAGES.OTP_MAX_ATTEMPTS);
        // A locked-out request must not consume another attempt.
        const after = await OtpVerificationModel.findById(record._id);
        expect(after?.attempts).toBe(3);
      });
    });
  });
});
