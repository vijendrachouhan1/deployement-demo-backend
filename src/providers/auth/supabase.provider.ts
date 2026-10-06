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

export class SupabaseProvider implements IAuthProvider {
  constructor() {
    throw new Error("SUPABASE PROVIDER is not implemented");
  }

  async createUser(_options: ICreateUserOptions): Promise<IAuthProviderUser> {
    throw new Error("SUPABASE createUser method is not implemented");
  }

  async updateUser(_options: IUpdateUserOptions): Promise<IAuthProviderUser> {
    throw new Error("SUPABASE updateUser method is not implemented");
  }

  async authenticateWithPassword(
    _options: IAuthenticateWithPasswordOptions,
  ): Promise<IAuthResponse> {
    throw new Error(
      "SUPABASE authenticateWithPassword method is not implemented",
    );
  }

  async authenticateWithCode(_code: string): Promise<IAuthResponse> {
    throw new Error("SUPABASE authenticateWithCode method is not implemented");
  }

  async createMagicLinkSession(
    _options: ICreateMagicLinkSessionOptions,
  ): Promise<{ link: string }> {
    throw new Error(
      "SUPABASE createMagicLinkSession method is not implemented",
    );
  }

  async verifyMagicLinkToken(
    _options: IVerifyMagicLinkTokenOptions,
  ): Promise<IAuthProviderUser> {
    throw new Error("SUPABASE verifyMagicLinkToken method is not implemented");
  }

  async generateOAuthUrl(_options: IGenerateOAuthUrlOptions): Promise<string> {
    throw new Error("SUPABASE generateOAuthUrl method is not implemented");
  }
}
