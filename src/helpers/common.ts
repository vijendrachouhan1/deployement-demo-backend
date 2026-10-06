import envConfig from "@/config/env";
import { CLIENT_PLATFORM } from "@/constants/common";
import { User } from "@/db/models/user";
import { SERVER_ENV } from "@/enums";
import { Request } from "express";
import mongoose from "mongoose";

const ObjectId = (
  value: string | mongoose.Types.ObjectId,
): mongoose.Types.ObjectId => {
  return new mongoose.Types.ObjectId(value);
};

const generateReferralCode = async () => {
  let referralCode: string = "";

  let isUnique: boolean = false;
  while (!isUnique) {
    referralCode = `${Date.now().toString(36)}${Math.random()
      .toString(36)
      .slice(2, 4)}`;
    const existingCodes = await User.find({ referralCode }).lean();
    if (existingCodes.length === 0) {
      isUnique = true;
    }
  }
  return referralCode.toUpperCase();
};

function isMobileRequest(req: Request): boolean {
  return req.headers[CLIENT_PLATFORM.HEADER] === CLIENT_PLATFORM.VALUES.MOBILE;
}

// Path without the query string — the query can carry tokens/PII that must
// never be persisted (e.g. into audit-log context.path).
function stripQueryString(url?: string): string | undefined {
  return url?.split("?")[0];
}

function isDevEnvironment(): boolean {
  return (
    envConfig.NODE_ENV.startsWith("dev") ||
    envConfig.NODE_ENV === SERVER_ENV.DEVELOPMENT
  );
}
function isStaging(): boolean {
  return envConfig.NODE_ENV === SERVER_ENV.STAGING;
}
function isProduction(): boolean {
  return envConfig.NODE_ENV === SERVER_ENV.PRODUCTION;
}

function validatePhoneNumber(phoneNumber: string): boolean {
  // E.164 format validation: +[country code][number]
  // Must start with + (optional), followed by 1-9, then 1-14 digits
  return /^\+?[1-9]\d{1,14}$/.test(phoneNumber);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export {
  generateReferralCode,
  isDevEnvironment,
  isMobileRequest,
  isProduction,
  isStaging,
  ObjectId,
  sleep,
  stripQueryString,
  validatePhoneNumber,
};
