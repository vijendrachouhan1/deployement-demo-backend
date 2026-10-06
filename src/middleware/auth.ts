import { AuditContext } from "@/db/plugins/audit/audit-context";
import { ICompany } from "@/db/models/company";
import { User } from "@/db/models/user";
import { PENDING_MFA_TOKEN_HEADER } from "@/constants/common";
import { COOKIE_NAME, STATUS, USER_TYPE } from "@/enums";
import { ErrorResponse } from "@/helpers/api-response";
import { ObjectId } from "@/helpers/common";
import { cookieHelper } from "@/helpers/cookie";
import { jwtHelper } from "@/helpers/jwt";
import { verifyPendingMfaToken } from "@/modules/auth/helpers/pending-mfa.helper";
import {
  LOGIN_METHOD,
  PENDING_MFA_PURPOSE,
} from "@/modules/auth/utils/auth.enum";
import { evaluatePasswordRotationState } from "@/modules/auth/utils/auth.util";
import { NextFunction, Request, Response } from "express";
import httpStatus from "http-status";

function skipRefreshRoutes(req: Request) {
  const ignoredPaths = ["/auth/refresh-token", "/auth/logout"];
  return ignoredPaths.some((p) => req.path.includes(p));
}

function isAllowedPathForPasswordRotation(req: Request) {
  const allowedPaths = [
    "/change-password",
    "/logout",
    "/support",
    "/unread-count",
    "/user/me",
  ];
  return allowedPaths.some((p) => req.path.includes(p));
}

export class Middleware {
  public authMiddleware = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      if (!this.hasValidToken(req) || !req.user) {
        return this.sendForbiddenAccessResponse(res);
      }
      next();
    } catch {
      return this.sendForbiddenAccessResponse(res);
    }
  };

  public jwtDecoder = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      let token: string | null = null;

      // Extract token based on client platform
      if (req.isMobile) {
        // For mobile: get token from Authorization header
        token = this.extractBearerToken(req);
      } else {
        // For web: get token from cookies
        token = req.cookies && req.cookies.token;
      }

      if (!token || skipRefreshRoutes(req)) {
        return next();
      }

      const decoded = jwtHelper.verifyToken(token);

      const user = await User.findOne({
        $and: [{ _id: ObjectId(decoded._id) }],
      })
        .populate<{ companyRef: ICompany }>("companyRef")
        .lean();

      if (!user) {
        return this.sendForbiddenAccessResponse(res);
      }

      const companyId = user.companyRef?._id.toString();

      if (user.roles !== USER_TYPE.SUPER_ADMIN && companyId !== decoded.orgId) {
        return this.sendForbiddenAccessResponse(res);
      }

      const reqUser = {
        ...user,
        company: user.companyRef,
        companyRef: user.companyRef?._id,
        permissions: decoded.permissions,
      };

      if (
        user.status === STATUS.INACTIVE ||
        reqUser?.company?.companyStatus === STATUS.INACTIVE
      ) {
        // For web: clear cookie
        if (!req.isMobile) {
          cookieHelper.clearAuthCookies(res);
        }

        return ErrorResponse(res, httpStatus.UNAUTHORIZED, {
          message: "Invalid Token",
        });
      }

      req.user = reqUser;
      req.loginMethod = decoded.loginMethod;

      const context = AuditContext.get();
      context.userId = reqUser._id.toString();
      const derivedName = [reqUser.name?.first, reqUser.name?.last]
        .filter(Boolean)
        .join(" ")
        .trim();
      context.principal = {
        _id: reqUser._id,
        companyRef: reqUser.companyRef ?? null,
        role: reqUser.roles as unknown as USER_TYPE,
        email: reqUser.email ?? null,
        name: derivedName || reqUser.email || null,
      };

      const rotationState = evaluatePasswordRotationState({
        user: reqUser,
        company: reqUser.company || null,
      });

      if (
        rotationState.isBlocked &&
        !isAllowedPathForPasswordRotation(req) &&
        decoded.loginMethod === LOGIN_METHOD.PASSWORD
      ) {
        return ErrorResponse(res, httpStatus.FORBIDDEN, {
          message: "Password Expired. Please reset your password.",
          messageCode: rotationState.errorCode,
        });
      }
      next();
    } catch (error) {
      if (skipRefreshRoutes(req)) return next();

      return ErrorResponse(res, httpStatus.UNAUTHORIZED, {
        message: "Invalid Token",
      });
    }
  };

  public superAdminMiddleware = (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    if (!req.user || req.user.roles !== USER_TYPE.SUPER_ADMIN) {
      return this.sendForbiddenAccessResponse(res);
    }
    next();
  };

  public adminMiddleware = (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    if (
      !req.user ||
      (req.user.roles !== USER_TYPE.ADMIN &&
        req.user.roles !== USER_TYPE.SUPER_ADMIN)
    ) {
      return this.sendForbiddenAccessResponse(res);
    }
    next();
  };

  public systemMiddleware = (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    if (!req.user || req.user.roles !== USER_TYPE.SYSTEM) {
      return this.sendForbiddenAccessResponse(res);
    }
    next();
  };

  /**
   * Guards the /auth/mfa routes. A logged-in user passes on their session.
   * Anyone else must present a pending-MFA token issued for one of
   * `allowedPurposes`; pass an empty list to require a session.
   */
  public pendingMfaMiddleware = (allowedPurposes: PENDING_MFA_PURPOSE[]) => {
    return async (req: Request, res: Response, next: NextFunction) => {
      try {
        if (req.user) {
          return next();
        }

        const token = this.extractPendingMfaToken(req);
        const decoded = token ? verifyPendingMfaToken(token) : null;

        if (!decoded || !allowedPurposes.includes(decoded.purpose)) {
          return this.sendInvalidMfaTokenResponse(res);
        }

        const user = await User.findById(decoded._id).lean();

        if (!user) {
          return this.sendInvalidMfaTokenResponse(res);
        }

        req.user = user;
        req.pendingMfa = decoded;
        next();
      } catch {
        cookieHelper.clearCookies(res, [COOKIE_NAME.PENDING_MFA_TOKEN]);
        return this.sendInvalidMfaTokenResponse(res);
      }
    };
  };

  private extractBearerToken(req: Request): string | null {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      return authHeader.split(" ")[1];
    }
    return null;
  }

  private extractPendingMfaToken(req: Request): string | null {
    if (req.isMobile) {
      return (req.headers[PENDING_MFA_TOKEN_HEADER] as string) || null;
    }
    return req.cookies?.[COOKIE_NAME.PENDING_MFA_TOKEN] || null;
  }

  private hasValidToken(req: Request): boolean {
    if (req.isMobile) {
      return !!this.extractBearerToken(req);
    } else {
      return !!(req.cookies && req.cookies.token);
    }
  }

  private sendForbiddenAccessResponse(res: Response) {
    return ErrorResponse(res, httpStatus.UNAUTHORIZED, {
      message: "Forbidden Access",
    });
  }

  private sendInvalidMfaTokenResponse(res: Response) {
    return ErrorResponse(res, httpStatus.UNAUTHORIZED, {
      message: "Invalid mfa token",
    });
  }
}
