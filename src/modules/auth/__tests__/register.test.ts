import { faker } from "@faker-js/faker";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createApp } from "@/app";
import { Company } from "@/db/models/company";
import { InvitedUsers } from "@/db/models/invitedUsers";
import { User } from "@/db/models/user";
import { INVITED_USER_STATUS, USER_TYPE } from "@/enums";
import { jwtHelper } from "@/helpers/jwt";
import {
  buildAuthProviderUser,
  buildRegisterPayload,
} from "@/modules/auth/__tests__/utils/auth-test.payload";
import { seedInvitation } from "@/modules/auth/__tests__/utils/auth-test.seed";
import { setCookies } from "@/modules/auth/__tests__/utils/auth-test.util";
import { AUTH_RESPONSE_MESSAGES } from "@/modules/auth/utils/auth.constant";
import {
  mockAuthKitProvider,
  workos,
} from "@/tests/mocks/authkit-provider.mock";

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("POST /api/auth/register", () => {
  const app = createApp();

  beforeEach(() => {
    vi.clearAllMocks();

    // Default happy-path stubs
    mockAuthKitProvider.createUser.mockResolvedValue(buildAuthProviderUser());
    mockAuthKitProvider.updateUser.mockResolvedValue(buildAuthProviderUser());
  });

  describe("success", () => {
    it("returns 200 with user data when valid credentials are sent (web client)", async () => {
      const payload = buildRegisterPayload();

      const res = await request(app)
        .post("/api/auth/register")
        .send(payload)
        .set("Content-Type", "application/json");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      expect(res.body.data).toHaveProperty("user");
      expect(res.body.data.user).toHaveProperty("email", payload.email);
    });

    it("sets pending MFA cookie and asks for MFA setup on successful registration (web client)", async () => {
      const payload = buildRegisterPayload();

      const res = await request(app)
        .post("/api/auth/register")
        .send(payload)
        .set("Accept", "application/json");

      expect(res.status).toBe(200);

      // MFA enrollment is required at signup — no session cookie yet,
      // only a pending MFA token cookie and a redirect hint.
      const cookies = setCookies(res);
      expect(cookies).toBeDefined();

      const hasPendingMfaCookie = cookies.some((c: string) =>
        c.startsWith("pendingMfaToken="),
      );
      expect(hasPendingMfaCookie).toBe(true);

      const hasSessionCookie = cookies.some((c: string) =>
        c.startsWith("token="),
      );
      expect(hasSessionCookie).toBe(false);

      expect(res.body.data).toHaveProperty("redirectToMfaSetup", true);
    });

    // TODO: Mobile MFA enrollment flow is incomplete — when MFA is required at
    // signup, mobile clients receive neither a session token nor the pending
    // MFA token (it is only set as a web cookie). Unskip once that flow is built.
    it.skip("returns token in response body for mobile clients", async () => {
      const payload = buildRegisterPayload();

      const res = await request(app)
        .post("/api/auth/register")
        .send(payload)
        .set("Accept", "application/json")
        .set("x-client-platform", "mobile");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty("token");
      expect(res.body.data).toHaveProperty("user");
      expect(typeof res.body.data.token).toBe("string");
    });

    it("creates a User document in the database", async () => {
      const payload = buildRegisterPayload();

      await request(app)
        .post("/api/auth/register")
        .send(payload)
        .set("Accept", "application/json");

      const dbUser = await User.findOne({ email: payload.email });

      expect(dbUser).not.toBeNull();
      expect(dbUser?.email).toBe(payload.email);
      expect(dbUser?.name.first).toBe(payload.name.first);
      expect(dbUser?.name.last).toBe(payload.name.last);
    });

    it("creates a Company and links it to the new admin user", async () => {
      const payload = buildRegisterPayload();

      await request(app)
        .post("/api/auth/register")
        .send(payload)
        .set("Accept", "application/json");

      const dbUser = await User.findOne({ email: payload.email });
      const company = await Company.findById(dbUser?.companyRef);

      expect(company).not.toBeNull();
      expect(company?.userRef?.toString()).toBe(dbUser?._id.toString());
    });

    it("calls AuthService.createUser once with correct arguments", async () => {
      const payload = buildRegisterPayload();

      await request(app)
        .post("/api/auth/register")
        .send(payload)
        .set("Accept", "application/json");

      expect(mockAuthKitProvider.createUser).toHaveBeenCalledOnce();
      expect(mockAuthKitProvider.createUser).toHaveBeenCalledWith(
        expect.objectContaining({
          email: payload.email,
          firstName: payload.name.first,
          lastName: payload.name.last,
          emailVerified: true,
        }),
      );
    });

    it("passes externalId to AuthService.createUser to link the provider record to the DB user", async () => {
      const payload = buildRegisterPayload();

      await request(app)
        .post("/api/auth/register")
        .send(payload)
        .set("Accept", "application/json");

      expect(mockAuthKitProvider.createUser).toHaveBeenCalledWith(
        expect.objectContaining({ externalId: expect.any(String) }),
      );
    });

    it("stores externalUserId on the user document (from auth provider)", async () => {
      const externalId = faker.string.uuid();
      mockAuthKitProvider.createUser.mockResolvedValue(
        buildAuthProviderUser(externalId),
      );
      const payload = buildRegisterPayload();

      await request(app)
        .post("/api/auth/register")
        .send(payload)
        .set("Accept", "application/json");

      const dbUser = await User.findOne({ email: payload.email });
      expect(dbUser?.externalUserId).toBe(externalId);
    });
  });

  // =========================================================================
  // 2. Validation Errors (confused user)
  // =========================================================================

  describe("validation errors", () => {
    it("returns 400 when email is missing", async () => {
      const { email: _email, ...payload } = buildRegisterPayload() as any;

      const res = await request(app)
        .post("/api/auth/register")
        .send(payload)
        .set("Accept", "application/json");

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it("returns 400 when email is malformed", async () => {
      const payload = buildRegisterPayload({ email: "not-an-email" });

      const res = await request(app)
        .post("/api/auth/register")
        .send(payload)
        .set("Accept", "application/json");

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it("returns 400 when password is missing", async () => {
      const { password: _pw, ...payload } = buildRegisterPayload() as any;

      const res = await request(app)
        .post("/api/auth/register")
        .send(payload)
        .set("Accept", "application/json");

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it("returns 400 when password is shorter than 8 characters", async () => {
      const payload = buildRegisterPayload({ password: "abc123" });

      const res = await request(app)
        .post("/api/auth/register")
        .send(payload)
        .set("Accept", "application/json");

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it("returns 400 when password lacks a special character (complexity rule)", async () => {
      const payload = buildRegisterPayload({ password: "StrongPass123" });

      const res = await request(app)
        .post("/api/auth/register")
        .send(payload)
        .set("Accept", "application/json");

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it("returns 400 when password lacks a number (complexity rule)", async () => {
      const payload = buildRegisterPayload({ password: "StrongPass@" });

      const res = await request(app)
        .post("/api/auth/register")
        .send(payload)
        .set("Accept", "application/json");

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it("returns 400 when name.first is missing", async () => {
      const payload = buildRegisterPayload({ name: { last: "Doe" } });

      const res = await request(app)
        .post("/api/auth/register")
        .send(payload)
        .set("Accept", "application/json");

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it("returns 400 when name.last is missing", async () => {
      const payload = buildRegisterPayload({ name: { first: "John" } });

      const res = await request(app)
        .post("/api/auth/register")
        .send(payload)
        .set("Accept", "application/json");

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it("returns 400 when the entire name field is missing", async () => {
      const { name: _name, ...payload } = buildRegisterPayload() as any;

      const res = await request(app)
        .post("/api/auth/register")
        .send(payload)
        .set("Accept", "application/json");

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it("returns 400 when the request body is empty", async () => {
      const res = await request(app)
        .post("/api/auth/register")
        .send({})
        .set("Accept", "application/json");

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it("does NOT call the auth provider when validation fails", async () => {
      await request(app)
        .post("/api/auth/register")
        .send({ email: "bad-email" })
        .set("Accept", "application/json");

      expect(mockAuthKitProvider.createUser).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // 3. Business Scenarios (malicious / duplicate user)
  // =========================================================================

  describe("business scenarios", () => {
    it("returns 409 when a user with the same email already exists", async () => {
      const payload = buildRegisterPayload();

      // First registration — succeeds
      await request(app)
        .post("/api/auth/register")
        .send(payload)
        .set("Accept", "application/json");

      // Reset stub so the provider would allow a second create
      mockAuthKitProvider.createUser.mockResolvedValue(buildAuthProviderUser());

      // Second registration with same email — must conflict
      const res = await request(app)
        .post("/api/auth/register")
        .send(payload)
        .set("Accept", "application/json");

      expect(res.status).toBe(409);
      expect(res.body.success).toBe(false);
    });

    it("does not call AuthService.createUser when email already exists", async () => {
      const payload = buildRegisterPayload();

      // Seed an existing user directly in DB
      await User.create({
        email: payload.email,
        name: payload.name,
        externalUserId: faker.string.uuid(),
        hasPassword: true,
      });

      vi.clearAllMocks();

      const res = await request(app)
        .post("/api/auth/register")
        .send(payload)
        .set("Accept", "application/json");

      expect(res.status).toBe(409);
      expect(mockAuthKitProvider.createUser).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // 4. External / Server Failures (3 AM engineer)
  // =========================================================================

  describe("server errors", () => {
    it("returns 500 when the auth provider createUser throws", async () => {
      mockAuthKitProvider.createUser.mockRejectedValueOnce(
        new Error("WorkOS is down"),
      );
      const payload = buildRegisterPayload();

      const res = await request(app)
        .post("/api/auth/register")
        .send(payload)
        .set("Accept", "application/json");

      expect(res.status).toBe(500);
    });

    /*
     * Provisioning used to run after the local records had already committed, so
     * a provider outage left a company and user behind with no provider identity.
     * The account could never log in, and could never be registered again either
     * — the retry collided with the very row the failure had stranded.
     */
    it("writes nothing locally when the provider fails", async () => {
      mockAuthKitProvider.createUser.mockRejectedValueOnce(
        new Error("WorkOS is down"),
      );
      const payload = buildRegisterPayload();

      await request(app)
        .post("/api/auth/register")
        .send(payload)
        .set("Accept", "application/json");

      expect(await User.countDocuments({ email: payload.email })).toBe(0);
      expect(await Company.countDocuments({ name: payload.email })).toBe(0);
    });

    it("lets the same email register again after a provider failure", async () => {
      mockAuthKitProvider.createUser.mockRejectedValueOnce(
        new Error("WorkOS is down"),
      );
      const payload = buildRegisterPayload();

      await request(app)
        .post("/api/auth/register")
        .send(payload)
        .set("Accept", "application/json");

      const retry = await request(app)
        .post("/api/auth/register")
        .send(payload)
        .set("Accept", "application/json");

      expect(retry.status).toBe(200);
      expect(await User.countDocuments({ email: payload.email })).toBe(1);
    });

    it("undoes the provider user when a later provider call fails", async () => {
      const externalId = faker.string.uuid();
      mockAuthKitProvider.createUser.mockResolvedValue(
        buildAuthProviderUser(externalId),
      );
      workos.organizations.createOrganization.mockRejectedValueOnce(
        new Error("WorkOS is down"),
      );
      const payload = buildRegisterPayload();

      await request(app)
        .post("/api/auth/register")
        .send(payload)
        .set("Accept", "application/json");

      expect(workos.userManagement.deleteUser).toHaveBeenCalledWith(externalId);
      expect(await User.countDocuments({ email: payload.email })).toBe(0);
    });
  });

  // =========================================================================
  // 5. Credential passthrough to the auth provider
  //
  // Nothing else in the suite constrains the `password` argument handed to
  // syncWithAuthProvider(). Without this, a registration that silently sent an
  // empty password upstream would be a production outage invisible to CI.
  // =========================================================================

  describe("credential passthrough", () => {
    it("forwards the exact submitted password to the auth provider", async () => {
      const payload = buildRegisterPayload({ password: "Sup3rSecret@456" });

      await request(app)
        .post("/api/auth/register")
        .send(payload)
        .set("Accept", "application/json");

      expect(mockAuthKitProvider.createUser).toHaveBeenCalledWith(
        expect.objectContaining({ password: "Sup3rSecret@456" }),
      );
    });

    it("records hasPassword on the user document for a password registration", async () => {
      const payload = buildRegisterPayload();

      await request(app)
        .post("/api/auth/register")
        .send(payload)
        .set("Accept", "application/json");

      const dbUser = await User.findOne({ email: payload.email });
      expect(dbUser?.hasPassword).toBe(true);
    });

    it("starts a new user un-enrolled in MFA", async () => {
      const payload = buildRegisterPayload();

      await request(app)
        .post("/api/auth/register")
        .send(payload)
        .set("Accept", "application/json");

      const dbUser = await User.findOne({ email: payload.email });
      expect(dbUser?.mfa.enrolled).toBe(false);
    });
  });

  // =========================================================================
  // 6. Role assignment
  // =========================================================================

  describe("role assignment", () => {
    it("gives a self-serve registrant the ADMIN role locally and at the provider", async () => {
      const payload = buildRegisterPayload();

      await request(app)
        .post("/api/auth/register")
        .send(payload)
        .set("Accept", "application/json");

      const dbUser = await User.findOne({ email: payload.email });
      expect(dbUser?.roles).toBe(USER_TYPE.ADMIN);

      expect(
        workos.userManagement.createOrganizationMembership,
      ).toHaveBeenCalledWith(
        expect.objectContaining({ roleSlug: USER_TYPE.ADMIN }),
      );
    });

    it("gives an invited user the invitation's role, not ADMIN", async () => {
      const payload = buildRegisterPayload();
      const { company, inviter, inviteToken } = await seedInvitation({
        invitedEmail: payload.email,
        role: USER_TYPE.USER,
      });

      const res = await request(app)
        .post("/api/auth/register")
        .send({ ...payload, inviteToken })
        .set("Accept", "application/json");

      expect(res.status).toBe(200);

      const dbUser = await User.findOne({ email: payload.email });
      expect(dbUser?.roles).toBe(USER_TYPE.USER);
      expect(dbUser?.companyRef?.toString()).toBe(company._id.toString());

      // The provider membership must carry the same non-admin role.
      expect(
        workos.userManagement.createOrganizationMembership,
      ).toHaveBeenCalledWith(
        expect.objectContaining({ roleSlug: USER_TYPE.USER }),
      );

      // Joining an existing company must not create another one, and must not
      // steal the company's userRef from the inviting admin.
      expect(await Company.countDocuments()).toBe(1);
      const reloaded = await Company.findById(company._id);
      expect(reloaded?.userRef?.toString()).toBe(inviter._id.toString());
    });

    it("does not create a second company when an invited ADMIN joins an existing one", async () => {
      const payload = buildRegisterPayload();
      const { company, inviteToken } = await seedInvitation({
        invitedEmail: payload.email,
        role: USER_TYPE.ADMIN,
      });

      const res = await request(app)
        .post("/api/auth/register")
        .send({ ...payload, inviteToken })
        .set("Accept", "application/json");

      expect(res.status).toBe(200);
      expect(await Company.countDocuments()).toBe(1);

      // An invited admin does take over the company's userRef.
      const dbUser = await User.findOne({ email: payload.email });
      const reloaded = await Company.findById(company._id);
      expect(reloaded?.userRef?.toString()).toBe(dbUser?._id.toString());
    });

    it("marks the invitation as accepted once registration completes", async () => {
      const payload = buildRegisterPayload();
      const { inviteToken } = await seedInvitation({
        invitedEmail: payload.email,
      });

      await request(app)
        .post("/api/auth/register")
        .send({ ...payload, inviteToken })
        .set("Accept", "application/json");

      const invitation = await InvitedUsers.findOne({
        invitedEmail: payload.email,
      });
      expect(invitation?.status).toBe(INVITED_USER_STATUS.ACCEPTED);
    });
  });

  // =========================================================================
  // 7. Invitation validation (invite.helper.ts)
  //
  // validateInvitation() throws, so each rejection surfaces as a 500 carrying
  // the helper's message. The message is what distinguishes the three branches.
  // =========================================================================

  describe("invitation validation", () => {
    it("rejects an invite token issued for a different email", async () => {
      const payload = buildRegisterPayload();
      await seedInvitation({ invitedEmail: payload.email });

      const otherEmail = faker.internet.email().toLowerCase();
      const res = await request(app)
        .post("/api/auth/register")
        .send({
          ...payload,
          inviteToken: jwtHelper.generateToken({ email: otherEmail }),
        })
        .set("Accept", "application/json");

      expect(res.body.success).toBe(false);
      expect(res.body.message).toBe(AUTH_RESPONSE_MESSAGES.INVALID_TOKEN);

      // Nothing may be created from a rejected invitation.
      expect(await User.countDocuments({ email: payload.email })).toBe(0);
      expect(mockAuthKitProvider.createUser).not.toHaveBeenCalled();
    });

    it("rejects a valid token when the email was never invited", async () => {
      const payload = buildRegisterPayload();

      const res = await request(app)
        .post("/api/auth/register")
        .send({
          ...payload,
          inviteToken: jwtHelper.generateToken({ email: payload.email }),
        })
        .set("Accept", "application/json");

      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain(
        AUTH_RESPONSE_MESSAGES.EMAIL_NOT_INVITED,
      );
      expect(await User.countDocuments({ email: payload.email })).toBe(0);
    });

    /*
     * `InvitedUsers.companyRef` is optional at the schema level, and an account
     * with no company can never be issued a session (generateAuthTokens needs the
     * company's WorkOS externalId). Both shapes below must be refused outright,
     * and must not leave a half-created user behind.
     */
    it("rejects an invitation that carries no company", async () => {
      const payload = buildRegisterPayload();
      const inviter = await User.create({
        email: faker.internet.email().toLowerCase(),
        name: { first: "In", last: "Viter" },
        externalUserId: faker.string.uuid(),
      });
      await InvitedUsers.create({
        invitedEmail: payload.email,
        name: payload.name,
        userRef: inviter._id,
        role: USER_TYPE.USER,
        status: INVITED_USER_STATUS.PENDING,
      });

      const res = await request(app)
        .post("/api/auth/register")
        .send({
          ...payload,
          inviteToken: jwtHelper.generateToken({ email: payload.email }),
        })
        .set("Accept", "application/json");

      expect(res.body.success).toBe(false);
      expect(res.body.message).toBe(
        AUTH_RESPONSE_MESSAGES.INVITATION_COMPANY_MISSING,
      );
      expect(await User.countDocuments({ email: payload.email })).toBe(0);
      expect(mockAuthKitProvider.createUser).not.toHaveBeenCalled();
    });

    it("rejects an invitation whose company no longer exists", async () => {
      const payload = buildRegisterPayload();
      const { company, inviteToken } = await seedInvitation({
        invitedEmail: payload.email,
        role: USER_TYPE.USER,
      });
      await Company.findByIdAndDelete(company._id);

      const res = await request(app)
        .post("/api/auth/register")
        .send({ ...payload, inviteToken })
        .set("Accept", "application/json");

      expect(res.body.success).toBe(false);
      expect(res.body.message).toBe(
        AUTH_RESPONSE_MESSAGES.INVITATION_COMPANY_MISSING,
      );
      expect(await User.countDocuments({ email: payload.email })).toBe(0);
    });

    it("rejects a cancelled invitation", async () => {
      const payload = buildRegisterPayload();
      const { inviteToken } = await seedInvitation({
        invitedEmail: payload.email,
        status: INVITED_USER_STATUS.CANCELED,
      });

      const res = await request(app)
        .post("/api/auth/register")
        .send({ ...payload, inviteToken })
        .set("Accept", "application/json");

      expect(res.body.success).toBe(false);
      expect(res.body.message).toBe(
        AUTH_RESPONSE_MESSAGES.INVITATION_CANCELLED,
      );
      expect(await User.countDocuments({ email: payload.email })).toBe(0);
    });
  });
});
