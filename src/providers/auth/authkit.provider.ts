import { User as TAuthUser, WorkOS } from "@workos-inc/node";
import {
  IAuthProvider,
  IAuthProviderUser,
  ICreateUserOptions,
  IUpdateUserOptions,
  IAuthenticateWithPasswordOptions,
  IAuthResponse,
  ICreateMagicLinkSessionOptions,
  IVerifyMagicLinkTokenOptions,
  IGenerateOAuthUrlOptions,
} from "@/providers/auth/utils/auth.types";
import { parseMfaChallenge } from "@/providers/auth/utils/authkit.util";
import envConfig from "@/config/env";
import { SOCIAL_OAUTH_METHOD } from "@/enums/auth.enum";
import { User } from "@/db/models/user";
import { SERVER_ENV } from "@/enums";
import { ERROR_CODES } from "@/constants/error-codes";
import { AuthProviderError } from "@/providers/auth/utils/auth-provider.error";
import { PASSWORD_ERROR_MESSAGES } from "@/providers/auth/utils/auth.constant";

export const workos = new WorkOS({
  apiKey: envConfig.WORKOS_API_KEY,
  clientId: envConfig.WORKOS_CLIENT_ID,
});

/**
 * Shape of the request exceptions thrown by the WorkOS SDK
 * (BadRequestException, UnprocessableEntityException, etc.) — all extend
 * Error and carry an optional error code and validation details.
 */
interface WorkOSRequestError extends Error {
  code?: string;
  errors?: Array<{ code?: string; message?: string }>;
  rawData?: unknown;
}

function isWorkOSRequestError(error: unknown): error is WorkOSRequestError {
  return error instanceof Error;
}

const AUTHKIT_OAUTH_PROVIDER: Record<SOCIAL_OAUTH_METHOD, string> = {
  [SOCIAL_OAUTH_METHOD.GOOGLE]: "GoogleOAuth",
  [SOCIAL_OAUTH_METHOD.LINKEDIN]: "LinkedInOAuth",
  [SOCIAL_OAUTH_METHOD.MICROSOFT]: "MicrosoftOAuth",
  [SOCIAL_OAUTH_METHOD.APPLE]: "AppleOAuth",
  [SOCIAL_OAUTH_METHOD.GITHUB]: "GitHubOAuth",
};

export class AuthKitProvider implements IAuthProvider {
  constructor() {
    this.listenForChangeStream();
  }

  async createUser(options: ICreateUserOptions): Promise<IAuthProviderUser> {
    try {
      const user = await workos.userManagement.createUser({
        email: options.email,
        password: options.password,
        firstName: options.firstName,
        lastName: options.lastName,
        emailVerified: options.emailVerified ?? true,
        externalId: options.externalId,
      });

      return this.mapUser(user);
    } catch (error) {
      if (
        isWorkOSRequestError(error) &&
        error.code === "password_strength_error"
      ) {
        throw new AuthProviderError(PASSWORD_ERROR_MESSAGES.PASSWORD_TOO_WEAK, {
          code: ERROR_CODES.PASSWORD_TOO_WEAK,
          cause: error,
        });
      }
      throw new Error("Failed to create user", { cause: error });
    }
  }

  async updateUser(options: IUpdateUserOptions): Promise<IAuthProviderUser> {
    const isPasswordUpdate = Boolean(options.password);

    try {
      const updatedData = Object.entries(options).reduce(
        (acc, [key, value]) => {
          if (key !== "userId" && value !== undefined) {
            acc[key] = value;
          }
          return acc;
        },
        {} as Record<string, any>,
      );

      const user = await workos.userManagement.updateUser({
        userId: options.userId,
        ...updatedData,
      });

      return this.mapUser(user);
    } catch (error) {
      if (isWorkOSRequestError(error)) {
        if (error.code === "password_strength_error") {
          throw new AuthProviderError(
            PASSWORD_ERROR_MESSAGES.PASSWORD_TOO_WEAK,
            { code: ERROR_CODES.PASSWORD_TOO_WEAK, cause: error },
          );
        }
        if (error.errors?.[0]?.code === "password_reused") {
          throw new AuthProviderError(PASSWORD_ERROR_MESSAGES.PASSWORD_REUSED, {
            code: ERROR_CODES.PASSWORD_REUSED,
            cause: error,
          });
        }
      }
      throw new Error(
        isPasswordUpdate
          ? "Failed to update password"
          : "Failed to update user profile",
        { cause: error },
      );
    }
  }

  async authenticateWithPassword(
    options: IAuthenticateWithPasswordOptions,
  ): Promise<IAuthResponse> {
    try {
      const { user, accessToken } =
        await workos.userManagement.authenticateWithPassword({
          email: options.email,
          password: options.password!,
        });

      return {
        user: this.mapUser(user),
        token: accessToken,
      };
    } catch (error) {
      const mfaChallengeUser = parseMfaChallenge(error);
      if (mfaChallengeUser) {
        return { user: mfaChallengeUser, mfaRequired: true };
      }

      throw new Error("Invalid email or password", { cause: error });
    }
  }

  async authenticateWithCode(code: string): Promise<IAuthResponse> {
    try {
      let user: TAuthUser | null = null;

      try {
        const result = await workos.userManagement.authenticateWithCode({
          code,
          clientId: envConfig.WORKOS_CLIENT_ID,
        });
        user = result.user;
      } catch (error: any) {
        // Handle specific flow where external provider requires additional email verification
        if (error.rawData?.code === "email_verification_required") {
          const rawData = error.rawData;
          const emailVerification =
            await workos.userManagement.getEmailVerification(
              rawData.email_verification_id,
            );
          const result =
            await workos.userManagement.authenticateWithEmailVerification({
              code: emailVerification.code,
              pendingAuthenticationToken: rawData.pending_authentication_token,
            });
          user = result.user;
        } else {
          throw error;
        }
      }

      if (!user) {
        throw new Error("Failed to authenticate user");
      }

      return {
        user: this.mapUser(user),
      };
    } catch (error) {
      throw new Error("Failed to authenticate with code", { cause: error });
    }
  }

  async createMagicLinkSession(
    options: ICreateMagicLinkSessionOptions,
  ): Promise<{ link: string }> {
    try {
      const session = await workos.passwordless.createSession({
        email: options.email,
        type: "MagicLink",
        redirectURI: options.redirectURI,
      });

      return { link: session.link };
    } catch (error) {
      throw new Error("Failed to create magic link session", { cause: error });
    }
  }

  async verifyMagicLinkToken(
    options: IVerifyMagicLinkTokenOptions,
  ): Promise<IAuthProviderUser> {
    try {
      const { profile } = await workos.sso.getProfileAndToken({
        code: options.code,
        clientId: envConfig.WORKOS_CLIENT_ID!,
      });

      return {
        firstName: profile.firstName || null,
        lastName: profile.lastName || null,
        email: profile.email,
        id: profile.id,
      };
    } catch (error) {
      throw new Error("Invalid or expired magic link", { cause: error });
    }
  }

  async generateOAuthUrl(options: IGenerateOAuthUrlOptions) {
    try {
      console.log("options", options, AUTHKIT_OAUTH_PROVIDER[options.provider]);
      return workos.userManagement.getAuthorizationUrl({
        clientId: envConfig.WORKOS_CLIENT_ID!,
        redirectUri: options.redirectUri,
        provider: AUTHKIT_OAUTH_PROVIDER[options.provider],
      });
    } catch (error) {
      throw new Error("Failed to generate OAuth URL", { cause: error });
    }
  }

  private mapUser(data: TAuthUser): IAuthProviderUser {
    return {
      id: data.id,
      email: data.email,
      firstName: data.firstName || null,
      lastName: data.lastName || null,
      emailVerified: data.emailVerified,
      metadata: data.metadata,
    };
  }

  private listenForChangeStream() {
    if (envConfig.NODE_ENV === SERVER_ENV.DEVELOPMENT) return;

    const changeStream = User.watch();

    // Change streams require a replica set (e.g. MongoDB Atlas). On a
    // standalone local MongoDB, skip the user → WorkOS sync instead of crashing.
    changeStream.on("error", (error) => {
      console.warn(
        "User → WorkOS sync disabled (change streams require a replica set):",
        error.message,
      );
      changeStream.close().catch(() => {});
    });

    changeStream.on("change", async (change) => {
      try {
        if (change.operationType === "delete") {
          const deletedUserId = change.documentKey._id;

          await workos.userManagement
            .getUserByExternalId(deletedUserId.toString())
            .then(async (user) => {
              if (user) {
                await workos.userManagement.deleteUser(user.id);
              }
            })
            .catch(() => {});
        }

        if (change.operationType === "update") {
          const updatedFields = change.updateDescription?.updatedFields;
          const userId = change.documentKey._id;
          const keys = Object.keys(updatedFields || {});

          if (
            keys.includes("name.first") ||
            keys.includes("name.last") ||
            keys.includes("email")
          ) {
            const user = await User.findById(userId).select("externalUserId");

            if (user?.externalUserId) {
              await workos.userManagement.updateUser({
                userId: user?.externalUserId,
                firstName: updatedFields["name.first"],
                lastName: updatedFields["name.last"],
                email: updatedFields["email"],
                emailVerified: true,
              });
            }
          }
        }
      } catch (error: any) {
        console.error("Error syncing user data with WorkOS:", error.message);
      }
    });
  }

  /**
   * LOCAL E2E CLEANUP OPERATIONS
   *
   * Used only by:
   * modules/e2e-support/helpers/delete-test-user.helper.ts
   *
   * These do not belong to the application's normal soft-delete flow.
   */
  async deleteUser(userId: string): Promise<void> {
    try {
      await workos.userManagement.deleteUser(userId);
    } catch (error) {
      throw new Error("Failed to delete user", { cause: error });
    }
  }

  async deleteOrganization(organizationId: string): Promise<void> {
    try {
      await workos.organizations.deleteOrganization(organizationId);
    } catch (error) {
      throw new Error("Failed to delete organization", { cause: error });
    }
  }

  async deleteOrganizationMembership(membershipId: string): Promise<void> {
    try {
      await workos.userManagement.deleteOrganizationMembership(membershipId);
    } catch (error) {
      throw new Error("Failed to delete organization membership", {
        cause: error,
      });
    }
  }
}
