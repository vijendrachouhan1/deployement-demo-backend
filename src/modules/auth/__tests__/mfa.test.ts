import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";

import { createApp } from "@/app";
import { OTP_PURPOSE, OtpVerificationModel } from "@/db/models/otpVerification";
import { RecoveryCodeModel, hashRecoveryCode } from "@/db/models/recoveryCodes";
import { User } from "@/db/models/user";
import { COOKIE_NAME, USER_TYPE } from "@/enums";
import { ENROLLED_MFA } from "@/modules/auth/__tests__/utils/auth-test.constant";
import {
  boundLoginMfa,
  mfaSetupCookies,
  pendingMfaCookie,
  setCookies,
} from "@/modules/auth/__tests__/utils/auth-test.util";
import { PENDING_MFA_PURPOSE } from "@/modules/auth/utils/auth.enum";
import { AUTH_RESPONSE_MESSAGES } from "@/modules/auth/utils/auth.constant";
import { workos } from "@/tests/mocks/authkit-provider.mock";
import { mockEmailService } from "@/tests/mocks/email-service.mock";
import { createTestSession } from "@/tests/utils/auth";

/*
 ---------------------------------------------------------------------------
 About these routes
 ---------------------------------------------------------------------------

 Two credentials reach /api/auth/mfa/*:

 1. A full session (the normal `token` cookie), once the user is logged in.
 2. A short-lived `pendingMfaToken` signed with MFA_JWT_TOKEN_SECRET, held
    mid-flow before a session exists.

 A pending token carries a `purpose` naming the flow that minted it, and each
 route accepts only the purposes it belongs to — a login challenge token cannot
 reach setup, disable or reset. PENDING_MFA_ROUTE_ACCESS in auth/index.ts is the
 map; the helpers below build each credential so the tests read like real flows.
 ---------------------------------------------------------------------------
 */

describe("MFA endpoints — /api/auth/mfa", () => {
  const app = createApp();

  const SETUP_IN_PROGRESS = {
    mfa: { enrolled: false, enabled: false, factorIds: ["auth_factor_test"] },
  };

  beforeEach(() => {
    // Provider defaults (enrollAuthFactor, challengeFactor, verifyChallenge,
    // deleteFactor) are reinstalled by the authkit mock's own beforeEach.
  });

  // =========================================================================
  // POST /mfa/setup/initiate — start enrolling an authenticator app
  // =========================================================================

  describe("POST /mfa/setup/initiate", () => {
    describe("auth errors", () => {
      it("returns 401 when the caller has no session and no pending token", async () => {
        const res = await request(app)
          .post("/api/auth/mfa/setup/initiate")
          .set("Accept", "application/json");

        expect(res.status).toBe(401);
        expect(res.body.success).toBe(false);
      });
    });

    describe("success", () => {
      it("returns the QR code and secret for the authenticator app", async () => {
        const { cookie } = await createTestSession();

        const res = await request(app)
          .post("/api/auth/mfa/setup/initiate")
          .set("Cookie", cookie)
          .set("Accept", "application/json");

        expect(res.status).toBe(200);
        expect(res.body.data).toHaveProperty("qrCode");
        expect(res.body.data).toHaveProperty("secret");
      });

      it("records the new factor id on the user", async () => {
        const { user, cookie } = await createTestSession();

        await request(app)
          .post("/api/auth/mfa/setup/initiate")
          .set("Cookie", cookie)
          .set("Accept", "application/json");

        const updated = await User.findById(user._id).lean();
        // "auth_factor_test" is the id returned by the mocked enrollAuthFactor.
        expect(updated?.mfa.factorIds).toContain("auth_factor_test");
      });

      it("sets the challenge and factor cookies for the verify step", async () => {
        const { cookie } = await createTestSession();

        const res = await request(app)
          .post("/api/auth/mfa/setup/initiate")
          .set("Cookie", cookie)
          .set("Accept", "application/json");

        const cookies = setCookies(res);
        expect(
          cookies.some((c) => c.startsWith(`${COOKIE_NAME.MFA_CHALLENGE_ID}=`)),
        ).toBe(true);
        expect(
          cookies.some((c) => c.startsWith(`${COOKIE_NAME.MFA_FACTOR_ID}=`)),
        ).toBe(true);
      });
    });

    describe("server errors", () => {
      it("returns 500 when the MFA provider fails to enroll the factor", async () => {
        const { cookie } = await createTestSession();
        workos.userManagement.enrollAuthFactor.mockRejectedValueOnce(
          new Error("provider down"),
        );

        const res = await request(app)
          .post("/api/auth/mfa/setup/initiate")
          .set("Cookie", cookie)
          .set("Accept", "application/json");

        expect(res.status).toBe(500);
      });
    });
  });

  // =========================================================================
  // POST /mfa/setup/verify — confirm the first authenticator code
  // =========================================================================

  describe("POST /mfa/setup/verify", () => {
    describe("success", () => {
      it("marks the user as enrolled and enabled when the code is valid", async () => {
        const { user, cookie } = await createTestSession(
          USER_TYPE.ADMIN,
          SETUP_IN_PROGRESS,
        );

        const res = await request(app)
          .post("/api/auth/mfa/setup/verify")
          .set("Cookie", [
            cookie,
            ...mfaSetupCookies({
              challengeId: "auth_challenge_test",
              factorId: "auth_factor_test",
            }),
          ])
          .send({ code: "123456" })
          .set("Accept", "application/json");

        expect(res.status).toBe(200);

        const updated = await User.findById(user._id).lean();
        expect(updated?.mfa.enrolled).toBe(true);
        expect(updated?.mfa.enabled).toBe(true);
        expect(updated?.mfa.factorId).toBe("auth_factor_test");
      });

      it("issues a fresh set of recovery codes", async () => {
        const { user, cookie } = await createTestSession(
          USER_TYPE.ADMIN,
          SETUP_IN_PROGRESS,
        );

        const res = await request(app)
          .post("/api/auth/mfa/setup/verify")
          .set("Cookie", [
            cookie,
            ...mfaSetupCookies({
              challengeId: "auth_challenge_test",
              factorId: "auth_factor_test",
            }),
          ])
          .send({ code: "123456" })
          .set("Accept", "application/json");

        expect(res.body.data.recoveryCodes).toHaveLength(10);

        const stored = await RecoveryCodeModel.countDocuments({
          userRef: user._id,
        });
        expect(stored).toBe(10);
      });

      it("stores every new recovery code as unused", async () => {
        const { user, cookie } = await createTestSession(
          USER_TYPE.ADMIN,
          SETUP_IN_PROGRESS,
        );

        await request(app)
          .post("/api/auth/mfa/setup/verify")
          .set("Cookie", [
            cookie,
            ...mfaSetupCookies({
              challengeId: "auth_challenge_test",
              factorId: "auth_factor_test",
            }),
          ])
          .send({ code: "123456" })
          .set("Accept", "application/json");

        const unused = await RecoveryCodeModel.countDocuments({
          userRef: user._id,
          used: false,
        });
        expect(unused).toBe(10);
      });

      it("revokes stale factors when the user had earlier enrolment attempts", async () => {
        const { cookie } = await createTestSession(USER_TYPE.ADMIN, {
          mfa: {
            enrolled: false,
            enabled: false,
            factorIds: ["auth_factor_stale", "auth_factor_test"],
          },
        });

        await request(app)
          .post("/api/auth/mfa/setup/verify")
          .set("Cookie", [
            cookie,
            ...mfaSetupCookies({
              challengeId: "auth_challenge_test",
              factorId: "auth_factor_test",
            }),
          ])
          .send({ code: "123456" })
          .set("Accept", "application/json");

        // Only the abandoned factor is revoked — never the one just confirmed.
        expect(workos.mfa.deleteFactor).toHaveBeenCalledWith(
          "auth_factor_stale",
        );
        expect(workos.mfa.deleteFactor).not.toHaveBeenCalledWith(
          "auth_factor_test",
        );
      });

      it("drops a stale factor from the user once the provider confirms deletion", async () => {
        const { user, cookie } = await createTestSession(USER_TYPE.ADMIN, {
          mfa: {
            enrolled: false,
            enabled: false,
            factorIds: ["auth_factor_stale", "auth_factor_test"],
          },
        });

        await request(app)
          .post("/api/auth/mfa/setup/verify")
          .set("Cookie", [
            cookie,
            ...mfaSetupCookies({
              challengeId: "auth_challenge_test",
              factorId: "auth_factor_test",
            }),
          ])
          .send({ code: "123456" })
          .set("Accept", "application/json");

        const updated = await User.findById(user._id).lean();
        expect(updated?.mfa.factorIds).toEqual(["auth_factor_test"]);
      });

      it("keeps a stale factor on the user when the provider fails to delete it", async () => {
        // Otherwise the factor is live at the provider but forgotten locally, and
        // nothing will ever retry the revocation.
        const { user, cookie } = await createTestSession(USER_TYPE.ADMIN, {
          mfa: {
            enrolled: false,
            enabled: false,
            factorIds: ["auth_factor_stale", "auth_factor_test"],
          },
        });

        workos.mfa.deleteFactor.mockImplementation(async (id: string) => {
          if (id === "auth_factor_stale") throw new Error("provider down");
        });

        const res = await request(app)
          .post("/api/auth/mfa/setup/verify")
          .set("Cookie", [
            cookie,
            ...mfaSetupCookies({
              challengeId: "auth_challenge_test",
              factorId: "auth_factor_test",
            }),
          ])
          .send({ code: "123456" })
          .set("Accept", "application/json");

        expect(res.status).toBe(200);

        const updated = await User.findById(user._id).lean();
        expect(updated?.mfa.factorIds).toContain("auth_factor_stale");
        expect(updated?.mfa.factorIds).toContain("auth_factor_test");
      });

      it("revokes nothing when the user had no earlier factors", async () => {
        const { cookie } = await createTestSession(
          USER_TYPE.ADMIN,
          SETUP_IN_PROGRESS,
        );

        const res = await request(app)
          .post("/api/auth/mfa/setup/verify")
          .set("Cookie", [
            cookie,
            ...mfaSetupCookies({
              challengeId: "auth_challenge_test",
              factorId: "auth_factor_test",
            }),
          ])
          .send({ code: "123456" })
          .set("Accept", "application/json");

        expect(res.status).toBe(200);
        expect(workos.mfa.deleteFactor).not.toHaveBeenCalled();
      });
    });

    describe("business scenarios", () => {
      it("returns 400 when the authenticator code is wrong", async () => {
        const { user, cookie } = await createTestSession();
        workos.mfa.verifyChallenge.mockResolvedValueOnce({ valid: false });

        const res = await request(app)
          .post("/api/auth/mfa/setup/verify")
          .set("Cookie", [
            cookie,
            ...mfaSetupCookies({
              challengeId: "auth_challenge_test",
              factorId: "auth_factor_test",
            }),
          ])
          .send({ code: "000000" })
          .set("Accept", "application/json");

        expect(res.status).toBe(400);

        // A rejected code must not flip the user to enrolled.
        const updated = await User.findById(user._id).lean();
        expect(updated?.mfa.enrolled).toBe(false);
      });
    });
  });

  // =========================================================================
  // POST /mfa/setup/skip — decline enrollment for now
  // =========================================================================

  describe("POST /mfa/setup/skip", () => {
    it("leaves the user un-enrolled and returns 200", async () => {
      const { user, cookie } = await createTestSession();

      const res = await request(app)
        .post("/api/auth/mfa/setup/skip")
        .set("Cookie", [
          cookie,
          ...mfaSetupCookies({ factorId: "auth_factor_test" }),
        ])
        .set("Accept", "application/json");

      expect(res.status).toBe(200);

      const updated = await User.findById(user._id).lean();
      expect(updated?.mfa.enrolled).toBe(false);
    });
  });

  // =========================================================================
  // POST /mfa/verify — the second factor during login (pending-token flow)
  // =========================================================================

  describe("POST /mfa/verify", () => {
    describe("auth errors", () => {
      it("returns 401 when no pending-MFA token is present", async () => {
        const res = await request(app)
          .post("/api/auth/mfa/verify")
          .send({ code: "123456" })
          .set("Accept", "application/json");

        expect(res.status).toBe(401);
      });

      it("returns 401 when the pending-MFA token is malformed", async () => {
        const res = await request(app)
          .post("/api/auth/mfa/verify")
          .set("Cookie", `${COOKIE_NAME.PENDING_MFA_TOKEN}=not-a-real-token`)
          .send({ code: "123456" })
          .set("Accept", "application/json");

        expect(res.status).toBe(401);
      });
    });

    describe("challenge binding", () => {
      it("refuses account A's pending token paired with account B's challenge", async () => {
        const { user: accountA } = await createTestSession(USER_TYPE.ADMIN, {
          mfa: ENROLLED_MFA,
        });
        const { user: accountB } = await createTestSession(USER_TYPE.ADMIN, {
          mfa: {
            ...ENROLLED_MFA,
            factorId: "auth_factor_b",
            factorIds: ["auth_factor_b"],
          },
        });
        expect(accountA._id.toString()).not.toBe(accountB._id.toString());

        // B's own challenge, and a code the provider happily calls valid.
        workos.mfa.verifyChallenge.mockResolvedValue({ valid: true });

        const res = await request(app)
          .post("/api/auth/mfa/verify")
          .set("Cookie", [
            pendingMfaCookie(
              accountA._id.toString(),
              PENDING_MFA_PURPOSE.LOGIN,
              boundLoginMfa(),
            ),
            ...mfaSetupCookies({ challengeId: "auth_challenge_b" }),
          ])
          .send({ code: "123456" })
          .set("Accept", "application/json");

        expect(res.status).toBe(400);
        expect(
          setCookies(res).some((c) => c.startsWith(`${COOKIE_NAME.TOKEN}=`)),
        ).toBe(false);
        // Rejected before the provider is consulted at all.
        expect(workos.mfa.verifyChallenge).not.toHaveBeenCalled();
      });

      it("refuses a pending token that carries no challenge binding", async () => {
        const { user } = await createTestSession(USER_TYPE.ADMIN, {
          mfa: ENROLLED_MFA,
        });
        workos.mfa.verifyChallenge.mockResolvedValue({ valid: true });

        const res = await request(app)
          .post("/api/auth/mfa/verify")
          .set("Cookie", [
            pendingMfaCookie(user._id.toString()),
            ...mfaSetupCookies({ challengeId: "auth_challenge_test" }),
          ])
          .send({ code: "123456" })
          .set("Accept", "application/json");

        expect(res.status).toBe(400);
        expect(
          setCookies(res).some((c) => c.startsWith(`${COOKIE_NAME.TOKEN}=`)),
        ).toBe(false);
      });

      it("refuses a bound factor the account does not own", async () => {
        const { user } = await createTestSession(USER_TYPE.ADMIN, {
          mfa: ENROLLED_MFA,
        });
        workos.mfa.verifyChallenge.mockResolvedValue({ valid: true });

        const res = await request(app)
          .post("/api/auth/mfa/verify")
          .set("Cookie", [
            pendingMfaCookie(
              user._id.toString(),
              PENDING_MFA_PURPOSE.LOGIN,
              boundLoginMfa("auth_challenge_test", "auth_factor_someone_else"),
            ),
            ...mfaSetupCookies({ challengeId: "auth_challenge_test" }),
          ])
          .send({ code: "123456" })
          .set("Accept", "application/json");

        expect(res.status).toBe(400);
      });
    });

    describe("success", () => {
      it("issues a session when the challenge code is valid", async () => {
        const { user } = await createTestSession(USER_TYPE.ADMIN, {
          mfa: ENROLLED_MFA,
        });

        const res = await request(app)
          .post("/api/auth/mfa/verify")
          .set("Cookie", [
            pendingMfaCookie(
              user._id.toString(),
              PENDING_MFA_PURPOSE.LOGIN,
              boundLoginMfa(),
            ),
            ...mfaSetupCookies({ challengeId: "auth_challenge_test" }),
          ])
          .send({ code: "123456" })
          .set("Accept", "application/json");

        expect(res.status).toBe(200);
        expect(
          setCookies(res).some((c) => c.startsWith(`${COOKIE_NAME.TOKEN}=`)),
        ).toBe(true);
      });
    });

    describe("business scenarios", () => {
      it("returns 400 when the challenge code is wrong", async () => {
        const { user } = await createTestSession();
        workos.mfa.verifyChallenge.mockResolvedValueOnce({ valid: false });

        const res = await request(app)
          .post("/api/auth/mfa/verify")
          .set("Cookie", [
            pendingMfaCookie(user._id.toString()),
            ...mfaSetupCookies({ challengeId: "auth_challenge_test" }),
          ])
          .send({ code: "000000" })
          .set("Accept", "application/json");

        expect(res.status).toBe(400);
      });
    });
  });

  // =========================================================================
  // POST /mfa/recovery — log in with a one-time recovery code
  // =========================================================================

  describe("POST /mfa/recovery", () => {
    async function seedRecoveryCode(userId: string, rawCode: string) {
      await RecoveryCodeModel.create({
        code: hashRecoveryCode(rawCode),
        used: false,
        userRef: userId,
      });
    }

    describe("success", () => {
      it("accepts a valid unused recovery code and marks it used", async () => {
        const { user } = await createTestSession();
        await seedRecoveryCode(user._id.toString(), "RECOVER01");

        const res = await request(app)
          .post("/api/auth/mfa/recovery")
          .set("Cookie", pendingMfaCookie(user._id.toString()))
          .send({ recoveryCode: "RECOVER01" })
          .set("Accept", "application/json");

        expect(res.status).toBe(200);
        // The error path also answers 200 (it echoes result.statusCode), so the
        // success flag and the issued session are what separate the two.
        expect(res.body.success).toBe(true);
        expect(
          setCookies(res).some((c) => c.startsWith(`${COOKIE_NAME.TOKEN}=`)),
        ).toBe(true);

        const stored = await RecoveryCodeModel.findOne({ userRef: user._id });
        expect(stored?.used).toBe(true);
      });
    });

    describe("business scenarios", () => {
      it("returns 400 for a recovery code that does not exist", async () => {
        const { user } = await createTestSession();

        const res = await request(app)
          .post("/api/auth/mfa/recovery")
          .set("Cookie", pendingMfaCookie(user._id.toString()))
          .send({ recoveryCode: "WRONGCODE" })
          .set("Accept", "application/json");

        expect(res.status).toBe(400);
      });

      it("returns 400 when the recovery code has already been used", async () => {
        const { user } = await createTestSession();
        await RecoveryCodeModel.create({
          code: hashRecoveryCode("USEDCODE1"),
          used: true,
          userRef: user._id,
        });

        const res = await request(app)
          .post("/api/auth/mfa/recovery")
          .set("Cookie", pendingMfaCookie(user._id.toString()))
          .send({ recoveryCode: "USEDCODE1" })
          .set("Accept", "application/json");

        expect(res.status).toBe(400);
      });
    });
  });

  // =========================================================================
  // POST /mfa/reset/email/otp — send an email OTP to start an MFA reset
  // =========================================================================

  describe("POST /mfa/reset/email/otp", () => {
    it("emails an OTP and stores it under the MFA_RESET purpose", async () => {
      const { user, cookie } = await createTestSession();

      const res = await request(app)
        .post("/api/auth/mfa/reset/email/otp")
        .set("Cookie", cookie)
        .set("Accept", "application/json");

      expect(res.status).toBe(200);
      expect(mockEmailService.sendEmail).toHaveBeenCalledTimes(1);

      const otp = await OtpVerificationModel.findOne({
        identifier: user.email,
        purpose: OTP_PURPOSE.MFA_RESET,
      });
      expect(otp).toBeTruthy();
    });
  });

  // =========================================================================
  // POST /mfa/reset/identity/verify — prove identity before resetting MFA
  // =========================================================================

  describe("POST /mfa/reset/identity/verify", () => {
    /** Seeds a live MFA_RESET OTP. The pre-save hook hashes the raw code. */
    async function seedResetOtp(email: string, code = "654321") {
      await OtpVerificationModel.create({
        identifier: email,
        otpCode: code,
        purpose: OTP_PURPOSE.MFA_RESET,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      });
    }

    it("verifies the email OTP path", async () => {
      const { user, cookie } = await createTestSession();
      await seedResetOtp(user.email);

      const res = await request(app)
        .post("/api/auth/mfa/reset/identity/verify")
        .set("Cookie", cookie)
        .send({ code: "654321", method: "email_otp" })
        .set("Accept", "application/json");

      expect(res.status).toBe(200);
      expect(res.body.data.verified).toBe(true);

      // The email path must not fall through to the authenticator branch.
      expect(workos.mfa.challengeFactor).not.toHaveBeenCalled();
      expect(workos.mfa.verifyChallenge).not.toHaveBeenCalled();
    });

    it("verifies the authenticator path against the MFA provider", async () => {
      const { cookie } = await createTestSession(USER_TYPE.ADMIN, {
        mfa: {
          enrolled: true,
          enabled: true,
          factorId: "auth_factor_test",
          factorIds: ["auth_factor_test"],
        },
      });

      const res = await request(app)
        .post("/api/auth/mfa/reset/identity/verify")
        .set("Cookie", cookie)
        .send({ code: "123456", method: "authenticator" })
        .set("Accept", "application/json");

      expect(res.status).toBe(200);
      expect(res.body.data.verified).toBe(true);
      expect(workos.mfa.challengeFactor).toHaveBeenCalledWith({
        authenticationFactorId: "auth_factor_test",
      });
    });

    describe("business scenarios", () => {
      it("rejects the email path when no reset OTP was issued", async () => {
        const { cookie } = await createTestSession();

        const res = await request(app)
          .post("/api/auth/mfa/reset/identity/verify")
          .set("Cookie", cookie)
          .send({ code: "654321", method: "email_otp" })
          .set("Accept", "application/json");

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
        expect(res.body.message).toBe(
          AUTH_RESPONSE_MESSAGES.INVALID_OR_EXPIRED_OTP,
        );
        expect(res.body.data?.verified).toBeUndefined();
      });

      it("rejects the email path when the submitted code is wrong", async () => {
        const { user, cookie } = await createTestSession();
        await seedResetOtp(user.email, "654321");

        const res = await request(app)
          .post("/api/auth/mfa/reset/identity/verify")
          .set("Cookie", cookie)
          .send({ code: "000000", method: "email_otp" })
          .set("Accept", "application/json");

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
        expect(res.body.message).toBe(AUTH_RESPONSE_MESSAGES.INCORRECT_OTP);
        expect(res.body.data?.verified).toBeUndefined();
      });

      it("rejects the authenticator path when the provider rejects the code", async () => {
        const { cookie } = await createTestSession(USER_TYPE.ADMIN, {
          mfa: {
            enrolled: true,
            enabled: true,
            factorId: "auth_factor_test",
            factorIds: ["auth_factor_test"],
          },
        });
        workos.mfa.verifyChallenge.mockResolvedValueOnce({ valid: false });

        const res = await request(app)
          .post("/api/auth/mfa/reset/identity/verify")
          .set("Cookie", cookie)
          .send({ code: "000000", method: "authenticator" })
          .set("Accept", "application/json");

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
        expect(res.body.data?.verified).toBeUndefined();
      });
    });
  });

  // =========================================================================
  // POST /mfa/recovery/reset — issue a short session to reconfigure MFA
  // =========================================================================

  describe("POST /mfa/recovery/reset", () => {
    it("returns 200 and sets a fresh session cookie", async () => {
      const { cookie } = await createTestSession();

      const res = await request(app)
        .post("/api/auth/mfa/recovery/reset")
        .set("Cookie", cookie)
        .set("Accept", "application/json");

      expect(res.status).toBe(200);
      expect(
        setCookies(res).some((c) => c.startsWith(`${COOKIE_NAME.TOKEN}=`)),
      ).toBe(true);
    });
  });

  // =========================================================================
  // PUT /mfa/disable — turn MFA off and wipe the factors + recovery codes
  // =========================================================================

  describe("PUT /mfa/disable", () => {
    it("clears every MFA field, deletes recovery codes, and removes the factors", async () => {
      const { user, cookie } = await createTestSession(USER_TYPE.ADMIN, {
        mfa: {
          enrolled: true,
          enabled: true,
          factorId: "auth_factor_test",
          factorIds: ["auth_factor_test", "auth_factor_2"],
        },
      });
      await RecoveryCodeModel.create([
        { code: hashRecoveryCode("A"), used: false, userRef: user._id },
        { code: hashRecoveryCode("B"), used: false, userRef: user._id },
      ]);

      const res = await request(app)
        .put("/api/auth/mfa/disable")
        .set("Cookie", cookie)
        .set("Accept", "application/json");

      expect(res.status).toBe(200);

      const updated = await User.findById(user._id).lean();
      expect(updated?.mfa.enrolled).toBe(false);
      expect(updated?.mfa.enabled).toBe(false);
      expect(updated?.mfa.factorIds).toEqual([]);
      expect(updated?.mfa.factorId).toBeNull();

      const remainingCodes = await RecoveryCodeModel.countDocuments({
        userRef: user._id,
      });
      expect(remainingCodes).toBe(0);

      // Each enrolled factor should have been revoked at the provider.
      expect(workos.mfa.deleteFactor).toHaveBeenCalledWith("auth_factor_test");
      expect(workos.mfa.deleteFactor).toHaveBeenCalledWith("auth_factor_2");
    });

    it("calls the provider no times when the user has no enrolled factors", async () => {
      const { user, cookie } = await createTestSession();

      const res = await request(app)
        .put("/api/auth/mfa/disable")
        .set("Cookie", cookie)
        .set("Accept", "application/json");

      expect(res.status).toBe(200);
      expect(workos.mfa.deleteFactor).not.toHaveBeenCalled();

      const updated = await User.findById(user._id).lean();
      expect(updated?.mfa.enrolled).toBe(false);
      expect(updated?.mfa.enabled).toBe(false);
    });
  });
});
