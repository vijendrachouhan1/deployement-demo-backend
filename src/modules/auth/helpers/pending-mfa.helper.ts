import envConfig from "@/config/env";
import { JWT_CONFIG, jwtHelper } from "@/helpers/jwt";
import {
  LOGIN_METHOD,
  PENDING_MFA_PURPOSE,
} from "@/modules/auth/utils/auth.enum";
import { TPendingMfaClaims } from "@/modules/auth/utils/auth.types";

export function generatePendingMfaToken({
  userId,
  email,
  purpose,
  challengeId,
  factorId,
  loginMethod,
}: {
  userId: string;
  email: string;
  purpose: PENDING_MFA_PURPOSE;
  challengeId?: string;
  factorId?: string;
  loginMethod?: LOGIN_METHOD;
}): string {
  return jwtHelper.generateToken(
    {
      _id: userId,
      email,
      purpose,
      challengeId,
      factorId,
      loginMethod,
    } satisfies TPendingMfaClaims,
    JWT_CONFIG.PENDING_MFA_TOKEN_EXPIRY,
    envConfig.MFA_JWT_TOKEN_SECRET,
  );
}

/** Returns null for an invalid, expired, or purposeless token. */
export function verifyPendingMfaToken(token: string): TPendingMfaClaims | null {
  try {
    const decoded = jwtHelper.verifyToken(
      token,
      envConfig.MFA_JWT_TOKEN_SECRET,
    );

    const purpose = decoded.purpose as PENDING_MFA_PURPOSE | undefined;

    if (!decoded._id || !purpose) return null;
    if (!Object.values(PENDING_MFA_PURPOSE).includes(purpose)) return null;

    return {
      _id: decoded._id,
      email: decoded.email,
      purpose,
      challengeId: decoded.challengeId as string | undefined,
      factorId: decoded.factorId as string | undefined,
      loginMethod: decoded.loginMethod as LOGIN_METHOD | undefined,
    };
  } catch {
    return null;
  }
}
