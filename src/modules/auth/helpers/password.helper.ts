import envConfig from "@/config/env";
import { Company } from "@/db/models/company";
import { User } from "@/db/models/user";
import { jwtHelper } from "@/helpers/jwt";
import {
  buildPasswordTimestamps,
  getPasswordRotationConfig,
} from "@/modules/auth/utils/auth.util";
import type { TUpdatePasswordResult } from "@/modules/auth/utils/auth.types";
import { authService } from "@/providers/auth";
import { AuthProviderError } from "@/providers/auth/utils/auth-provider.error";
import { emailService } from "@/providers/email";
import status from "http-status";

export const sendResetEmail = async (email: string) => {
  const user = await User.findOne({ email });

  if (!user) {
    return {
      success: true,
      status: status.OK,
      message: "Reset email sent successfully",
    }; // Return success even if user not found for security
  }

  if (user.oauth) {
    return {
      success: false,
      message: "User has signed in using social account",
      status: status.BAD_REQUEST,
    };
  }

  const resetUrl = `${envConfig.FRONTEND_HOST}/reset-password?email=${encodeURIComponent(email)}&token=${jwtHelper.generateToken({ email }, "1h")}`;

  await emailService.sendEmail({
    to: email,
    subject: "Reset Password",
    html: `<p>Click <a href='${resetUrl}'>here</a>
            to reset your password</p>`,
  });
  return {
    success: true,
    status: status.OK,
    message: "Reset email sent successfully",
  };
};

export const updatePassword = async (
  email: string,
  password: string,
  token: string,
): Promise<TUpdatePasswordResult> => {
  const decoded = jwtHelper.verifyToken(token);

  if (!decoded || decoded.email !== email) {
    return { success: false, message: "Invalid token or email", status: 401 };
  }

  const existingUser = await User.findOne({ email });

  if (!existingUser) {
    return { success: false, message: "Invalid token or email", status: 401 };
  }

  const company = existingUser.companyRef
    ? await Company.findById(existingUser.companyRef).select(
        "rotatePassword passwordValidityDays passwordGraceDays",
      )
    : null;
  const rotationConfig = getPasswordRotationConfig(company);

  try {
    await authService.updateUser({
      userId: existingUser.externalUserId!,
      password,
    });
  } catch (error) {
    if (error instanceof AuthProviderError) {
      return {
        success: false,
        status: error.status,
        message: error.message,
        messageCode: error.code,
      };
    }
    throw error;
  }

  const updatedUser = await User.findOneAndUpdate(
    { email },
    {
      hasPassword: true,
      ...buildPasswordTimestamps(rotationConfig.passwordValidityDays),
      forcePasswordChange: false,
    },
    { new: true },
  );

  return { success: true, user: updatedUser };
};
