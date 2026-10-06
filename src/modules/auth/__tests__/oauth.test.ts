import { faker } from "@faker-js/faker";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createApp } from "@/app";
import { Company } from "@/db/models/company";
import { InvitedUsers } from "@/db/models/invitedUsers";
import { User } from "@/db/models/user";
import { INVITED_USER_STATUS, STATUS, USER_TYPE } from "@/enums";
import { jwtHelper } from "@/helpers/jwt";
import { VALID_OAUTH_PROVIDER } from "@/modules/auth/__tests__/utils/auth-test.constant";
import { buildOauthRegisterPayload } from "@/modules/auth/__tests__/utils/auth-test.payload";
import { mockOauthLogin } from "@/modules/auth/__tests__/utils/auth-test.util";
import { AUTH_RESPONSE_MESSAGES } from "@/modules/auth/utils/auth.constant";
import {
  mockAuthKitProvider,
  workos,
} from "@/tests/mocks/authkit-provider.mock";
import { createTestSession } from "@/tests/utils/auth";

/**
 * OAuth Routes
 *
 * GET /api/auth/url/oauth?provider=<SOCIAL_OAUTH_METHOD>
 *   Auth required : No
 *   Query : provider (required, enum SOCIAL_OAUTH_METHOD), redirectUrl (optional)
 *   Success  : 200 – returns { redirectUrl }
 *   Failures : 400 invalid provider | 500 provider error
 *
 * POST /api/auth/social-signup
 *   Auth required : No
 *   Body : code (required), oauthProvider (required, enum), inviteToken (optional)
 *   Success  : 200 – sets cookie (web) / returns token (mobile)
 *   Failures : 400 bad input | 500 provider error
 */

describe("OAuth routes", () => {
  const app = createApp();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // =========================================================================
  // GET /api/auth/oauth-url
  // =========================================================================

  describe("GET /api/auth/url/oauth", () => {
    describe("success", () => {
      it("returns 200 with a redirectUrl when a valid provider is given", async () => {
        const fakeUrl = "https://sso.workos.com/authorize?...";
        mockAuthKitProvider.generateOAuthUrl.mockResolvedValue(fakeUrl);

        const res = await request(app)
          .get("/api/auth/url/oauth")
          .query({ provider: VALID_OAUTH_PROVIDER })
          .set("Accept", "application/json");

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data).toHaveProperty("redirectUrl");
      });

      it("calls AuthService.generateOAuthUrl with the correct provider", async () => {
        const fakeUrl = "https://sso.workos.com/authorize?...";
        mockAuthKitProvider.generateOAuthUrl.mockResolvedValue(fakeUrl);

        await request(app)
          .get("/api/auth/url/oauth")
          .query({ provider: VALID_OAUTH_PROVIDER })
          .set("Accept", "application/json");

        expect(mockAuthKitProvider.generateOAuthUrl).toHaveBeenCalledOnce();
        expect(mockAuthKitProvider.generateOAuthUrl).toHaveBeenCalledWith(
          expect.objectContaining({ provider: VALID_OAUTH_PROVIDER }),
        );
      });
    });

    describe("validation errors", () => {
      it("returns 400 when provider query param is missing", async () => {
        const res = await request(app)
          .get("/api/auth/url/oauth")
          .set("Accept", "application/json");

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
      });

      it("returns 400 when provider is not a valid SOCIAL_OAUTH_METHOD value", async () => {
        const res = await request(app)
          .get("/api/auth/url/oauth")
          .query({ provider: "FakeProvider" })
          .set("Accept", "application/json");

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
      });

      it("does NOT call the auth service when validation fails", async () => {
        await request(app)
          .get("/api/auth/url/oauth")
          .query({ provider: "FakeProvider" })
          .set("Accept", "application/json");

        expect(mockAuthKitProvider.generateOAuthUrl).not.toHaveBeenCalled();
      });
    });

    describe("server errors", () => {
      it("returns 500 when generateOAuthUrl throws", async () => {
        mockAuthKitProvider.generateOAuthUrl.mockRejectedValueOnce(
          new Error("Provider unavailable"),
        );

        const res = await request(app)
          .get("/api/auth/url/oauth")
          .query({ provider: VALID_OAUTH_PROVIDER })
          .set("Accept", "application/json");

        expect(res.status).toBe(500);
      });
    });
  });

  // =========================================================================
  // POST /api/auth/oauth-register
  // =========================================================================

  describe("POST /api/auth/social-signup", () => {
    describe("success — first-time signup (no local user yet)", () => {
      it("returns 200 with user data for a valid OAuth code (web client)", async () => {
        const email = faker.internet.email().toLowerCase();
        mockOauthLogin({ email, firstName: "Ada", lastName: "Lovelace" });

        const res = await request(app)
          .post("/api/auth/social-signup")
          .send(buildOauthRegisterPayload())
          .set("Accept", "application/json");

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.user).toHaveProperty("email", email);
      });

      it("persists the new user with the OAuth provider and admin role", async () => {
        const email = faker.internet.email().toLowerCase();
        mockOauthLogin({ email, firstName: "Ada", lastName: "Lovelace" });

        await request(app)
          .post("/api/auth/social-signup")
          .send(buildOauthRegisterPayload())
          .set("Accept", "application/json");

        const created = await User.findOne({ email });
        expect(created).not.toBeNull();
        expect(created?.oauth).toBe(VALID_OAUTH_PROVIDER);
        expect(created?.roles).toBe(USER_TYPE.ADMIN);
        expect(created?.name.first).toBe("Ada");
        expect(created?.name.last).toBe("Lovelace");
      });

      it("creates and links a company for the new admin user", async () => {
        const email = faker.internet.email().toLowerCase();
        mockOauthLogin({ email });

        await request(app)
          .post("/api/auth/social-signup")
          .send(buildOauthRegisterPayload())
          .set("Accept", "application/json");

        const created = await User.findOne({ email });
        expect(created?.companyRef).toBeDefined();

        // A self-serve social registrant owns a freshly created company, and that
        // company must be synced to the provider so tokens can be issued.
        const company = await Company.findById(created!.companyRef);
        expect(company).not.toBeNull();
        expect(company?.userRef?.toString()).toBe(created!._id.toString());
        expect(company?.externalId).toBeTruthy();
      });

      it("falls back to placeholder names when the provider omits them", async () => {
        const email = faker.internet.email().toLowerCase();
        mockOauthLogin({
          email,
          firstName: undefined,
          lastName: undefined,
        });

        await request(app)
          .post("/api/auth/social-signup")
          .send(buildOauthRegisterPayload())
          .set("Accept", "application/json");

        const created = await User.findOne({ email });
        expect(created?.name.first).toBe("USER");
        expect(created?.name.last).toBe("BYLDD");
      });

      it("syncs the local user id and provider back to the auth provider", async () => {
        const email = faker.internet.email().toLowerCase();
        const providerId = faker.string.uuid();
        mockOauthLogin({ email, id: providerId });

        await request(app)
          .post("/api/auth/social-signup")
          .send(buildOauthRegisterPayload())
          .set("Accept", "application/json");

        const created = await User.findOne({ email });
        expect(mockAuthKitProvider.updateUser).toHaveBeenCalledWith(
          expect.objectContaining({
            userId: providerId,
            externalId: created!._id.toString(),
            metadata: expect.objectContaining({
              OAuthProvider: VALID_OAUTH_PROVIDER,
            }),
          }),
        );
      });

      it("returns token in response body for mobile clients", async () => {
        mockOauthLogin({ email: faker.internet.email().toLowerCase() });

        const res = await request(app)
          .post("/api/auth/social-signup")
          .send(buildOauthRegisterPayload())
          .set("Accept", "application/json")
          .set("x-client-platform", "mobile");

        expect(res.status).toBe(200);
        expect(typeof res.body.data.token).toBe("string");
        expect(res.body.data.token.length).toBeGreaterThan(0);
        expect(res.body.data).toHaveProperty("refreshToken");
      });
    });

    describe("success — returning user (local user already exists)", () => {
      it("returns 200 and logs the existing user in", async () => {
        const { user } = await createTestSession();
        mockOauthLogin({ email: user.email, id: user.externalUserId });

        const res = await request(app)
          .post("/api/auth/social-signup")
          .send(buildOauthRegisterPayload())
          .set("Accept", "application/json");

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
      });

      it("does not create a duplicate user record", async () => {
        const { user } = await createTestSession();
        mockOauthLogin({ email: user.email, id: user.externalUserId });

        await request(app)
          .post("/api/auth/social-signup")
          .send(buildOauthRegisterPayload())
          .set("Accept", "application/json");

        expect(await User.countDocuments({ email: user.email })).toBe(1);
        expect(mockAuthKitProvider.createUser).not.toHaveBeenCalled();
      });
    });

    describe("blocked accounts", () => {
      it("rejects a login for an INACTIVE account", async () => {
        const { user } = await createTestSession(USER_TYPE.ADMIN, {
          status: STATUS.INACTIVE,
        });
        mockOauthLogin({ email: user.email, id: user.externalUserId });

        const res = await request(app)
          .post("/api/auth/social-signup")
          .send(buildOauthRegisterPayload())
          .set("Accept", "application/json");

        expect(res.body.success).toBe(false);
        expect(res.body.message).toBe(AUTH_RESPONSE_MESSAGES.ACCOUNT_DISABLED);
      });

      it("rejects a login for a DELETED account", async () => {
        const { user } = await createTestSession(USER_TYPE.ADMIN, {
          status: STATUS.DELETED,
        });
        mockOauthLogin({ email: user.email, id: user.externalUserId });

        const res = await request(app)
          .post("/api/auth/social-signup")
          .send(buildOauthRegisterPayload())
          .set("Accept", "application/json");

        expect(res.body.success).toBe(false);
        expect(res.body.message).toBe(AUTH_RESPONSE_MESSAGES.ACCOUNT_DELETED);
      });

      it("does not touch the blocked user's record", async () => {
        const { user } = await createTestSession(USER_TYPE.ADMIN, {
          status: STATUS.INACTIVE,
        });
        mockOauthLogin({ email: user.email, id: user.externalUserId });

        await request(app)
          .post("/api/auth/social-signup")
          .send(buildOauthRegisterPayload())
          .set("Accept", "application/json");

        const after = await User.findById(user._id);
        expect(after?.status).toBe(STATUS.INACTIVE);
        expect(mockAuthKitProvider.updateUser).not.toHaveBeenCalled();
      });
    });

    describe("validation errors", () => {
      it("returns 400 when code is missing", async () => {
        const { code: _c, ...payload } = buildOauthRegisterPayload() as any;

        const res = await request(app)
          .post("/api/auth/social-signup")
          .send(payload)
          .set("Accept", "application/json");

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
      });

      it("returns 400 when oauthProvider is missing", async () => {
        const res = await request(app)
          .post("/api/auth/social-signup")
          .send({ code: faker.string.alphanumeric(32) })
          .set("Accept", "application/json");

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
      });

      it("returns 400 when oauthProvider is not a valid enum value", async () => {
        const res = await request(app)
          .post("/api/auth/social-signup")
          .send(buildOauthRegisterPayload({ oauthProvider: "FakeOAuth" }))
          .set("Accept", "application/json");

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
      });

      it("returns 400 when the request body is empty", async () => {
        const res = await request(app)
          .post("/api/auth/social-signup")
          .send({})
          .set("Accept", "application/json");

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
      });
    });

    describe("invited social users", () => {
      /**
       * Seeds a company + inviting admin + pending invitation, and stubs the OAuth
       * exchange to return a provider user for the invited address.
       */
      async function seedSocialInvitation({
        role = USER_TYPE.USER,
        withCompany = true,
      }: { role?: USER_TYPE; withCompany?: boolean } = {}) {
        const invitedEmail = faker.internet.email().toLowerCase();

        const company = withCompany
          ? await Company.create({
              name: faker.company.name(),
              externalId: `org_${faker.string.alphanumeric(24)}`,
            })
          : null;

        const inviter = await User.create({
          email: faker.internet.email().toLowerCase(),
          name: { first: "In", last: "Viter" },
          externalUserId: faker.string.uuid(),
          roles: USER_TYPE.ADMIN,
          ...(company && { companyRef: company._id }),
        });

        if (company) {
          await Company.findByIdAndUpdate(company._id, {
            userRef: inviter._id,
          });
        }

        await InvitedUsers.create({
          invitedEmail,
          name: { first: "New", last: "Joiner" },
          userRef: inviter._id,
          ...(company && { companyRef: company._id }),
          role,
          status: INVITED_USER_STATUS.PENDING,
        });

        mockAuthKitProvider.authenticateWithCode.mockResolvedValue({
          user: {
            id: faker.string.uuid(),
            email: invitedEmail,
            firstName: "New",
            lastName: "Joiner",
            metadata: {},
          },
        });

        return {
          invitedEmail,
          company,
          inviter,
          inviteToken: jwtHelper.generateToken({ email: invitedEmail }),
        };
      }

      it("registers an invited non-admin into the invitation's company", async () => {
        const { invitedEmail, company, inviter, inviteToken } =
          await seedSocialInvitation({ role: USER_TYPE.USER });

        const res = await request(app)
          .post("/api/auth/social-signup")
          .send(buildOauthRegisterPayload({ inviteToken }))
          .set("Accept", "application/json");

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);

        const dbUser = await User.findOne({ email: invitedEmail });
        expect(dbUser?.roles).toBe(USER_TYPE.USER);
        expect(dbUser?.companyRef?.toString()).toBe(company!._id.toString());

        // No second company, and ownership stays with the inviting admin.
        expect(await Company.countDocuments()).toBe(1);
        const reloaded = await Company.findById(company!._id);
        expect(reloaded?.userRef?.toString()).toBe(inviter._id.toString());

        // The provider membership carries the invitation's role.
        expect(
          workos.userManagement.createOrganizationMembership,
        ).toHaveBeenCalledWith(
          expect.objectContaining({ roleSlug: USER_TYPE.USER }),
        );
      });

      it("gives an invited admin ownership of the invitation's company", async () => {
        const { invitedEmail, company, inviteToken } =
          await seedSocialInvitation({ role: USER_TYPE.ADMIN });

        const res = await request(app)
          .post("/api/auth/social-signup")
          .send(buildOauthRegisterPayload({ inviteToken }))
          .set("Accept", "application/json");

        expect(res.status).toBe(200);

        const dbUser = await User.findOne({ email: invitedEmail });
        expect(dbUser?.roles).toBe(USER_TYPE.ADMIN);
        expect(await Company.countDocuments()).toBe(1);

        const reloaded = await Company.findById(company!._id);
        expect(reloaded?.userRef?.toString()).toBe(dbUser?._id.toString());
      });

      it("marks the invitation accepted once provisioning succeeds", async () => {
        // Left pending, the invite stayed eligible for resend and cancellation
        // (invite-user.helper filters on `status: { $ne: ACCEPTED }`), so the
        // same seat could be handed out twice.
        const { invitedEmail, inviteToken } = await seedSocialInvitation({
          role: USER_TYPE.USER,
        });

        const res = await request(app)
          .post("/api/auth/social-signup")
          .send(buildOauthRegisterPayload({ inviteToken }))
          .set("Accept", "application/json");

        expect(res.status).toBe(200);

        const invitation = await InvitedUsers.findOne({ invitedEmail });
        expect(invitation?.status).toBe(INVITED_USER_STATUS.ACCEPTED);
      });

      it("leaves the invitation pending when provisioning fails", async () => {
        const { invitedEmail, inviteToken } = await seedSocialInvitation({
          role: USER_TYPE.USER,
        });
        workos.userManagement.createOrganizationMembership.mockRejectedValueOnce(
          new Error("provider down"),
        );

        await request(app)
          .post("/api/auth/social-signup")
          .send(buildOauthRegisterPayload({ inviteToken }))
          .set("Accept", "application/json");

        const invitation = await InvitedUsers.findOne({ invitedEmail });
        expect(invitation?.status).toBe(INVITED_USER_STATUS.PENDING);
      });

      it("removes the local user when provisioning fails", async () => {
        const { invitedEmail, inviteToken } = await seedSocialInvitation({
          role: USER_TYPE.USER,
        });
        workos.userManagement.createOrganizationMembership.mockRejectedValueOnce(
          new Error("provider down"),
        );

        const res = await request(app)
          .post("/api/auth/social-signup")
          .send(buildOauthRegisterPayload({ inviteToken }))
          .set("Accept", "application/json");

        expect(res.status).toBeGreaterThanOrEqual(400);
        expect(await User.countDocuments({ email: invitedEmail })).toBe(0);
      });

      it("provisions the account fully when the signup is retried", async () => {
        const { invitedEmail, company, inviteToken } =
          await seedSocialInvitation({ role: USER_TYPE.USER });
        workos.userManagement.createOrganizationMembership.mockRejectedValueOnce(
          new Error("provider down"),
        );

        await request(app)
          .post("/api/auth/social-signup")
          .send(buildOauthRegisterPayload({ inviteToken }))
          .set("Accept", "application/json");

        const retry = await request(app)
          .post("/api/auth/social-signup")
          .send(buildOauthRegisterPayload({ inviteToken }))
          .set("Accept", "application/json");

        expect(retry.status).toBe(200);

        // The session arrives only alongside a complete provisioning.
        expect(
          workos.userManagement.createOrganizationMembership,
        ).toHaveBeenCalledWith(
          expect.objectContaining({ organizationId: company!.externalId }),
        );

        const invitation = await InvitedUsers.findOne({ invitedEmail });
        expect(invitation?.status).toBe(INVITED_USER_STATUS.ACCEPTED);

        const dbUser = await User.findOne({ email: invitedEmail });
        expect(dbUser?.companyRef?.toString()).toBe(company!._id.toString());
        expect(dbUser?.organizationMembershipId).toBeTruthy();
      });

      it("refuses an invitation that carries no company", async () => {
        const { invitedEmail, inviteToken } = await seedSocialInvitation({
          role: USER_TYPE.USER,
          withCompany: false,
        });

        const res = await request(app)
          .post("/api/auth/social-signup")
          .send(buildOauthRegisterPayload({ inviteToken }))
          .set("Accept", "application/json");

        expect(res.body.success).toBe(false);
        expect(res.body.message).toBe(
          AUTH_RESPONSE_MESSAGES.INVITATION_COMPANY_MISSING,
        );
        expect(await User.countDocuments({ email: invitedEmail })).toBe(0);
      });
    });

    describe("server errors", () => {
      it("returns 500 when authenticateWithCode throws", async () => {
        mockAuthKitProvider.authenticateWithCode.mockRejectedValueOnce(
          new Error("OAuth exchange failed"),
        );

        const res = await request(app)
          .post("/api/auth/social-signup")
          .send(buildOauthRegisterPayload())
          .set("Accept", "application/json");

        expect(res.status).toBe(500);
      });
    });
  });
});
