import {
  clearCookieOptions,
  httpOnlyCookieOptions,
  publicCookieOptions,
} from "@/config/cookies";
import { COOKIE_NAME } from "@/enums";
import {
  IAuthCookies,
  TSetCookieParams,
} from "@/modules/auth/utils/auth.types";
import { Response } from "express";

/**
 * CookieHelper class to centralize cookie management
 */
export class CookieHelper {
  /**
   * Set all auth-related cookies
   */
  public setAuthCookies(
    res: Response,
    { token, refreshToken, user }: IAuthCookies,
  ): void {
    // 1. Set JWT Token - Always HTTP-only for security (prevent XSS)
    res.cookie(COOKIE_NAME.TOKEN, token, httpOnlyCookieOptions);
    if (refreshToken) {
      res.cookie(
        COOKIE_NAME.REFRESH_TOKEN,
        refreshToken,
        httpOnlyCookieOptions,
      );
    }

    // 2. Set Public Cookies - These can be read by client-side JS if needed
    // We use publicCookieOptions which has httpOnly: false but same secure/sameSite as token
    if (user?.roles) {
      res.cookie(COOKIE_NAME.USER_TYPE, user.roles, publicCookieOptions);
    }

    if (user?._id) {
      res.cookie(
        COOKIE_NAME.USER_REF,
        user._id.toString(),
        publicCookieOptions,
      );
    }

    if (user?.companyRef) {
      res.cookie(
        COOKIE_NAME.COMPANY_REF,
        user.companyRef?.toString(),
        publicCookieOptions,
      );
    }
  }

  /**
   * Set only the token cookie
   * Useful for scenarios like OAuth or partial updates
   */
  public setTokenCookie(res: Response, token: string): void {
    res.cookie(COOKIE_NAME.TOKEN, token, httpOnlyCookieOptions);
  }

  /**
   * Clear all cookies defined in COOKIE_NAME enum
   */
  public clearAuthCookies(res: Response): void {
    // Iterate through all known cookie names and clear them
    Object.values(COOKIE_NAME).forEach((cookieName) => {
      res.clearCookie(cookieName, clearCookieOptions);
    });
  }

  public setCookie(
    res: Response,
    {
      cookieName,
      value,
      httpOnly = false,
      options = publicCookieOptions,
    }: TSetCookieParams,
  ): void {
    res.cookie(cookieName, value, {
      ...(httpOnly ? httpOnlyCookieOptions : publicCookieOptions),
      ...options,
    });
  }

  public clearCookies(res: Response, cookieNames: COOKIE_NAME[]): void {
    cookieNames.forEach((cookieName) => {
      res.clearCookie(cookieName, clearCookieOptions);
    });
  }

  public setPendingMfaToken(res: Response, token: string): void {
    res.cookie(COOKIE_NAME.PENDING_MFA_TOKEN, token, {
      ...httpOnlyCookieOptions,
      maxAge: 10 * 60 * 1000, // 10 minutes validity
    });
  }

  public setMfaChallengeId(res: Response, challengeId: string): void {
    res.cookie(COOKIE_NAME.MFA_CHALLENGE_ID, challengeId, {
      ...httpOnlyCookieOptions,
      maxAge: 10 * 60 * 1000, // 10 minutes validity
    });
  }
  public setMfaFactorId(res: Response, factorId: string): void {
    res.cookie(COOKIE_NAME.MFA_FACTOR_ID, factorId, {
      ...httpOnlyCookieOptions,
      maxAge: 10 * 60 * 1000, // 10 minutes validity
    });
  }

  public clearMfaCookies(res: Response) {
    res.clearCookie(COOKIE_NAME.PENDING_MFA_TOKEN, clearCookieOptions);
    res.clearCookie(COOKIE_NAME.MFA_CHALLENGE_ID, clearCookieOptions);
    res.clearCookie(COOKIE_NAME.MFA_FACTOR_ID, clearCookieOptions);
  }
}

export const cookieHelper = new CookieHelper();
