import status from "http-status";
import mongoose, { ClientSession } from "mongoose";
import { Company, ICompany } from "@/db/models/company";
import { IInvitedUsers, InvitedUsers } from "@/db/models/invitedUsers";
import { IUser, IUserDocument, User } from "@/db/models/user";
import { INVITED_USER_STATUS, STATUS, USER_TYPE } from "@/enums";
import { AppError } from "@/helpers/app-error";
import { validateInvitation } from "@/modules/auth/helpers/invite.helper";
import { generatePendingMfaToken } from "@/modules/auth/helpers/pending-mfa.helper";
import { generateAuthTokens } from "@/modules/auth/helpers/token.helper";
import {
  AUTH_RESPONSE_MESSAGES,
  MFA_ENROLLMENT_REQUIRED_AT_SIGNUP,
} from "@/modules/auth/utils/auth.constant";
import {
  LOGIN_METHOD,
  PENDING_MFA_PURPOSE,
} from "@/modules/auth/utils/auth.enum";
import {
  TProvisionedRecords,
  TRegisterLoginOauthParams,
  TRegisterParams,
} from "@/modules/auth/utils/auth.types";
import {
  buildPasswordTimestamps,
  getPasswordRotationConfig,
} from "@/modules/auth/utils/auth.util";
import { isUserInactiveOrDeleted } from "@/modules/auth/utils/auth.util";
import { referralsHelper } from "@/modules/referrals/helpers/referrals.helper";
import { authService } from "@/providers/auth";
import { workos } from "@/providers/auth/authkit.provider";

async function syncWithAuthProvider({
  user,
  password,
  createOrganization,
  createUser = true,
  company,
  session,
  provisioned,
}: {
  password: string;
  user: IUser;
  company: ICompany;
  createUser?: boolean;
  createOrganization?: boolean;
  session?: ClientSession;
  provisioned?: TProvisionedRecords;
}) {
  let externalUserId = user.externalUserId ?? "";

  if (createUser) {
    /**
     1. Create the user in the external auth provider and get the externalUserId.
     externalId links the provider record back to the local user id — it powers
     getUserByExternalId, used by the delete-sync change stream.
     */
    const authProviderUser = await authService.createUser({
      email: user.email,
      password: password,
      firstName: user.name.first,
      lastName: user.name.last,
      emailVerified: true,
      externalId: user._id.toString(),
    });
    externalUserId = authProviderUser.id;
    if (provisioned) provisioned.externalUserId = externalUserId;

    // 2. Update the DB user record with the externalUserId and companyRef
    await User.findByIdAndUpdate(
      user._id,
      { externalUserId },
      { session },
    ).exec();
  }

  let workosOrgId: string | undefined = company.externalId;

  // 3. Create a organization in WorkOS  if companyId is provided and user is an admin, and link the auth provider user to the organization
  if (createOrganization && !workosOrgId) {
    const workosOrg = await workos.organizations.createOrganization({
      name: user.email,
      externalId: company._id.toString(),
    });
    if (provisioned) provisioned.organizationId = workosOrg.id;

    await Company.updateOne(
      { _id: company._id },
      { externalId: workosOrg.id },
      { session },
    );
    workosOrgId = workosOrg.id;
  }

  if (workosOrgId) {
    // assign role to user
    const membership = await workos.userManagement.createOrganizationMembership(
      {
        organizationId: workosOrgId,
        roleSlug:
          user.roles === USER_TYPE.ADMIN ? USER_TYPE.ADMIN : USER_TYPE.USER,
        userId: externalUserId,
      },
    );
    if (provisioned) provisioned.membershipId = membership.id;

    await User.findByIdAndUpdate(
      user._id,
      { organizationMembershipId: membership.id },
      { session },
    ).exec();
  }
}

/**
 * Deletes the provider records a failed registration left behind. Best effort:
 * errors are swallowed so cleanup cannot mask the failure being thrown.
 */
async function rollbackProvisionedRecords(provisioned: TProvisionedRecords) {
  const { membershipId, organizationId, externalUserId } = provisioned;

  // Newest first, so nothing is deleted before the records referencing it.
  const cleanups = [
    membershipId &&
      (() => workos.userManagement.deleteOrganizationMembership(membershipId)),
    organizationId &&
      (() => workos.organizations.deleteOrganization(organizationId)),
    externalUserId && (() => workos.userManagement.deleteUser(externalUserId)),
  ].filter(Boolean) as Array<() => Promise<unknown>>;

  for (const cleanup of cleanups) {
    try {
      await cleanup();
    } catch {
      // Leaves an orphaned provider record, which is preferable to hiding the
      // original error.
    }
  }
}

/**
 * Marks the invitation `validateInvitation` resolved. Matches on `_id` because an
 * address may hold several invitations.
 */
async function acceptInvitation(
  invitation: IInvitedUsers,
  session?: ClientSession,
) {
  await InvitedUsers.updateOne(
    { _id: invitation._id },
    { status: INVITED_USER_STATUS.ACCEPTED },
    { session },
  );
}

/**
 * Handles standard email/password registration
 * @param data - Registration details including email, password, name, and optional referral/invite tokens
 * @returns Object containing the created user and their session token
 */
export async function register(data: TRegisterParams) {
  const { email, password, name, referralCode, inviteToken } = data;

  // 1. Validate invitation if an invite token is provided
  let invitation: IInvitedUsers | null = null;
  if (inviteToken) {
    invitation = await validateInvitation({ inviteToken, email });
  }

  const isInvite = !!invitation;
  const userRole = isInvite && invitation ? invitation.role : USER_TYPE.ADMIN;
  let companyRef = invitation?.companyRef;
  let companyConfig: {
    rotatePassword: boolean;
    passwordValidityDays: number;
    passwordGraceDays: number;
  } | null = null;

  const shouldCreateCompany = !companyRef && userRole === USER_TYPE.ADMIN;

  // Local writes commit only once provider provisioning has succeeded, so a
  // provider outage leaves nothing behind and the same email can register again.
  const session = await mongoose.startSession();
  const provisioned: TProvisionedRecords = {};

  let user: mongoose.HydratedDocument<IUserDocument>;

  session.startTransaction();

  try {
    // 2. Create a new company if the user is an Admin and not joining via invitation
    let company: ICompany | undefined | null = undefined;
    if (shouldCreateCompany) {
      const [createdCompany] = await Company.create([{ name: email }], {
        session,
      });

      companyRef = createdCompany._id;
      company = createdCompany;

      companyConfig = getPasswordRotationConfig(createdCompany);
    } else if (companyRef) {
      company = await Company.findById(companyRef).session(session);

      companyConfig = getPasswordRotationConfig(company ?? null);
    }

    /**
     * Every account must belong to a company: the session token is built from the
     * company's WorkOS externalId (see generateAuthTokens), so an account created
     * without one could never log in. This is reachable when an invitation carries
     * no companyRef, or one that no longer resolves — fail before the user row is
     * written rather than dereferencing an undefined company downstream.
     */
    if (!company) {
      throw new Error(AUTH_RESPONSE_MESSAGES.INVITATION_COMPANY_MISSING);
    }

    const passwordTimestamps = password
      ? buildPasswordTimestamps(companyConfig?.passwordValidityDays)
      : {};

    const hasPassword = !!password;

    // 3. Create local user record
    [user] = await User.create(
      [
        {
          email,
          name,
          hasPassword,
          ...passwordTimestamps,
          companyRef,
          mfa: {
            enrolled: false,
          },
          roles: userRole,
        },
      ],
      { session },
    );

    // 4. Link company back to the admin user
    if (companyRef && userRole === USER_TYPE.ADMIN) {
      await Company.findByIdAndUpdate(
        companyRef,
        { userRef: user._id },
        { session },
      ).exec();
    }

    // 5. Update invitation status if applicable
    if (invitation) {
      await acceptInvitation(invitation, session);
    }

    // 6. Apply referral rewards if a referral code was used
    if (referralCode) {
      await referralsHelper.applyReferralCode(user._id, referralCode, session);
    }

    //7. Sync user to external auth provider and create organization in WorkOS if needed
    await syncWithAuthProvider({
      user,
      password: password || "",
      createOrganization: shouldCreateCompany,
      company,
      session,
      provisioned,
    });

    await session.commitTransaction();
  } catch (error) {
    await session.abortTransaction();
    await rollbackProvisionedRecords(provisioned);
    throw error;
  } finally {
    await session.endSession();
  }

  //8. if mfa is required then generate a temporary token for MFA enrollment instead of logging in the user directly
  if (MFA_ENROLLMENT_REQUIRED_AT_SIGNUP) {
    const pendingMfaToken = generatePendingMfaToken({
      userId: user._id.toString(),
      email: user.email,
      purpose: PENDING_MFA_PURPOSE.SIGNUP,
      loginMethod: LOGIN_METHOD.PASSWORD,
    });
    return { user, pendingMfaToken };
  }

  //9. Generate JWT session token
  const { token, refreshToken, permissions } = await generateAuthTokens({
    user,
    loginMethod: LOGIN_METHOD.PASSWORD,
  });

  return { user: { ...user.toObject(), permissions }, token, refreshToken };
}

/**
 * Handles social registration and login (OAuth)
 * @param data - Contains the OAuth code, provider name, and optional invite token
 * @returns Object containing the user and their session token
 */
export async function registerLoginOauth(data: TRegisterLoginOauthParams) {
  const { code, oauthProvider, inviteToken } = data;

  // 1. Authenticate with Auth Provider using the OAuth code
  const result = await authService.authenticateWithCode(code);
  const authProviderUser = result.user;

  if (!authProviderUser) {
    throw new Error("Something went wrong during social authentication!");
  }

  const firstName = authProviderUser.firstName || "USER";
  const lastName = authProviderUser.lastName || "BYLDD";
  const email = authProviderUser.email;

  // 2. Check if user already exists in local DB
  let user = await User.findOne({ email });

  if (user && isUserInactiveOrDeleted(user)) {
    throw new AppError(
      user.status === STATUS.DELETED
        ? AUTH_RESPONSE_MESSAGES.ACCOUNT_DELETED
        : AUTH_RESPONSE_MESSAGES.ACCOUNT_DISABLED,
      status.UNAUTHORIZED,
    );
  }

  let company: ICompany | undefined | null = user?.companyRef
    ? await Company.findById(user.companyRef)
    : null;
  // 3. If user doesn't exist, create a new record (Registration flow for Social Login)
  if (!user) {
    const session = await mongoose.startSession();
    const provisioned: TProvisionedRecords = {};

    session.startTransaction();

    try {
      let invitation: IInvitedUsers | null = null;

      // Validate invitation if an invite token is provided
      if (inviteToken) {
        invitation = await validateInvitation({ inviteToken, email });
      }

      const isInvite = !!invitation;
      const userRole =
        isInvite && invitation ? invitation.role : USER_TYPE.ADMIN;
      let companyRef = invitation?.companyRef;

      const shouldCreateCompany = !companyRef && userRole === USER_TYPE.ADMIN;
      // Create company for new Admin users
      if (shouldCreateCompany) {
        const [createdCompany] = await Company.create([{ name: email }], {
          session,
        });
        company = createdCompany;

        companyRef = createdCompany._id;
      } else if (companyRef) {
        // Invited social user — join the company the invitation points at.
        company = await Company.findById(companyRef).session(session);
      }

      // Same requirement as the password flow: no company means no usable session.
      if (!company) {
        throw new Error(AUTH_RESPONSE_MESSAGES.INVITATION_COMPANY_MISSING);
      }

      // Create local user profile
      [user] = await User.create(
        [
          {
            email,
            oauth: oauthProvider?.toUpperCase(),
            name: { first: firstName, last: lastName },
            externalUserId: authProviderUser.id,
            companyRef,
            roles: userRole,
          },
        ],
        { session },
      );

      // Link company to admin — an invited non-admin must not take over ownership.
      if (userRole === USER_TYPE.ADMIN) {
        await Company.findByIdAndUpdate(
          companyRef,
          { userRef: user._id },
          { session },
        ).exec();
      }

      // Sync OAuth provider metadata back to Auth Provider
      if (oauthProvider) {
        await authService.updateUser({
          userId: authProviderUser.id,
          externalId: user._id.toString(),
          metadata: {
            ...authProviderUser.metadata,
            OAuthProvider: oauthProvider,
          },
        });
      }

      await syncWithAuthProvider({
        user,
        password: "",
        createOrganization: shouldCreateCompany,
        createUser: false,
        company,
        session,
        provisioned,
      });

      // Only after provisioning succeeds, so a failed signup leaves the
      // invitation usable.
      if (invitation) {
        await acceptInvitation(invitation, session);
      }

      await session.commitTransaction();
    } catch (error) {
      await session.abortTransaction();
      await rollbackProvisionedRecords(provisioned);
      throw error;
    } finally {
      await session.endSession();
    }
  } else if (company && !company.externalId) {
    // Existing user whose company was never synced to WorkOS: create/link the org now so token generation (which requires externalId) can succeed.
    await syncWithAuthProvider({
      user,
      password: "",
      createOrganization: true,
      createUser: false,
      company,
    });
  }

  // 4. Generate JWT session token
  const { token, refreshToken, permissions } = await generateAuthTokens({
    user,
  });

  return { user: { ...user.toObject(), permissions }, token, refreshToken };
}
