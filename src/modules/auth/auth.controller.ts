import envConfig from "@/config/env";
import { ERROR_CODES } from "@/constants/error-codes";
import { IUser, User } from "@/db/models/user";
import { COOKIE_NAME } from "@/enums";
import { ErrorResponse, SuccessResponse } from "@/helpers/api-response";
import { cookieHelper } from "@/helpers/cookie";
import { jwtHelper } from "@/helpers/jwt";
import { authHelper } from "@/modules/auth/helpers/auth.helper";
import { LOGIN_METHOD } from "@/modules/auth/utils/auth.enum";
import type { TAuthController } from "@/modules/auth/utils/auth.types";
import { authService } from "@/providers/auth";
import { NextFunction, Request, Response } from "express";
import status from "http-status";
import { AUTH_RESPONSE_MESSAGES } from "@/modules/auth/utils/auth.constant";
import { shouldPromptUserForMfaEnrollment } from "@/modules/auth/utils/auth.util";
import {
  emitLoginFailure,
  emitLoginMfaRequired,
  emitLoginSuccess,
  emitLogout,
} from "@/modules/auth/helpers/auth-audit.helper";

export class AuthController {
  /**
   * Sends an MFA challenge instead of a session.
   *
   * Web receives the pending token and challenge id as cookies. Mobile has no
   * cookie jar, so it reads them from the response body and sends the pending
   * token back on the `x-pending-mfa-token` header — not Authorization, which
   * jwtDecoder reads for the access token and verifies with another secret.
   *
   * Applies to POST /auth/mfa/verify and POST /auth/mfa/recovery.
   */
  private sendMfaChallenge(
    res: Response,
    {
      isMobile,
      user,
      pendingMfaToken,
      mfaChallengeId,
      message = "MFA required.",
      extraData,
    }: {
      isMobile?: boolean;
      user: IUser;
      pendingMfaToken: string;
      mfaChallengeId?: string;
      message?: string;
      extraData?: Record<string, unknown>;
    },
  ) {
    if (isMobile) {
      return SuccessResponse(res, status.OK, {
        message,
        messageCode: ERROR_CODES.MFA_REQUIRED,
        data: { user, pendingMfaToken, mfaChallengeId, ...extraData },
      });
    }

    cookieHelper.setPendingMfaToken(res, pendingMfaToken);

    if (mfaChallengeId) {
      cookieHelper.clearCookies(res, [COOKIE_NAME.MFA_CHALLENGE_ID]);
      cookieHelper.setMfaChallengeId(res, mfaChallengeId);
    }

    return SuccessResponse(res, status.OK, {
      message,
      messageCode: ERROR_CODES.MFA_REQUIRED,
      data: { user, ...extraData },
    });
  }

  // ==================== Registration ====================

  public register: TAuthController["register"] = async (req, res, next) => {
    try {
      const { email } = req.body;

      const existingUser = await authHelper.findUserByEmail(email);
      if (existingUser) {
        return ErrorResponse(res, status.CONFLICT, {
          message: AUTH_RESPONSE_MESSAGES.USER_ALREADY_EXISTS_EMAIL,
          messageCode: ERROR_CODES.USER_ALREADY_EXISTS,
        });
      }

      const { user, token, refreshToken, pendingMfaToken } =
        await authHelper.register(req.body);

      // MFA enrollment is required before a session is issued.
      if (pendingMfaToken) {
        return this.sendMfaChallenge(res, {
          isMobile: req.isMobile,
          user,
          pendingMfaToken,
          message: "Registration successful.",
          extraData: {
            redirectToMfaSetup: shouldPromptUserForMfaEnrollment(user.roles),
          },
        });
      }

      if (req.isMobile) {
        return SuccessResponse(res, status.OK, {
          message: "Registration successful.",
          data: { user, token, refreshToken },
        });
      }

      if (token && user) {
        cookieHelper.setAuthCookies(res, {
          token,
          refreshToken,
          user,
        });
      }

      return SuccessResponse(res, status.OK, {
        message: "Registration successful.",
        data: {
          user,
          redirectToMfaSetup: shouldPromptUserForMfaEnrollment(user.roles),
        },
      });
    } catch (error) {
      console.log(error);
      next(error);
    }
  };

  public registerLoginOauth: TAuthController["registerLoginOauth"] = async (
    req,
    res,
    next,
  ) => {
    try {
      const { code, oauthProvider, inviteToken } = req.body;
      const { user, token, refreshToken } = await authHelper.registerLoginOauth(
        {
          code,
          oauthProvider: oauthProvider!,
          inviteToken,
        },
      );

      if (req.isMobile) {
        return SuccessResponse(res, status.OK, {
          message: "User registered successfully.",
          data: { user, token, refreshToken },
        });
      }

      cookieHelper.setAuthCookies(res, {
        token,
        refreshToken,
        user,
      });

      return SuccessResponse(res, status.OK, {
        message: "User registered successfully.",
        data: { user },
      });
    } catch (error) {
      next(error);
    }
  };

  // ==================== Login / Logout ====================

  public login: TAuthController["login"] = async (req, res, next) => {
    try {
      const { email, password, loginType, otp } = req.body;

      const result = await authHelper.login({
        email,
        password,
        loginType,
        otp,
        res,
      });

      if (result.error !== null) {
        emitLoginFailure(email, result.error);
        return ErrorResponse(res, result.status, { message: result.error });
      }

      const { user, token, refreshToken, pendingMfaToken, mfaChallengeId } =
        result;

      if (pendingMfaToken) {
        emitLoginMfaRequired(user);
        return this.sendMfaChallenge(res, {
          isMobile: req.isMobile,
          user,
          pendingMfaToken,
          mfaChallengeId,
        });
      }

      if (req.isMobile) {
        emitLoginSuccess(user);
        return SuccessResponse(res, status.OK, {
          message: "Success.",
          data: { user, token, refreshToken },
        });
      }

      cookieHelper.setAuthCookies(res, {
        token: token!,
        refreshToken: refreshToken || undefined,
        user,
      });

      const isPasswordExpired =
        Boolean(result.passwordRotation?.isBlocked) &&
        loginType === LOGIN_METHOD.PASSWORD;

      cookieHelper.setCookie(res, {
        cookieName: COOKIE_NAME.PASSWORD_EXPIRED,
        value: String(isPasswordExpired),
        httpOnly: false,
      });

      emitLoginSuccess(user);

      return SuccessResponse(res, result.status, {
        message: "Success.",
        data: {
          user,
          isPasswordExpired,
          passwordExpiryDaysLeft: result.passwordRotation?.daysLeft,
        },
      });
    } catch (error) {
      emitLoginFailure(req.body?.email);
      next(error);
    }
  };

  public logout = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const token =
        req.cookies[COOKIE_NAME.REFRESH_TOKEN] || req.body.refreshToken;
      if (token) {
        await authHelper.revokeSession(token);
      }

      await emitLogout(req.cookies[COOKIE_NAME.TOKEN]);

      cookieHelper.clearAuthCookies(res);

      return SuccessResponse(res, status.OK, {
        message: "Logged out successfully.",
      });
    } catch (error) {
      next(error);
    }
  };

  public refreshToken = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const token = req.cookies[COOKIE_NAME.REFRESH_TOKEN];

      if (!token) {
        cookieHelper.clearAuthCookies(res);
        return ErrorResponse(res, status.UNAUTHORIZED, {
          message: "Refresh token required.",
        });
      }

      const result = await authHelper.refreshSession(token);

      if (result.error) {
        cookieHelper.clearAuthCookies(res);
        return ErrorResponse(res, status.UNAUTHORIZED, {
          message: result.error,
        });
      }

      cookieHelper.setAuthCookies(res, {
        token: result.token!,
        refreshToken: result.refreshToken!,
        user: result.user,
      });

      return SuccessResponse(res, status.OK, {
        message: "Token refreshed successfully.",
      });
    } catch (error) {
      cookieHelper.clearAuthCookies(res);
      return ErrorResponse(res, status.UNAUTHORIZED, {
        message: "Refresh token invalid or expired.",
      });
    }
  };

  public revokeToken = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const token = req.cookies[COOKIE_NAME.REFRESH_TOKEN];
      if (token) {
        await authHelper.revokeSession(token);
      }
      cookieHelper.clearAuthCookies(res);
      return SuccessResponse(res, status.OK, {
        message: "Token revoked successfully.",
      });
    } catch (error) {
      next(error);
    }
  };

  // ==================== Password ====================

  public sendResetEmail: TAuthController["sendResetEmail"] = async (
    req,
    res,
    next,
  ) => {
    try {
      const { email } = req.body;
      const result = await authHelper.sendResetEmail(email);

      if (!result.success) {
        return ErrorResponse(res, result.status || status.BAD_REQUEST, {
          message: result.message,
        });
      }

      return SuccessResponse(res, status.OK, {
        message: "Email sent successfully.",
      });
    } catch (error) {
      next(error);
    }
  };

  public updatePassword: TAuthController["updatePassword"] = async (
    req,
    res,
    next,
  ) => {
    try {
      const { email, password, token } = req.body;
      const result = await authHelper.updatePassword(email, password, token);

      if (!result.success) {
        return ErrorResponse(res, result.status || status.BAD_REQUEST, {
          message: result.message,
          messageCode: result.messageCode,
        });
      }

      return SuccessResponse(res, status.OK, {
        message: "User password updated successfully.",
        data: result.user,
      });
    } catch (error) {
      return ErrorResponse(res, status.UNAUTHORIZED, {
        message: "Invalid or expired token.",
      });
    }
  };

  // ==================== Misc ====================

  public unsubscribe = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const id = req.params.id;
      const user = await User.findByIdAndUpdate(id, {
        subscribedToNewsletter: false,
      });
      return SuccessResponse(res, status.OK, {
        message: "Success.",
        data: user,
      });
    } catch (error) {
      next(error);
    }
  };

  // ==================== OTP ====================

  /**
   * Works for email and phone, for all purposes.
   */
  public requestOtp: TAuthController["requestOtp"] = async (req, res, next) => {
    try {
      const { identifier, purpose } = req.body;
      const result = await authHelper.requestOtp(identifier, purpose);

      if (!result.success) {
        return ErrorResponse(res, result.statusCode, {
          message: result.message,
        });
      }

      return SuccessResponse(res, status.OK, { message: result.message });
    } catch (error) {
      next(error);
    }
  };

  /**
   * Generates a fresh OTP (invalidating the previous one).
   */
  public resendOtp: TAuthController["requestOtp"] = async (req, res, next) => {
    try {
      const { identifier, purpose } = req.body;
      const result = await authHelper.resendOtp(identifier, purpose);

      if (!result.success) {
        return ErrorResponse(res, result.statusCode, {
          message: result.message,
        });
      }

      return SuccessResponse(res, status.OK, { message: result.message });
    } catch (error) {
      next(error);
    }
  };

  /**
   * Returns:
   *  - Email + SIGNUP  → { email } so caller can complete registration
   *  - All other flows → auth token + user (cookie set for web)
   */
  public verifyOtp: TAuthController["verifyOtp"] = async (req, res, next) => {
    try {
      const { identifier, purpose, otp } = req.body;
      const result = await authHelper.verifyOtp(identifier, purpose, otp);

      if (!result.success) {
        return ErrorResponse(res, result.statusCode, {
          message: result.message,
        });
      }

      // Signup email flow — no session issued yet
      if (result.email) {
        return SuccessResponse(res, status.OK, {
          message: result.message,
          data: { email: result.email },
        });
      }

      // All authenticated flows — set cookie for web, return token for mobile
      if (req.isMobile) {
        return SuccessResponse(res, status.OK, {
          message: result.message,
          data: {
            user: result.user,
            token: result.token,
            refreshToken: result.refreshToken,
            warning: result.warning,
            daysLeft: result.daysLeft,
          },
        });
      }

      cookieHelper.setAuthCookies(res, {
        token: result.token!,
        refreshToken: result.refreshToken || undefined,
        user: result.user!,
      });

      return SuccessResponse(res, status.OK, {
        message: result.message,
        data: {
          user: result.user,
          warning: result.warning,
          daysLeft: result.daysLeft,
        },
      });
    } catch (error) {
      next(error);
    }
  };

  // ==================== Magic Link ====================

  public requestMagicLink: TAuthController["emailOnly"] = async (
    req,
    res,
    next,
  ) => {
    try {
      const { email } = req.body;
      await authHelper.requestMagicLink(email);
      return SuccessResponse(res, status.OK, {
        message: "Magic link sent to email.",
      });
    } catch (error) {
      next(error);
    }
  };

  public verifyMagicLink: TAuthController["verifyMagicLink"] = async (
    req,
    res,
    next,
  ) => {
    try {
      const { token } = req.query;

      if (!token) {
        return ErrorResponse(res, status.UNAUTHORIZED, {
          message: "Invalid or expired link.",
        });
      }

      const {
        user,
        token: jwtToken,
        refreshToken,
        error,
        statusCode,
      } = await authHelper.verifyMagicLink(token);

      if (error) {
        return ErrorResponse(res, statusCode, {
          message: error,
        });
      }

      cookieHelper.setAuthCookies(res, {
        token: jwtToken,
        refreshToken,
        user,
      });

      return SuccessResponse(res, statusCode, {
        message: "User found.",
        data: { user },
      });
    } catch (error) {
      return ErrorResponse(res, status.UNAUTHORIZED, {
        message: "Invalid or expired link.",
      });
    }
  };

  // ==================== OAuth ====================

  public getOauthUrl: TAuthController["getOauthUrl"] = async (
    req,
    res,
    next,
  ) => {
    try {
      const { provider } = req.query;
      const authUrl = await authService.generateOAuthUrl({
        provider,
        redirectUri: `${envConfig.FRONTEND_HOST}/callback/${provider.toLowerCase()}`,
      });

      return SuccessResponse(res, status.OK, {
        data: { redirectUrl: authUrl },
      });
    } catch (error) {
      next(error);
    }
  };

  public getEmailFromInviteToken: TAuthController["getEmailFromInviteToken"] =
    async (req, res) => {
      try {
        const { token } = req.params;
        const decoded = jwtHelper.verifyToken(token);
        return SuccessResponse(res, status.OK, {
          message: AUTH_RESPONSE_MESSAGES.EMAIL_RETRIEVED,
          data: decoded.email,
        });
      } catch {
        return ErrorResponse(res, status.CONFLICT, {
          message: AUTH_RESPONSE_MESSAGES.TOKEN_EXPIRED,
        });
      }
    };

  // ==================== MFA handlers ====================

  public initiateMfaSetup = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const user = req.user!;

      const result = await authHelper.initiateMfaSetup({
        userId: user._id.toString(),
        externalUserId: user.externalUserId!,
      });

      cookieHelper.setMfaChallengeId(res, result.challengeId);
      cookieHelper.setMfaFactorId(res, result.factorId);

      return SuccessResponse(res, status.OK, {
        message: "Success.",
        data: { qrCode: result.qrCode, secret: result.secret },
      });
    } catch (error) {
      next(error);
    }
  };

  public verifyMfaSetup = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const { code } = req.body;
      const { mfaChallengeId, mfaFactorId } = req.cookies;

      const user = req.user!;

      const result = await authHelper.verifyMfaSetup({
        code,
        challengeId: mfaChallengeId,
        factorId: mfaFactorId,
        userId: user._id.toString(),
        email: user.email,
        user,
        loginMethod: req.pendingMfa?.loginMethod ?? req.loginMethod,
      });

      if (result.error) {
        return ErrorResponse(res, result.statusCode, {
          message: result.message,
        });
      }

      cookieHelper.setAuthCookies(res, {
        token: result.token,
        refreshToken: result.refreshToken,
        user: result.user,
      });

      cookieHelper.clearMfaCookies(res);

      return SuccessResponse(res, status.OK, {
        message: "Success.",
        data: { user: result.user, recoveryCodes: result.recoveryCodes },
      });
    } catch (error) {
      next(error);
    }
  };

  public skipMfaSetup = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const user = req.user!;

      const { mfaFactorId } = req.cookies;

      const result = await authHelper.skipMfaSetup({
        user,
        mfaFactorId,
        loginMethod: req.pendingMfa?.loginMethod ?? req.loginMethod,
      });

      if (result.error) {
        return ErrorResponse(res, result.statusCode, {
          message: result.message,
        });
      }

      cookieHelper.clearMfaCookies(res);

      cookieHelper.setAuthCookies(res, {
        token: result.token,
        refreshToken: result.refreshToken,
        user: result.user,
      });

      return SuccessResponse(res, status.OK, {
        message: "Success.",
        data: { user: result.user },
      });
    } catch (error) {
      console.log(error);
      next(error);
    }
  };

  // This controller is used for verifying the MFA challenge during login, not for setup verification. The flow is similar to verifyMfaSetup but it does not update the user's mfaEnrolled status.
  public verifyMfa = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const { code } = req.body;
      // Mobile sends the challenge id in the body, web holds it in a cookie.
      const mfaChallengeId = req.isMobile
        ? req.body.mfaChallengeId
        : req.cookies.mfaChallengeId;

      const user = req.user!;

      const result = await authHelper.verifyMfaChallenge({
        email: user.email,
        challengeId: mfaChallengeId,
        userId: user._id.toString(),
        user,
        code,
        boundChallengeId: req.pendingMfa?.challengeId,
        boundFactorId: req.pendingMfa?.factorId,
        loginMethod: req.pendingMfa?.loginMethod ?? req.loginMethod,
      });

      if (result.error) {
        return ErrorResponse(res, result.statusCode, {
          message: result.message,
        });
      }

      if (req.isMobile) {
        return SuccessResponse(res, status.OK, {
          message: "Success.",
          data: {
            user: result.user,
            token: result.token,
            refreshToken: result.refreshToken,
          },
        });
      }

      cookieHelper.clearMfaCookies(res);

      cookieHelper.setAuthCookies(res, {
        token: result.token,
        refreshToken: result.refreshToken,
        user: result.user,
      });

      return SuccessResponse(res, status.OK, {
        message: "Success.",
        data: { user: result.user },
      });
    } catch (error) {
      next(error);
    }
  };

  public recoverMfa = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const user = req.user!;
      const code = req.body.recoveryCode;

      const result = await authHelper.recoverMfa({
        user,
        code,
        loginMethod: req.pendingMfa?.loginMethod ?? req.loginMethod,
      });

      if (result.error || !result.token) {
        return ErrorResponse(res, result.statusCode, {
          message: result.message,
        });
      }

      if (req.isMobile) {
        return SuccessResponse(res, status.OK, {
          message: "Success.",
          data: {
            user: result.user,
            token: result.token,
            refreshToken: result.refreshToken,
          },
        });
      }

      cookieHelper.clearCookies(res, [
        COOKIE_NAME.MFA_CHALLENGE_ID,
        COOKIE_NAME.PENDING_MFA_TOKEN,
      ]);

      cookieHelper.setAuthCookies(res, {
        token: result.token,
        refreshToken: result.refreshToken,
        user: result.user,
      });

      return SuccessResponse(res, status.OK, {
        message: "Success.",
        data: { user: result.user },
      });
    } catch (error) {
      next(error);
    }
  };

  public sendResetMfaEmailOtp = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const user = req.user!;

      await authHelper.resetMfaEmailOtp(user.email);

      return SuccessResponse(res, status.OK, {
        message: "Success.",
        data: { sent: true },
      });
    } catch (error) {
      next(error);
    }
  };

  public verifyResetRequest: TAuthController["verifyResetRequest"] = async (
    req,
    res,
    next,
  ) => {
    try {
      const { code, method } = req.body;
      const user = req.user!;

      const result = await authHelper.verifyResetRequest({
        code,
        method,
        factorId: user!.mfa.factorId!,
        email: user.email,
      });

      if (!result.success) {
        return ErrorResponse(res, result.statusCode, {
          message: result.message,
        });
      }

      return SuccessResponse(res, status.OK, {
        message: "Success.",
        data: { verified: true },
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * Updates the session for the recovery reset flow
   * When user select to re-configure MFA after using Recovery code to login, will update the jwt session expiry time to 15min
   */
  public updateSessionForRecoveryReconfiguration = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const user = req.user!;
      const result = await authHelper.updateSessionForRecoveryResetFlow(
        user,
        req.pendingMfa?.loginMethod ?? req.loginMethod,
      );

      cookieHelper.setAuthCookies(res, {
        token: result.token,
        refreshToken: result.refreshToken,
        user,
      });

      return SuccessResponse(res, status.OK, {
        message: "Success.",
        data: { user },
      });
    } catch (error) {
      next(error);
    }
  };

  public disableMfa = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const user = req.user!;
      await authHelper.disableMfa(user);

      return SuccessResponse(res, status.OK, {
        message: "Success.",
        data: { disabled: true },
      });
    } catch (error) {
      next(error);
    }
  };
}
