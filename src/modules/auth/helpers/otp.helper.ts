import { OTP_PURPOSE, OtpVerificationModel } from "@/db/models/otpVerification";
import { User } from "@/db/models/user";
import { USER_TYPE } from "@/enums";
import {
  isDevEnvironment,
  isStaging,
  validatePhoneNumber,
} from "@/helpers/common";
import {
  AUTH_RESPONSE_MESSAGES,
  DEV_FIXED_OTP,
  OTP_CONFIG,
  OTP_EXPIRY_MINUTES,
} from "@/modules/auth/utils/auth.constant";
import { LOGIN_METHOD } from "@/modules/auth/utils/auth.enum";
import {
  TOtpRequestResult,
  TOtpVerifyResult,
} from "@/modules/auth/utils/auth.types";
import { emailService } from "@/providers/email";
import { smsService } from "@/providers/sms";
import { generateAuthTokens } from "@/modules/auth/helpers/token.helper";

// ==================== Utilities ====================

/**
 * Generate a numeric OTP of specified length
 */
export function generateOtp(length: number = OTP_CONFIG.LENGTH): string {
  const min = Math.pow(10, length - 1);
  const max = Math.pow(10, length) - 1;
  return Math.floor(min + Math.random() * (max - min + 1)).toString();
}

/**
 * Calculate OTP expiry date
 */
export function getOtpExpiry(minutes: number = OTP_EXPIRY_MINUTES.LOGIN): Date {
  return new Date(Date.now() + minutes * 60 * 1000);
}

/**
 * Check if OTP has expired
 */
export function isOtpExpired(expiryDate: Date | string): boolean {
  return Date.now() > new Date(expiryDate).getTime();
}

// ==================== Return Types ====================

// ==================== Helpers ====================

/**
 * Resolve the OTP to send. The fixed code is gated on the environment alone
 */
function resolveOtp(): string {
  if (isStaging() || isDevEnvironment()) {
    return DEV_FIXED_OTP;
  }
  return generateOtp(OTP_CONFIG.LENGTH);
}

/**
 * Generate and persist a new OTP in the OtpVerification collection.
 * Deletes any previous pending OTPs for the same identifier + purpose.
 * Returns the plain-text OTP so it can be dispatched before hashing occurs.
 */
async function saveOtp(
  identifier: string,
  purpose: OTP_PURPOSE,
  customOtp?: string,
): Promise<string> {
  const otp = customOtp ?? generateOtp(OTP_CONFIG.LENGTH);

  const expiryMinutes =
    purpose === OTP_PURPOSE.SIGNUP
      ? OTP_EXPIRY_MINUTES.SIGNUP
      : OTP_EXPIRY_MINUTES.LOGIN;
  const expiresAt = getOtpExpiry(expiryMinutes);

  // Remove previous active OTPs for this identity + purpose to keep collection clean
  await OtpVerificationModel.deleteMany({
    identifier: identifier.toLowerCase(),
    purpose,
  });

  // pre-save hook on the model hashes otpCode before writing to DB
  await OtpVerificationModel.create({
    identifier: identifier.toLowerCase(),
    otpCode: otp,
    purpose,
    expiresAt,
  });

  return otp;
}

async function sendOtp(identifier: string, otp: string, isEmail: boolean) {
  if (isEmail) {
    await emailService.sendEmail({
      to: identifier,
      subject: `Verification Otp`,
      html: `Your verification otp is ${otp} `,
    });
  } else {
    await smsService.sendVerificationCode(identifier, otp);
  }
}

/**
 * Handles both email and phone, and all OTP_PURPOSE values.
 */
export async function requestOtp(
  identifier: string,
  purpose: OTP_PURPOSE,
): Promise<TOtpRequestResult> {
  const isEmail = identifier.includes("@");

  if (isEmail) {
    // Email + SIGNUP  → validates user does NOT already exist
    if (purpose === OTP_PURPOSE.SIGNUP) {
      const existingUser = await User.findOne({ email: identifier });
      if (existingUser) {
        return {
          success: false,
          message: AUTH_RESPONSE_MESSAGES.USER_ALREADY_EXISTS_EMAIL,
          statusCode: 409,
        };
      }
    }
  } else {
    if (!validatePhoneNumber(identifier)) {
      return {
        success: false,
        message: AUTH_RESPONSE_MESSAGES.INVALID_PHONE_FORMAT,
        statusCode: 422,
      };
    }
    // Phone + LOGIN   → auto-creates a minimal user if none found
    if (purpose === OTP_PURPOSE.LOGIN || purpose === OTP_PURPOSE.VERIFICATION) {
      const existingUser = await User.findOne({ phone: identifier });
      if (!existingUser) {
        await User.create({ phone: identifier, roles: USER_TYPE.USER });
      }
    }
  }

  const otp = await saveOtp(identifier, purpose, resolveOtp());

  await sendOtp(identifier, otp, isEmail);

  return { success: true, message: AUTH_RESPONSE_MESSAGES.OTP_SENT };
}

/**
 * Identical flow to requestOtp (saveOtp removes the old one and creates fresh).
 */
export async function resendOtp(
  identifier: string,
  purpose: OTP_PURPOSE,
): Promise<TOtpRequestResult> {
  return requestOtp(identifier, purpose);
}

/**
 * Verifies the raw OTP against the stored hash, enforces attempt limits and expiry,
 * marks the OTP as used on success, and returns an auth token where applicable.
 */
export async function verifyOtp(
  identifier: string,
  purpose: OTP_PURPOSE,
  rawOtp: string,
  returnToken: boolean = true,
): Promise<TOtpVerifyResult> {
  const isEmail = identifier.includes("@");

  const otpRecord = await OtpVerificationModel.findOne({
    identifier: identifier.toLowerCase(),
    purpose,
  }).sort({ createdAt: -1 });

  if (!otpRecord || otpRecord.isUsed) {
    return {
      success: false,
      message: AUTH_RESPONSE_MESSAGES.INVALID_OR_EXPIRED_OTP,
      statusCode: 401,
    };
  }

  if (isOtpExpired(otpRecord.expiresAt)) {
    return {
      success: false,
      message: AUTH_RESPONSE_MESSAGES.INVALID_OR_EXPIRED_OTP,
      statusCode: 401,
    };
  }

  if (otpRecord.attempts >= otpRecord.maxAttempts) {
    return {
      success: false,
      message: AUTH_RESPONSE_MESSAGES.OTP_MAX_ATTEMPTS,
      statusCode: 401,
    };
  }

  // Increment attempts before verifying to prevent brute force on valid hash
  otpRecord.attempts += 1;
  await otpRecord.save();

  const isValid = otpRecord.verifyOtp(rawOtp);

  if (!isValid) {
    return {
      success: false,
      message: AUTH_RESPONSE_MESSAGES.INCORRECT_OTP,
      statusCode: 401,
    };
  }

  // Consume the OTP
  otpRecord.isUsed = true;
  otpRecord.verifiedAt = new Date();
  await otpRecord.save();

  // Email signup: OTP confirmed — caller completes registration separately
  if ((isEmail && purpose === OTP_PURPOSE.SIGNUP) || !returnToken) {
    return {
      success: true,
      message: AUTH_RESPONSE_MESSAGES.OTP_VERIFIED,
      email: identifier,
    };
  }

  // All other flows: look up the user and issue a JWT
  const user = await User.findOne(
    isEmail ? { email: identifier } : { phone: identifier },
  );

  if (!user) {
    return {
      success: false,
      message: AUTH_RESPONSE_MESSAGES.USER_NOT_FOUND_OTP,
      statusCode: 404,
    };
  }

  // A second factor belongs to the password flow only. The OTP already proves
  // control of a channel the account owns, so an enrolled user is not challenged
  // again here and the frontend has no MFA step on this path.
  const { token, refreshToken, permissions } = await generateAuthTokens({
    user,
    loginMethod: LOGIN_METHOD.OTP,
  });

  return {
    success: true,
    message: AUTH_RESPONSE_MESSAGES.OTP_VERIFIED,
    token,
    refreshToken,
    user: { ...user.toObject(), permissions },
  };
}
