import { AUTH_PROVIDER } from "@/enums/auth.enum";
import { AuthKitProvider } from "@/providers/auth/authkit.provider";
import { SupabaseProvider } from "@/providers/auth/supabase.provider";

import {
  IAuthProvider,
  IAuthenticateWithPasswordOptions,
  ICreateMagicLinkSessionOptions,
  ICreateUserOptions,
  IGenerateOAuthUrlOptions,
  IUpdateUserOptions,
  IVerifyMagicLinkTokenOptions,
} from "@/providers/auth/utils/auth.types";

/**
 * AuthService - Business logic layer for Auth operations
 *
 * This service acts as a facade over the Auth provider layer,
 * allowing easy switching between different Auth providers (WorkOS, Supabase, etc.)
 */
export class AuthService {
  private authProvider: IAuthProvider;

  constructor() {
    this.authProvider = createAuthProvider(AUTH_PROVIDER.WORKOS);
  }

  async createUser(options: ICreateUserOptions) {
    return this.authProvider.createUser(options);
  }

  async updateUser(options: IUpdateUserOptions) {
    return this.authProvider.updateUser(options);
  }

  async authenticateWithPassword(options: IAuthenticateWithPasswordOptions) {
    return this.authProvider.authenticateWithPassword(options);
  }

  async authenticateWithCode(code: string) {
    return this.authProvider.authenticateWithCode(code);
  }

  async createMagicLinkSession(options: ICreateMagicLinkSessionOptions) {
    return this.authProvider.createMagicLinkSession(options);
  }

  async verifyMagicLinkToken(options: IVerifyMagicLinkTokenOptions) {
    return this.authProvider.verifyMagicLinkToken(options);
  }

  async generateOAuthUrl(options: IGenerateOAuthUrlOptions) {
    if (!this.authProvider.generateOAuthUrl) {
      throw new Error("OAuth is not supported by this provider");
    }
    return this.authProvider.generateOAuthUrl(options);
  }

  /**
   * LOCAL E2E CLEANUP OPERATIONS
   *
   * Used only by:
   * modules/e2e-support/helpers/delete-test-user.helper.ts
   *
   * These do not belong to the application's normal soft-delete flow.
   */
  async deleteUser(userId: string) {
    if (!this.authProvider.deleteUser) {
      throw new Error("User deletion is not supported by this provider");
    }
    return this.authProvider.deleteUser(userId);
  }

  async deleteOrganization(organizationId: string) {
    if (!this.authProvider.deleteOrganization) {
      throw new Error("Organizations are not supported by this provider");
    }
    return this.authProvider.deleteOrganization(organizationId);
  }

  async deleteOrganizationMembership(membershipId: string) {
    if (!this.authProvider.deleteOrganizationMembership) {
      throw new Error(
        "Organization memberships are not supported by this provider",
      );
    }
    return this.authProvider.deleteOrganizationMembership(membershipId);
  }
}

function createAuthProvider(providerType: AUTH_PROVIDER): IAuthProvider {
  switch (providerType) {
    case AUTH_PROVIDER.WORKOS:
      return new AuthKitProvider();
    case AUTH_PROVIDER.SUPABASE:
      return new SupabaseProvider();
    default:
      throw new Error("Invalid auth provider type");
  }
}

export const authService = new AuthService();
