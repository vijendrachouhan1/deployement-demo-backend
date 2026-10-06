import { TErrorCode } from "@/constants/error-codes";
import { IUser, IUserDocument } from "@/db/models/user";
import { COOKIE_NAME } from "@/enums";
import {
  LOGIN_METHOD,
  MFA_RESET_IDENTITY_METHOD,
  PENDING_MFA_PURPOSE,
} from "@/modules/auth/utils/auth.enum";
import {
  authValidators,
  RegisterBodySchema,
  LoginBodySchema,
  RegisterLoginOauthBodySchema,
} from "@/modules/auth/utils/auth.validation";
import { CookieOptions, Response } from "express";
import z from "zod";

export type TAuthController = typeof authValidators;

export type TUpdatePasswordResult =
  | { success: true; user: IUserDocument | null }
  | {
      success: false;
      status: number;
      message: string;
      messageCode?: TErrorCode;
    };

export type TLoginResponse =
  | {
      error: string;
      status: number;
      user?: never;
      token?: never;
      pendingMfaToken?: never;
      passwordRotation?: never;
      mfaChallengeId?: never;
      refreshToken?: never;
    }
  | {
      error: null;
      status: number;
      user: IUser;
      token?: string | null;
      refreshToken?: string;
      pendingMfaToken?: string | null;
      passwordRotation?: TPasswordRotationState;
      mfaChallengeId?: string;
    };

export type TRegisterParams = z.infer<typeof RegisterBodySchema>;
export type TLoginParams = z.infer<typeof LoginBodySchema> & {
  res: Response;
};
export type TRegisterLoginOauthParams = z.infer<
  typeof RegisterLoginOauthBodySchema
>;

export type TOtpVerifyResult =
  | {
      success: true;
      message: string;
      email?: string;
      token?: string;
      refreshToken?: string;
      user?: IUser;
      warning?: TErrorCode;
      daysLeft?: number;
    }
  | { success: false; message: string; statusCode: number };

export type TOtpRequestResult =
  | { success: true; message: string }
  | { success: false; message: string; statusCode: number };

export type TVerifyResetResult =
  { success: true } | { success: false; message: string; statusCode: number };

export interface IAuthCookies {
  token: string;
  refreshToken?: string;
  user?: IUser;
}

export type TSetCookieParams = {
  cookieName: COOKIE_NAME;
  value: string;
  httpOnly?: boolean;
  options?: CookieOptions;
};

export type TPasswordRotationConfig = {
  rotatePassword: boolean;
  passwordValidityDays: number;
  passwordGraceDays: number;
};

export type TPasswordRotationState = {
  isBlocked: boolean;
  errorCode?: TErrorCode;
  daysLeft?: number;
};

export type TVerifyMfaSetupParams = {
  email: string;
  userId: string;
  challengeId: string;
  code: string;
  factorId: string;
  user?: IUser;
  loginMethod?: LOGIN_METHOD;
};

export type TVerifyMfaChallengeParams = Omit<
  TVerifyMfaSetupParams,
  "factorId"
> & {
  /** Claims the pending token was minted with, so a challenge raised for
   * another account cannot be spent to complete this login. */
  boundChallengeId?: string;
  boundFactorId?: string;
};

/** Claims carried by a pending-MFA token. `challengeId`/`factorId` bind the
 * token to the single challenge issued alongside it; `loginMethod` carries the
 * originating flow through to the session token. */
export type TPendingMfaClaims = {
  _id: string;
  email: string;
  purpose: PENDING_MFA_PURPOSE;
  challengeId?: string;
  factorId?: string;
  loginMethod?: LOGIN_METHOD;
};

/** Provider-side records created so far, so a failure can undo them. */
export type TProvisionedRecords = {
  externalUserId?: string;
  organizationId?: string;
  membershipId?: string;
};

export type TVerifyMfaSetupResponse =
  | {
      message: string;
      statusCode: number;
      error: true;
      token?: never;
      refreshToken?: never;
      recoveryCodes?: never;
      user?: never;
    }
  | {
      message: string;
      statusCode: number;
      error: false;
      token: string;
      refreshToken: string;
      recoveryCodes: string[];
      user: IUser;
    };
export type TVerifyMfaChallengeResponse =
  | {
      message: string;
      statusCode: number;
      error: true;
      token?: never;
      refreshToken?: never;
      user?: never;
    }
  | {
      message: string;
      statusCode: number;
      error: false;
      token: string;
      refreshToken: string;
      user: IUser;
    };
export type TSkipMfaResponse =
  | {
      message: string;
      statusCode: number;
      error: true;
      token?: never;
      refreshToken?: never;
      user?: never;
    }
  | {
      message: string;
      statusCode: number;
      error: false;
      token: string;
      refreshToken: string;
      user: IUser;
    };

export type TVerifyResetRequestParams = {
  email: string;
  code: string;
  method: MFA_RESET_IDENTITY_METHOD;
  factorId: string;
};
