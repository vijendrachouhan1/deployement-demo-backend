import { faker } from "@faker-js/faker";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { Company } from "@/db/models/company";
import { User } from "@/db/models/user";
import { COOKIE_NAME, STATUS, USER_TYPE } from "@/enums";
import { SOCIAL_OAUTH_METHOD } from "@/enums/auth.enum";
import { buildPasswordLoginPayload } from "@/modules/auth/__tests__/utils/auth-test.payload";
import {
  hasCookie,
  mockPasswordLogin,
} from "@/modules/auth/__tests__/utils/auth-test.util";
import {
  login,
  loginAs,
  seedPasswordUser,
} from "@/modules/auth/__tests__/utils/login-test.util";
import { AUTH_RESPONSE_MESSAGES } from "@/modules/auth/utils/auth.constant";
import { mockAuthKitProvider } from "@/tests/mocks/authkit-provider.mock";
import { createTestSession } from "@/tests/utils/auth";

/**
 * POST /api/auth/login — who is allowed to log in
 *
 * Covers the refusals that precede (or follow) provider authentication: company
 * status, account status, the OAuth-registered conflict, and the second status
 * check applied to the account the provider's externalUserId maps to.
 *
 * Request handling lives in login.test.ts.
 */

describe("POST /api/auth/login — account status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // =========================================================================
  // 1. Business Scenarios (wrong credentials, disabled account)
  // =========================================================================

  describe("business scenarios", () => {
    it("returns 401 when credentials are invalid", async () => {
      const res = await loginAs({ email: "ghost@example.com" });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it("returns 401 when the account is disabled", async () => {
      const { user } = await seedPasswordUser(USER_TYPE.ADMIN, {
        status: STATUS.INACTIVE,
      });

      const res = await loginAs(user);

      // Account is INACTIVE — controller should refuse login
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it("blocks a company admin from logging in when their company is inactive", async () => {
      const { user, company } = await seedPasswordUser(USER_TYPE.ADMIN);
      await Company.findByIdAndUpdate(company._id, {
        companyStatus: STATUS.INACTIVE,
      });

      const res = await loginAs(user);

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it("allows a super admin to log in even when their company is inactive", async () => {
      const { user, company } = await seedPasswordUser(USER_TYPE.SUPER_ADMIN);
      await Company.findByIdAndUpdate(company._id, {
        companyStatus: STATUS.INACTIVE,
      });

      const res = await loginAs(user);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  // =========================================================================
  // 2. Account status — each STATUS value maps to its own refusal
  // =========================================================================

  describe("account status", () => {
    it("refuses a deleted account with the account-deleted message", async () => {
      const { user } = await seedPasswordUser(USER_TYPE.ADMIN, {
        status: STATUS.DELETED,
      });

      const res = await loginAs(user);

      expect(res.status).toBe(401);
      expect(res.body.message).toBe(AUTH_RESPONSE_MESSAGES.ACCOUNT_DELETED);
      // The refusal must happen before the provider is ever consulted.
      expect(
        mockAuthKitProvider.authenticateWithPassword,
      ).not.toHaveBeenCalled();
    });

    it("refuses an inactive account with the account-disabled message", async () => {
      const { user } = await createTestSession(USER_TYPE.ADMIN, {
        status: STATUS.INACTIVE,
      });

      const res = await loginAs(user);

      expect(res.status).toBe(401);
      expect(res.body.message).toBe(AUTH_RESPONSE_MESSAGES.ACCOUNT_DISABLED);
    });

    it("blocks an inactive user whose company is active", async () => {
      // Company stays ACTIVE — this isolates the user half of the disabled check
      // from the company half already covered above.
      const { user, company } = await createTestSession(USER_TYPE.ADMIN, {
        status: STATUS.INACTIVE,
      });
      const reloaded = await Company.findById(company._id);
      expect(reloaded?.companyStatus).toBe(STATUS.ACTIVE);

      const res = await loginAs(user);

      expect(res.status).toBe(401);
      expect(hasCookie(res, COOKIE_NAME.TOKEN)).toBe(false);
    });

    it("refuses a user who registered via OAuth", async () => {
      const { user } = await createTestSession(USER_TYPE.ADMIN, {
        oauth: SOCIAL_OAUTH_METHOD.GOOGLE,
      });

      const res = await loginAs(user);

      expect(res.status).toBe(409);
      expect(res.body.message).toContain(SOCIAL_OAUTH_METHOD.GOOGLE);
      expect(
        mockAuthKitProvider.authenticateWithPassword,
      ).not.toHaveBeenCalled();
    });

    it("rejects a password login with no password supplied", async () => {
      const { user } = await createTestSession();
      const { password: _pw, ...payload } = buildPasswordLoginPayload({
        email: user.email,
      });

      const res = await login(payload);

      expect(res.status).toBe(400);
      expect(res.body.message).toBe(AUTH_RESPONSE_MESSAGES.PASSWORD_REQUIRED);
      expect(
        mockAuthKitProvider.authenticateWithPassword,
      ).not.toHaveBeenCalled();
    });

    it("rejects login when the provider's user maps to no local account", async () => {
      const { user } = await createTestSession();

      // Provider authenticates, but returns an id no local user carries.
      mockPasswordLogin({
        externalUserId: `ext_${faker.string.uuid()}`,
        email: user.email,
      });

      const res = await loginAs(user);

      expect(res.status).toBe(401);
      expect(res.body.message).toBe(AUTH_RESPONSE_MESSAGES.INVALID_CREDENTIALS);
      expect(hasCookie(res, COOKIE_NAME.TOKEN)).toBe(false);
    });

    /*
     * The two cases below exercise the *second* status check — the one applied to
     * the account resolved from the provider's externalUserId, not the one found
     * by email. `email` carries no unique index, so the two lookups can resolve
     * to different documents; the mapped account's status is what must govern.
     */
    it.each([
      {
        label: "inactive",
        status: STATUS.INACTIVE,
        name: { first: "Dis", last: "Abled" },
        message: AUTH_RESPONSE_MESSAGES.ACCOUNT_DISABLED,
      },
      {
        label: "deleted",
        status: STATUS.DELETED,
        name: { first: "De", last: "Leted" },
        message: AUTH_RESPONSE_MESSAGES.ACCOUNT_DELETED,
      },
    ])(
      "blocks login when the provider maps to a $label account",
      async ({ status, name, message }) => {
        const { user } = await createTestSession();
        const mapped = await User.create({
          email: user.email,
          name,
          externalUserId: faker.string.uuid(),
          hasPassword: true,
          status,
          companyRef: user.companyRef,
        });

        mockPasswordLogin({
          externalUserId: mapped.externalUserId,
          email: user.email,
        });

        const res = await loginAs(user);

        expect(res.status).toBe(401);
        expect(res.body.message).toBe(message);
        expect(hasCookie(res, COOKIE_NAME.TOKEN)).toBe(false);
      },
    );
  });
});
