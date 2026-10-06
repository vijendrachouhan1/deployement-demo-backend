import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createApp } from "@/app";

import { AuditLogModel } from "@/db/models/audit-logs/audit-log";
import { Company } from "@/db/models/company";
import { RecoveryCodeModel, hashRecoveryCode } from "@/db/models/recoveryCodes";
import {
  SYSTEM_SUBSYSTEM_REFS,
  SystemSubsystem,
} from "@/db/plugins/audit/utils/subsystem";
import { ERROR_CODES } from "@/constants/error-codes";
import { COOKIE_NAME, USER_TYPE } from "@/enums";
import { drainPendingEmits } from "@/modules/audit-logs/helpers/emit.helper";
import { AUTH_RESPONSE_MESSAGES } from "@/modules/auth/utils/auth.constant";
import { ENROLLED_MFA } from "@/modules/auth/__tests__/utils/auth-test.constant";
import { buildOtpLoginPayload } from "@/modules/auth/__tests__/utils/auth-test.payload";
import { seedLoginOtp } from "@/modules/auth/__tests__/utils/auth-test.seed";
import {
  cookieJar,
  hasCookie,
  setCookies,
} from "@/modules/auth/__tests__/utils/auth-test.util";
import {
  login,
  loginAs,
  seedPasswordUser,
} from "@/modules/auth/__tests__/utils/login-test.util";
import { workos } from "@/tests/mocks/authkit-provider.mock";
import { createTestSession } from "@/tests/utils/auth";

/**
 * POST /api/auth/login — what a successful login issues
 *
 * Covers the MFA gate (challenge vs. session), the claims and cookies carried on
 * the session, and the audit trail a login leaves behind.
 *
 * Request handling lives in login.test.ts; refusals in
 * login-account-status.test.ts.
 */

describe("POST /api/auth/login — session issuance", () => {
  const app = createApp();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // =========================================================================
  // 1. MFA gate — enrolment alone is not enough; the login type decides
  // =========================================================================

  describe("MFA gate", () => {
    it("challenges an MFA-enrolled user logging in with a password", async () => {
      const { user } = await seedPasswordUser(USER_TYPE.ADMIN, {
        mfa: ENROLLED_MFA,
      });

      const res = await loginAs(user);

      expect(res.status).toBe(200);
      expect(res.body.messageCode).toBe("MFA_REQUIRED");

      // A challenge, not a session.
      expect(hasCookie(res, COOKIE_NAME.PENDING_MFA_TOKEN)).toBe(true);
      expect(hasCookie(res, COOKIE_NAME.MFA_CHALLENGE_ID)).toBe(true);
      expect(hasCookie(res, COOKIE_NAME.TOKEN)).toBe(false);
      expect(workos.mfa.challengeFactor).toHaveBeenCalledWith({
        authenticationFactorId: ENROLLED_MFA.factorId,
      });
    });

    it("does NOT challenge an MFA-enrolled user logging in with an OTP", async () => {
      const { user } = await createTestSession(USER_TYPE.ADMIN, {
        mfa: ENROLLED_MFA,
      });
      await seedLoginOtp(user.email);

      const res = await login(buildOtpLoginPayload({ email: user.email }));

      expect(res.status).toBe(200);

      expect(hasCookie(res, COOKIE_NAME.TOKEN)).toBe(true);
      expect(hasCookie(res, COOKIE_NAME.PENDING_MFA_TOKEN)).toBe(false);
      expect(workos.mfa.challengeFactor).not.toHaveBeenCalled();
    });

    it("does NOT challenge a user who enrolled but switched MFA off", async () => {
      const { user } = await seedPasswordUser(USER_TYPE.ADMIN, {
        mfa: { ...ENROLLED_MFA, enabled: false },
      });

      const res = await loginAs(user);

      expect(res.status).toBe(200);
      expect(hasCookie(res, COOKIE_NAME.TOKEN)).toBe(true);
      expect(hasCookie(res, COOKIE_NAME.PENDING_MFA_TOKEN)).toBe(false);
    });

    /*
     * Mobile used to be exempt from the gate entirely: the same enrolled account
     * the browser had to challenge handed a phone a full session for a password.
     * There is no cookie jar here, so the challenge travels in the body instead.
     */
    it("challenges an MFA-enrolled user on mobile, in the response body", async () => {
      const { user } = await seedPasswordUser(USER_TYPE.ADMIN, {
        mfa: ENROLLED_MFA,
      });

      const res = await loginAs(user, { "x-client-platform": "mobile" });

      expect(res.status).toBe(200);
      expect(res.body.messageCode).toBe("MFA_REQUIRED");
      expect(res.body.data.pendingMfaToken).toEqual(expect.any(String));
      expect(res.body.data.mfaChallengeId).toEqual(expect.any(String));

      // No session until the factor is produced.
      expect(res.body.data.token).toBeUndefined();
      expect(res.body.data.refreshToken).toBeUndefined();
    });

    it("completes the mobile challenge via the pending-token header", async () => {
      const { user } = await seedPasswordUser(USER_TYPE.ADMIN, {
        mfa: ENROLLED_MFA,
      });
      workos.mfa.verifyChallenge.mockResolvedValue({ valid: true });

      const loginRes = await loginAs(user, { "x-client-platform": "mobile" });
      const { pendingMfaToken, mfaChallengeId } = loginRes.body.data;

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

    it("does NOT challenge a user who is not enrolled in MFA", async () => {
      const { user } = await seedPasswordUser();

      const res = await loginAs(user);

      expect(res.status).toBe(200);
      expect(hasCookie(res, COOKIE_NAME.TOKEN)).toBe(true);
      expect(hasCookie(res, COOKIE_NAME.PENDING_MFA_TOKEN)).toBe(false);
    });

    it("refuses the login when the enrolled factor is missing", async () => {
      // Nothing to challenge, so there is no safe way through. Failing closed
      // beats handing out a session the second factor was supposed to guard.
      const { user } = await seedPasswordUser(USER_TYPE.ADMIN, {
        mfa: { enrolled: true, enabled: true, factorIds: [] },
      });

      const res = await loginAs(user);

      expect(res.status).toBe(401);
      expect(res.body.message).toBe(AUTH_RESPONSE_MESSAGES.MFA_FACTOR_MISSING);
      expect(hasCookie(res, COOKIE_NAME.TOKEN)).toBe(false);
      expect(hasCookie(res, COOKIE_NAME.PENDING_MFA_TOKEN)).toBe(false);
      expect(workos.mfa.challengeFactor).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // 2. Session token claims
  // =========================================================================

  describe("token claims", () => {
    it("resolves permissions from the environment role, not an org role", async () => {
      // No USER_TYPE value starts with "org", so the org-role lookup must never
      // be reached — even though the company does carry an externalId.
      const { user, company } = await seedPasswordUser(USER_TYPE.ADMIN);
      expect(company.externalId).toBeTruthy();

      const res = await loginAs(user);

      expect(res.status).toBe(200);
      expect(workos.authorization.getEnvironmentRole).toHaveBeenCalledWith(
        USER_TYPE.ADMIN,
      );
      expect(workos.authorization.getOrganizationRole).not.toHaveBeenCalled();
    });

    it("reports no password expiry for a company without password rotation", async () => {
      const { user, company } = await seedPasswordUser();
      const reloaded = await Company.findById(company._id);
      expect(reloaded?.rotatePassword).toBeFalsy();

      const res = await loginAs(user);

      expect(res.status).toBe(200);
      expect(res.body.data.isPasswordExpired).toBe(false);
      expect(
        setCookies(res).some((c) =>
          c.startsWith(`${COOKIE_NAME.PASSWORD_EXPIRED}=false`),
        ),
      ).toBe(true);
    });

    /*
     * Rotation state rides on every password-login path, enrolled or not. It used
     * to be dropped by the non-enrolled early return, so the most common login of
     * all reported no expiry while the middleware went on to 403 every request.
     */
    it("reports password expiry for a non-enrolled user with rotation blocked", async () => {
      const { user, company } = await seedPasswordUser(USER_TYPE.ADMIN, {
        forcePasswordChange: true,
      });
      await Company.findByIdAndUpdate(company._id, { rotatePassword: true });

      const res = await loginAs(user);

      expect(res.status).toBe(200);
      expect(res.body.data.isPasswordExpired).toBe(true);
      expect(
        setCookies(res).some((c) =>
          c.startsWith(`${COOKIE_NAME.PASSWORD_EXPIRED}=true`),
        ),
      ).toBe(true);
    });

    /*
     * The response flag alone was never enforcement: the middleware blocks only
     * when the session token records a password login, and the token carried no
     * loginMethod at all, so every expired-password session sailed through. A
     * direct API client could simply ignore the frontend's redirect.
     */
    it("blocks a protected route for an expired-password session", async () => {
      const { user, company } = await seedPasswordUser(USER_TYPE.ADMIN, {
        forcePasswordChange: true,
      });
      await Company.findByIdAndUpdate(company._id, { rotatePassword: true });

      const loginRes = await loginAs(user);
      expect(loginRes.body.data.isPasswordExpired).toBe(true);

      const res = await request(app)
        .get("/api/notification")
        .set("Cookie", setCookies(loginRes))
        .set("Accept", "application/json");

      expect(res.status).toBe(403);
      expect(res.body.messageCode).toBe(ERROR_CODES.PASSWORD_CHANGE_REQUIRED);
    });

    /*
     * The block has to leave a way out. If the rotation allowlist ever stops
     * covering these, an expired user can neither fix the password nor leave —
     * every request 403s, including the one that would clear the condition.
     */
    it("still allows the routes needed to escape the block", async () => {
      const { user, company } = await seedPasswordUser(USER_TYPE.ADMIN, {
        forcePasswordChange: true,
      });
      await Company.findByIdAndUpdate(company._id, { rotatePassword: true });

      const cookie = setCookies(await loginAs(user));

      const me = await request(app)
        .get("/api/user/me")
        .set("Cookie", cookie)
        .set("Accept", "application/json");
      expect(me.status).toBe(200);

      const changePassword = await request(app)
        .post("/api/user/change-password")
        .set("Cookie", cookie)
        .send({})
        .set("Accept", "application/json");
      expect(changePassword.status).not.toBe(403);

      const logout = await request(app)
        .post("/api/auth/logout")
        .set("Cookie", cookie)
        .set("Accept", "application/json");
      expect(logout.status).toBe(200);
    });

    it("does NOT block an OTP session whose password happens to be expired", async () => {
      // Password rotation governs passwords. An OTP session owes no password,
      // so blocking it would strand the user with no way to authenticate.
      const { user, company } = await createTestSession(USER_TYPE.ADMIN, {
        forcePasswordChange: true,
      });
      await Company.findByIdAndUpdate(company._id, { rotatePassword: true });
      await seedLoginOtp(user.email);

      const loginRes = await login(buildOtpLoginPayload({ email: user.email }));

      const res = await request(app)
        .get("/api/notification")
        .set("Cookie", setCookies(loginRes))
        .set("Accept", "application/json");

      expect(res.status).toBe(200);
    });

    it("keeps blocking after the session is refreshed", async () => {
      // The refresh token is consumed without the access token in hand, so the
      // originating flow has to be stored with it — otherwise refreshing mints
      // a token with no loginMethod and quietly lifts the block.
      const { user, company } = await seedPasswordUser(USER_TYPE.ADMIN, {
        forcePasswordChange: true,
      });
      await Company.findByIdAndUpdate(company._id, { rotatePassword: true });

      const loginRes = await loginAs(user);

      const refreshed = await request(app)
        .post("/api/auth/refresh-token")
        .set("Cookie", setCookies(loginRes))
        .set("Accept", "application/json");

      expect(refreshed.status).toBe(200);

      const res = await request(app)
        .get("/api/notification")
        .set("Cookie", setCookies(refreshed))
        .set("Accept", "application/json");

      expect(res.status).toBe(403);
    });

    it("reports no password expiry for an OTP login", async () => {
      const { user, company } = await createTestSession(USER_TYPE.ADMIN, {
        forcePasswordChange: true,
      });
      await Company.findByIdAndUpdate(company._id, { rotatePassword: true });
      await seedLoginOtp(user.email);

      const res = await login(buildOtpLoginPayload({ email: user.email }));

      expect(res.status).toBe(200);
      expect(res.body.data.isPasswordExpired).toBe(false);
    });
  });

  // =========================================================================
  // 3. Rotation survives the MFA routes
  // =========================================================================

  /*
   * Every MFA route mints a session of its own, and the block only bites when
   * that session records a password login. `pendingMfaMiddleware` waves a
   * logged-in caller straight through, so `req.pendingMfa` is empty on the setup
   * routes and only the fallback to the caller's own claim keeps the provenance
   * alive. Lose it anywhere here and the account is exempt from rotation until
   * its next login — refreshes included, since the refresh token stores the same
   * value.
   */
  describe("rotation survives the MFA routes", () => {
    const FACTOR_ID = ENROLLED_MFA.factorId;

    const blockRotation = (companyId: unknown) =>
      Company.findByIdAndUpdate(companyId, { rotatePassword: true });

    const expectBlocked = async (cookie: string[]) => {
      const res = await request(app)
        .get("/api/notification")
        .set("Cookie", cookie)
        .set("Accept", "application/json");

      expect(res.status).toBe(403);
      expect(res.body.messageCode).toBe(ERROR_CODES.PASSWORD_CHANGE_REQUIRED);
    };

    it("carries the password login through an MFA challenge", async () => {
      const { user, company } = await seedPasswordUser(USER_TYPE.ADMIN, {
        mfa: ENROLLED_MFA,
        forcePasswordChange: true,
      });
      await blockRotation(company._id);

      // The challenge answers before a session exists, so the expired password
      // cannot stop the user reaching /mfa/verify — only the session it mints.
      const loginRes = await loginAs(user);
      expect(loginRes.body.messageCode).toBe(ERROR_CODES.MFA_REQUIRED);

      const verified = await request(app)
        .post("/api/auth/mfa/verify")
        .set("Cookie", cookieJar(loginRes))
        .send({ code: "123456" })
        .set("Accept", "application/json");

      expect(verified.status).toBe(200);
      await expectBlocked(cookieJar(verified));
    });

    it("carries the password login through a recovery code", async () => {
      const { user, company } = await seedPasswordUser(USER_TYPE.ADMIN, {
        mfa: ENROLLED_MFA,
        forcePasswordChange: true,
      });
      await blockRotation(company._id);
      await RecoveryCodeModel.create({
        code: hashRecoveryCode("RECOVER01"),
        used: false,
        userRef: user._id,
      });

      const loginRes = await loginAs(user);

      const recovered = await request(app)
        .post("/api/auth/mfa/recovery")
        .set("Cookie", cookieJar(loginRes))
        .send({ recoveryCode: "RECOVER01" })
        .set("Accept", "application/json");

      expect(recovered.body.success).toBe(true);
      await expectBlocked(cookieJar(recovered));
    });

    /*
     * The setup routes run on a live session, so rotation is tripped afterwards:
     * a user already blocked never reaches them, but one who enrols today and
     * expires tomorrow keeps the session the enrolment handed back.
     */
    it("carries the password login through MFA enrolment", async () => {
      const { user, company } = await seedPasswordUser(USER_TYPE.ADMIN, {
        forcePasswordChange: true,
        mfa: { enrolled: false, enabled: false, factorIds: [FACTOR_ID] },
      });

      const loginRes = await loginAs(user);

      const enrolled = await request(app)
        .post("/api/auth/mfa/setup/verify")
        .set("Cookie", [
          ...cookieJar(loginRes),
          `${COOKIE_NAME.MFA_CHALLENGE_ID}=auth_challenge_test`,
          `${COOKIE_NAME.MFA_FACTOR_ID}=${FACTOR_ID}`,
        ])
        .send({ code: "123456" })
        .set("Accept", "application/json");

      expect(enrolled.status).toBe(200);

      await blockRotation(company._id);
      await expectBlocked(cookieJar(enrolled));
    });

    it("carries the password login through a skipped enrolment", async () => {
      const { user, company } = await seedPasswordUser(USER_TYPE.ADMIN, {
        forcePasswordChange: true,
        mfa: { enrolled: false, enabled: false, factorIds: [FACTOR_ID] },
      });

      const loginRes = await loginAs(user);

      const skipped = await request(app)
        .post("/api/auth/mfa/setup/skip")
        .set("Cookie", [
          ...cookieJar(loginRes),
          `${COOKIE_NAME.MFA_FACTOR_ID}=${FACTOR_ID}`,
        ])
        .set("Accept", "application/json");

      expect(skipped.status).toBe(200);

      await blockRotation(company._id);
      await expectBlocked(cookieJar(skipped));
    });

    it("carries the password login through the recovery-reset session", async () => {
      const { user, company } = await seedPasswordUser(USER_TYPE.ADMIN, {
        forcePasswordChange: true,
      });

      const loginRes = await loginAs(user);

      const reset = await request(app)
        .post("/api/auth/mfa/recovery/reset")
        .set("Cookie", cookieJar(loginRes))
        .set("Accept", "application/json");

      expect(reset.status).toBe(200);

      await blockRotation(company._id);
      await expectBlocked(cookieJar(reset));
    });
  });

  // =========================================================================
  // 4. Audit logging
  // =========================================================================

  describe("audit logging", () => {
    it("writes a user.login.success entry on the tenant chain", async () => {
      const { user, company } = await seedPasswordUser();

      await loginAs(user);
      await drainPendingEmits();

      const row = await AuditLogModel.findOne({
        action: "user.login.success",
      }).lean();
      expect(row).toBeTruthy();
      expect(row?.actorId?.toString()).toBe(user._id.toString());
      expect(row?.companyRef?.toString()).toBe(company._id.toString());
    });

    it("writes a sanitized user.login.failure entry on the AUTH sentinel chain", async () => {
      // Unknown account — the reason must NOT reveal that the email is unknown.
      await loginAs({ email: "ghost@example.com" });
      await drainPendingEmits();

      const row = await AuditLogModel.findOne({
        action: "user.login.failure",
      }).lean();
      expect(row).toBeTruthy();
      expect(row?.failureReason).toBe("Invalid credentials");
      expect(row?.target?.label).toBe("ghost@example.com");
      expect(row?.companyRef?.toString()).toBe(
        SYSTEM_SUBSYSTEM_REFS[SystemSubsystem.AUTH].toString(),
      );
    });
  });
});
