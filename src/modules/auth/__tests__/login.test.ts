import { faker } from "@faker-js/faker";
import { beforeEach, describe, expect, it, vi } from "vitest";

import request from "supertest";

import { createApp } from "@/app";
import { ERROR_CODES } from "@/constants/error-codes";
import { COOKIE_NAME, USER_TYPE } from "@/enums";
import {
  buildOtpLoginPayload,
  buildPasswordLoginPayload,
} from "@/modules/auth/__tests__/utils/auth-test.payload";
import { seedLoginOtp } from "@/modules/auth/__tests__/utils/auth-test.seed";
import {
  hasCookie,
  setCookies,
} from "@/modules/auth/__tests__/utils/auth-test.util";
import {
  login,
  loginAs,
  seedPasswordUser,
} from "@/modules/auth/__tests__/utils/login-test.util";
import { AUTH_RESPONSE_MESSAGES } from "@/modules/auth/utils/auth.constant";
import {
  mockAuthKitProvider,
  workos,
} from "@/tests/mocks/authkit-provider.mock";
import { createTestSession } from "@/tests/utils/auth";

const app = createApp();

/**
 * POST /api/auth/login — request handling
 *
 * Auth required : No
 * Body : email (required), password (optional), loginType (required: "password"|"otp"), otp (optional)
 *
 * Success  : 200 – sets cookie (web) / returns token (mobile)
 * Failures : 400 bad input | 401 wrong credentials / disabled account | 500 server error
 *
 * Who may log in lives in login-account-status.test.ts; what a successful login
 * issues (MFA gate, token claims, audit trail) lives in login-session.test.ts.
 */

describe("POST /api/auth/login", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // =========================================================================
  // 1. Happy Path (password login)
  // =========================================================================

  describe("success — password login", () => {
    it("returns 200 with user data for a valid password login (web)", async () => {
      // Seed a real user and stub the provider to authenticate them
      const { user } = await seedPasswordUser();

      const res = await loginAs(user);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty("user");
    });

    it("sets auth cookies on successful password login (web)", async () => {
      const { user } = await seedPasswordUser();

      const res = await loginAs(user);

      expect(res.status).toBe(200);
      const cookies = setCookies(res);
      expect(cookies).toBeDefined();
      expect(cookies.some((c: string) => c.startsWith("token="))).toBe(true);
    });

    it("returns token in response body for mobile clients (password login)", async () => {
      const { user } = await seedPasswordUser();

      const res = await loginAs(user, { "x-client-platform": "mobile" });

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveProperty("token");
      expect(typeof res.body.data.token).toBe("string");
    });
  });

  // =========================================================================
  // 1b. MFA gate — no session may be issued before the challenge is answered
  // =========================================================================

  describe("mfa gate — password login", () => {
    const enrolledMfa = {
      mfa: {
        enrolled: true,
        enabled: true,
        factorId: "auth_factor_test",
        factorIds: ["auth_factor_test"],
      },
    };

    it("challenges instead of issuing a session when mongo has mfa enrolled (web)", async () => {
      const { user } = await createTestSession(USER_TYPE.ADMIN, enrolledMfa);

      mockAuthKitProvider.authenticateWithPassword.mockResolvedValue({
        user: { id: user.externalUserId, email: user.email },
      });
      workos.mfa.challengeFactor.mockResolvedValue({ id: "auth_challenge_1" });

      const res = await request(app)
        .post("/api/auth/login")
        .send(buildPasswordLoginPayload({ email: user.email }))
        .set("Accept", "application/json");

      expect(res.status).toBe(200);
      expect(res.body.messageCode).toBe(ERROR_CODES.MFA_REQUIRED);
      expect(res.body.data).not.toHaveProperty("token");
    });

    it("challenges instead of issuing a session on mobile", async () => {
      const { user } = await createTestSession(USER_TYPE.ADMIN, enrolledMfa);

      mockAuthKitProvider.authenticateWithPassword.mockResolvedValue({
        user: { id: user.externalUserId, email: user.email },
      });
      workos.mfa.challengeFactor.mockResolvedValue({ id: "auth_challenge_3" });

      const res = await request(app)
        .post("/api/auth/login")
        .send(buildPasswordLoginPayload({ email: user.email }))
        .set("Accept", "application/json")
        .set("x-client-platform", "mobile");

      expect(res.status).toBe(200);
      expect(res.body.messageCode).toBe(ERROR_CODES.MFA_REQUIRED);
      expect(res.body.data).not.toHaveProperty("token");
      expect(res.body.data).not.toHaveProperty("refreshToken");
      expect(res.body.data.pendingMfaToken).toEqual(expect.any(String));
      expect(res.body.data.mfaChallengeId).toBe("auth_challenge_3");
    });

    it("completes the mobile challenge with the pending token header", async () => {
      const { user } = await createTestSession(USER_TYPE.ADMIN, enrolledMfa);

      mockAuthKitProvider.authenticateWithPassword.mockResolvedValue({
        user: { id: user.externalUserId, email: user.email },
      });
      workos.mfa.challengeFactor.mockResolvedValue({ id: "auth_challenge_4" });
      workos.mfa.verifyChallenge.mockResolvedValue({ valid: true });

      const login = await request(app)
        .post("/api/auth/login")
        .send(buildPasswordLoginPayload({ email: user.email }))
        .set("Accept", "application/json")
        .set("x-client-platform", "mobile");

      const { pendingMfaToken, mfaChallengeId } = login.body.data;

      const res = await request(app)
        .post("/api/auth/mfa/verify")
        .send({ code: "123456", mfaChallengeId })
        .set("Accept", "application/json")
        .set("x-client-platform", "mobile")
        .set("x-pending-mfa-token", pendingMfaToken);

      expect(res.status).toBe(200);
      expect(res.body.data.token).toEqual(expect.any(String));
      expect(res.body.data.refreshToken).toEqual(expect.any(String));
    });

    it("challenges when the provider requires mfa but mongo is out of sync", async () => {
      const { user } = await createTestSession(USER_TYPE.ADMIN, {
        mfa: { enrolled: false, enabled: false, factorId: "auth_factor_test" },
      });

      mockAuthKitProvider.authenticateWithPassword.mockResolvedValue({
        user: { id: user.externalUserId, email: user.email },
        mfaRequired: true,
      });
      workos.mfa.challengeFactor.mockResolvedValue({ id: "auth_challenge_2" });

      const res = await request(app)
        .post("/api/auth/login")
        .send(buildPasswordLoginPayload({ email: user.email }))
        .set("Accept", "application/json");

      expect(res.status).toBe(200);
      expect(res.body.messageCode).toBe(ERROR_CODES.MFA_REQUIRED);

      const cookies = (res.headers["set-cookie"] ?? []) as unknown as string[];
      expect(cookies.some((c: string) => c.startsWith("token="))).toBe(false);
    });

    it("refuses login when mfa is required but no factor is registered", async () => {
      const { user } = await createTestSession(USER_TYPE.ADMIN, {
        mfa: { enrolled: true, enabled: true },
      });

      mockAuthKitProvider.authenticateWithPassword.mockResolvedValue({
        user: { id: user.externalUserId, email: user.email },
      });

      const res = await request(app)
        .post("/api/auth/login")
        .send(buildPasswordLoginPayload({ email: user.email }))
        .set("Accept", "application/json");

      expect(res.status).toBe(401);
      expect(res.body.message).toBe(AUTH_RESPONSE_MESSAGES.MFA_FACTOR_MISSING);
    });
  });

  // =========================================================================
  // 2. Validation Errors (confused user)
  // =========================================================================

  describe("validation errors", () => {
    it("returns 400 when email is missing", async () => {
      const res = await login({ password: "pass123", loginType: "password" });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it("returns 400 when email is malformed", async () => {
      const res = await login(
        buildPasswordLoginPayload({ email: "not-an-email" }),
      );

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it("returns 400 when loginType is missing", async () => {
      const res = await login({
        email: faker.internet.email(),
        password: "pass123",
      });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it("returns 400 when loginType is an invalid value", async () => {
      const res = await login(
        buildPasswordLoginPayload({ loginType: "magic" }),
      );

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it("authenticates a short existing password without applying complexity rules", async () => {
      const { user } = await seedPasswordUser();
      const res = await login(
        buildPasswordLoginPayload({ email: user.email, password: "abc" }),
      );

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(mockAuthKitProvider.authenticateWithPassword).toHaveBeenCalledWith(
        {
          email: user.email,
          password: "abc",
        },
      );
    });

    it("returns 400 when password is an empty string (still required)", async () => {
      const res = await login(buildPasswordLoginPayload({ password: "" }));

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(
        mockAuthKitProvider.authenticateWithPassword,
      ).not.toHaveBeenCalled();
    });

    it("returns 400 when otp is not 4 digits for otp loginType", async () => {
      const res = await login(buildOtpLoginPayload({ otp: "12" }));

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it("returns 400 when request body is empty", async () => {
      const res = await login({});

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it("does NOT call the auth provider when validation fails", async () => {
      await login({ email: "bad-email", loginType: "password" });

      expect(
        mockAuthKitProvider.authenticateWithPassword,
      ).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // 3. OTP login path
  // =========================================================================

  describe("success — OTP login", () => {
    it("returns 200 and a session for a valid LOGIN-purpose OTP", async () => {
      const { user } = await createTestSession();
      await seedLoginOtp(user.email);

      const res = await login(buildOtpLoginPayload({ email: user.email }));

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(hasCookie(res, COOKIE_NAME.TOKEN)).toBe(true);
    });

    it("rejects an OTP login when the code is wrong", async () => {
      const { user } = await createTestSession();
      await seedLoginOtp(user.email, "1234");

      const res = await login(
        buildOtpLoginPayload({ email: user.email, otp: "9999" }),
      );

      expect(res.status).toBe(401);
      expect(res.body.message).toBe(AUTH_RESPONSE_MESSAGES.INCORRECT_OTP);
      expect(hasCookie(res, COOKIE_NAME.TOKEN)).toBe(false);
    });

    it("rejects an OTP login with no OTP supplied", async () => {
      const { user } = await createTestSession();
      const { otp: _otp, ...payload } = buildOtpLoginPayload({
        email: user.email,
      });

      const res = await login(payload);

      expect(res.status).toBe(400);
      expect(res.body.message).toBe(AUTH_RESPONSE_MESSAGES.OTP_REQUIRED);
    });
  });

  // =========================================================================
  // 4. Server Errors (3 AM engineer)
  // =========================================================================

  describe("server errors", () => {
    it("returns 500 when the auth provider throws during password authentication", async () => {
      mockAuthKitProvider.authenticateWithPassword.mockRejectedValueOnce(
        new Error("Provider is down"),
      );

      const { user } = await createTestSession();

      const res = await loginAs(user);

      expect(res.status).toBe(500);
    });
  });
});
