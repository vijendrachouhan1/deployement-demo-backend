import { SOCIAL_OAUTH_METHOD } from "@/enums/auth.enum";

export interface IAuthProviderUser {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  emailVerified?: boolean;
  metadata?: Record<string, any>;
}

export interface IAuthResponse {
  user: IAuthProviderUser;
  token?: string;
  refreshToken?: string;
  /** The provider accepted the credential but is holding a second factor. */
  mfaRequired?: boolean;
}

export interface ICreateUserOptions {
  email: string;
  password?: string;
  firstName?: string;
  lastName?: string;
  emailVerified?: boolean;
  externalId?: string;
}

export interface IUpdateUserOptions {
  userId: string;
  firstName?: string;
  lastName?: string;
  password?: string;
  metadata?: Record<string, any>;
  externalId?: string;
}

export interface IAuthenticateWithPasswordOptions {
  email: string;
  password?: string;
}

export interface ICreateMagicLinkSessionOptions {
  email: string;
  redirectURI: string;
}

export interface IVerifyMagicLinkTokenOptions {
  code: string;
}

export interface IGenerateOAuthUrlOptions {
  provider: SOCIAL_OAUTH_METHOD;
  redirectUri: string;
}

export interface IAuthProvider {
  createUser(options: ICreateUserOptions): Promise<IAuthProviderUser>;
  updateUser(options: IUpdateUserOptions): Promise<IAuthProviderUser>;
  authenticateWithPassword(
    options: IAuthenticateWithPasswordOptions,
  ): Promise<IAuthResponse>;
  authenticateWithCode(code: string): Promise<IAuthResponse>;
  createMagicLinkSession(
    options: ICreateMagicLinkSessionOptions,
  ): Promise<{ link: string }>;
  verifyMagicLinkToken(
    options: IVerifyMagicLinkTokenOptions,
  ): Promise<IAuthProviderUser>;
  generateOAuthUrl?(options: IGenerateOAuthUrlOptions): Promise<string>;

  /**
   * LOCAL E2E CLEANUP OPERATIONS
   *
   * Used only by:
   * modules/e2e-support/helpers/delete-test-user.helper.ts
   *
   * These do not belong to the application's normal soft-delete flow, so they
   * are optional — a provider only implements them if E2E runs against it.
   */
  deleteUser?(userId: string): Promise<void>;
  deleteOrganization?(organizationId: string): Promise<void>;
  deleteOrganizationMembership?(membershipId: string): Promise<void>;
}
