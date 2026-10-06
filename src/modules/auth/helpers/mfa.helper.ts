import status from "http-status";

import { OTP_PURPOSE, OtpVerificationModel } from "@/db/models/otpVerification";
import { RecoveryCodeModel, hashRecoveryCode } from "@/db/models/recoveryCodes";
import { IUser, User } from "@/db/models/user";
import { ObjectId } from "@/helpers/common";
import {
  generateOtp,
  getOtpExpiry,
  verifyOtp,
} from "@/modules/auth/helpers/otp.helper";
import { generateAuthTokens } from "@/modules/auth/helpers/token.helper";
import { OTP_EXPIRY_MINUTES } from "@/modules/auth/utils/auth.constant";
import {
  LOGIN_METHOD,
  MFA_RESET_IDENTITY_METHOD,
} from "@/modules/auth/utils/auth.enum";
import {
  TSkipMfaResponse,
  TVerifyMfaChallengeParams,
  TVerifyMfaChallengeResponse,
  TVerifyMfaSetupParams,
  TVerifyMfaSetupResponse,
  TVerifyResetRequestParams,
  TVerifyResetResult,
} from "@/modules/auth/utils/auth.types";
import { generateRecoveryCodes } from "@/modules/auth/utils/auth.util";
import { workos } from "@/providers/auth/authkit.provider";
import { emailService } from "@/providers/email";

export async function initiateMfaSetup({
  userId,
  externalUserId,
}: {
  userId: string;
  externalUserId: string;
}) {
  const { authenticationFactor, authenticationChallenge } =
    await workos.userManagement.enrollAuthFactor({
      userId: externalUserId,
      type: "totp",
      totpIssuer: "Byldd BP",
    });

  await User.findByIdAndUpdate(ObjectId(userId), {
    $addToSet: { "mfa.factorIds": authenticationFactor.id },
  }).exec();

  return {
    qrCode: authenticationFactor.totp?.qrCode,
    uri: authenticationFactor.totp?.uri,
    secret: authenticationFactor.totp?.secret,
    challengeId: authenticationChallenge.id,
    factorId: authenticationFactor.id,
  };
}

export async function createMfaChallenge(factorId: string) {
  return workos.mfa.challengeFactor({
    authenticationFactorId: factorId,
  });
}

export async function verifyMfaSetup({
  userId,
  challengeId,
  code,
  factorId,
  user,
  loginMethod,
}: TVerifyMfaSetupParams): Promise<TVerifyMfaSetupResponse> {
  if (!factorId || !user?.mfa.factorIds?.includes(factorId)) {
    return {
      message: "Invalid code or challenge expired.",
      statusCode: status.BAD_REQUEST,
      error: true,
    };
  }

  const data = await workos.mfa.verifyChallenge({
    authenticationChallengeId: challengeId,
    code,
  });

  if (!data.valid) {
    return {
      message: "Invalid code or challenge expired.",
      statusCode: status.BAD_REQUEST,
      error: true,
    };
  }

  const remainingFactorIds: string[] = [];

  if (user?.mfa.factorIds?.length) {
    const factorIdsToRemove = user.mfa.factorIds.filter(
      (id) => id !== factorId,
    );

    const result = await Promise.allSettled(
      factorIdsToRemove.map((id) => workos.mfa.deleteFactor(id)),
    );

    result.forEach((res, index) => {
      if (res.status === "rejected") {
        remainingFactorIds.push(factorIdsToRemove[index]);
      }
    });
  }

  const updatedUser = await User.findByIdAndUpdate(
    ObjectId(userId),
    {
      $set: {
        "mfa.enrolled": true,
        "mfa.enabled": true,
        "mfa.factorId": factorId,
        "mfa.factorIds": [...remainingFactorIds, factorId],
      },
    },
    { new: true },
  ).exec();

  if (!updatedUser) {
    return {
      message: "User not found.",
      statusCode: status.NOT_FOUND,
      error: true,
    };
  }

  const { token, refreshToken, permissions } = await generateAuthTokens({
    user: updatedUser,
    loginMethod,
  });

  // Delete existing recovery codes
  await RecoveryCodeModel.deleteMany({ userRef: ObjectId(userId) });

  const recoveryCodes = generateRecoveryCodes();

  await RecoveryCodeModel.insertMany(
    recoveryCodes.map((code) => ({
      code: hashRecoveryCode(code),
      used: false,
      userRef: ObjectId(userId),
    })),
  );

  return {
    user: { ...updatedUser.toObject(), permissions },
    token,
    refreshToken,
    statusCode: status.OK,
    recoveryCodes,
    error: false,
    message: "Success",
  };
}

export async function verifyMfaChallenge({
  challengeId,
  code,
  user,
  boundChallengeId,
  boundFactorId,
  loginMethod,
}: TVerifyMfaChallengeParams): Promise<TVerifyMfaChallengeResponse> {
  if (!user) {
    return {
      message: "User not found.",
      statusCode: status.NOT_FOUND,
      error: true,
    };
  }

  // Without this the provider only proves the code matches *some* challenge, so
  // a challenge raised on another account would complete this login. Absent
  // claims mean a token minted before binding existed: fail closed and make the
  // user log in again rather than accept an unbound proof.
  const isChallengeBound =
    Boolean(boundChallengeId) &&
    challengeId === boundChallengeId &&
    Boolean(boundFactorId) &&
    Boolean(user.mfa?.factorIds?.includes(boundFactorId!));

  if (!isChallengeBound) {
    return {
      message: "Invalid code or challenge expired.",
      statusCode: status.BAD_REQUEST,
      error: true,
    };
  }

  const data = await workos.mfa.verifyChallenge({
    authenticationChallengeId: challengeId,
    code,
  });

  if (!data.valid) {
    return {
      message: "Invalid code or challenge expired.",
      statusCode: status.BAD_REQUEST,
      error: true,
    };
  }

  const { token, refreshToken, permissions } = await generateAuthTokens({
    user,
    loginMethod,
  });

  return {
    user: { ...user, permissions },
    token,
    refreshToken,
    statusCode: status.OK,
    error: false,
    message: "Success",
  };
}

export async function resetMfaEmailOtp(email: string) {
  const otp = generateOtp(6);
  const identifier = email.toLowerCase();

  await OtpVerificationModel.deleteMany({
    identifier,
    purpose: OTP_PURPOSE.MFA_RESET,
  });

  await OtpVerificationModel.create({
    identifier,
    otpCode: otp,
    purpose: OTP_PURPOSE.MFA_RESET,
    expiresAt: getOtpExpiry(OTP_EXPIRY_MINUTES.MFA_RESET),
  });

  return emailService.sendEmail({
    to: email,
    subject: "Reset MFA",
    text: `Your One-Time Password (OTP) for resetting MFA is: ${otp}. This OTP will expire in ${OTP_EXPIRY_MINUTES.MFA_RESET} minutes.`,
  });
}

export async function verifyResetRequest(
  data: TVerifyResetRequestParams,
): Promise<TVerifyResetResult> {
  if (data.method === MFA_RESET_IDENTITY_METHOD.AUTHENTICATOR) {
    if (!data.factorId) {
      return {
        success: false,
        message: "No authenticator is enrolled on this account.",
        statusCode: status.BAD_REQUEST,
      };
    }

    const challenge = await workos.mfa.challengeFactor({
      authenticationFactorId: data.factorId,
    });

    const verification = await workos.mfa.verifyChallenge({
      authenticationChallengeId: challenge.id,
      code: data.code,
    });

    if (!verification.valid) {
      return {
        success: false,
        message: "Invalid code or challenge expired.",
        statusCode: status.BAD_REQUEST,
      };
    }

    return { success: true };
  }

  // Trailing `false` is returnToken: this flow already has an authenticated session
  // and must not mint a new one.
  const result = await verifyOtp(
    data.email,
    OTP_PURPOSE.MFA_RESET,
    data.code,
    false,
  );

  if (!result.success) {
    return {
      success: false,
      message: result.message,
      statusCode:
        result.statusCode === status.UNAUTHORIZED
          ? status.BAD_REQUEST
          : result.statusCode,
    };
  }

  return { success: true };
}

export async function updateSessionForRecovery(
  user: IUser,
  loginMethod?: LOGIN_METHOD,
) {
  const { token, refreshToken } = await generateAuthTokens(
    { user, loginMethod },
    {
      exp: "15min",
    },
  );

  return { token, refreshToken };
}

export async function recoverMfa({
  user,
  code,
  loginMethod,
}: {
  user: IUser;
  code: string;
  loginMethod?: LOGIN_METHOD;
}) {
  const recoveryCode = await RecoveryCodeModel.findOneAndUpdate(
    {
      userRef: user._id,
      code: hashRecoveryCode(code),
      used: false,
    },
    {
      used: true,
      usedAt: new Date(),
    },
    { new: true },
  ).exec();

  if (!recoveryCode) {
    return {
      error: true,
      message: "Invalid or already used recovery code",
      statusCode: status.BAD_REQUEST,
    };
  }

  const { token, refreshToken, permissions } = await generateAuthTokens({
    user,
    loginMethod,
  });

  return {
    user: { ...user, permissions },
    token,
    refreshToken,
    statusCode: status.OK,
    error: false,
    message: "Success",
  };
}

export async function skipMfaSetup({
  user,
  mfaFactorId,
  loginMethod,
}: {
  user: IUser;
  mfaFactorId: string;
  loginMethod?: LOGIN_METHOD;
}): Promise<TSkipMfaResponse> {
  await workos.mfa.deleteFactor(mfaFactorId).catch(() => {});

  const updatedUser = await User.findByIdAndUpdate(
    user._id,
    {
      $set: {
        "mfa.enrolled": false,
        "mfa.factorIds": user.mfa?.factorIds?.filter(
          (id) => id !== mfaFactorId,
        ),
      },
    },
    { new: true },
  ).exec();

  if (!updatedUser) {
    return {
      message: "User not found.",
      statusCode: status.NOT_FOUND,
      error: true,
    };
  }

  const { token, refreshToken, permissions } = await generateAuthTokens({
    user: updatedUser,
    loginMethod,
  });

  return {
    token,
    refreshToken,
    user: { ...updatedUser.toObject(), permissions },
    statusCode: status.OK,
    error: false,
    message: "Success",
  };
}

export async function disableMfa(user: IUser) {
  // 1. delete all factors

  const mfaData = user.mfa;

  if (mfaData?.factorIds?.length) {
    await Promise.allSettled(
      mfaData.factorIds.map((id) => workos.mfa.deleteFactor(id)),
    );
  }

  // 2. update user
  const updatedUser = await User.findByIdAndUpdate(
    user._id,
    {
      $set: {
        "mfa.enrolled": false,
        "mfa.enabled": false,
        "mfa.factorIds": [],
        "mfa.factorId": null,
      },
    },
    { new: true },
  ).exec();

  // 3. Invalidated all recovery codes

  await RecoveryCodeModel.deleteMany({
    userRef: user._id,
  });

  return updatedUser;
}
