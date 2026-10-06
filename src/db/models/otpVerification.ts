import envConfig from "@/config/env";
import mongoose, { Schema, type CallbackError } from "mongoose";
import { createHmac, timingSafeEqual } from "node:crypto";

function hashOtp(raw: string): string {
  return createHmac("sha256", envConfig.OTP_HASH_SECRET)
    .update(raw)
    .digest("hex");
}

function verifyOtpHash(raw: string, hashed: string): boolean {
  const rawHashed = Buffer.from(hashOtp(raw));
  const storedHashed = Buffer.from(hashed);
  if (rawHashed.length !== storedHashed.length) return false;
  return timingSafeEqual(rawHashed, storedHashed);
}

export enum OTP_PURPOSE {
  LOGIN = "LOGIN",
  SIGNUP = "SIGNUP",
  VERIFICATION = "VERIFICATION",
  PASSWORD_RESET = "PASSWORD_RESET",
  MFA_RESET = "MFA_RESET",
}

export interface IOtpVerification {
  identifier: string; // email or phone number
  otpCode: string; // hashed OTP
  purpose: OTP_PURPOSE;
  attempts: number;
  maxAttempts: number;
  expiresAt: Date;
  isUsed: boolean;
  verifiedAt?: Date;
}

export interface IOtpVerificationDocument extends IOtpVerification {
  createdAt: Date;
  updatedAt: Date;
  verifyOtp(rawOtp: string): boolean;
}

const OtpVerificationSchema = new Schema<IOtpVerificationDocument>(
  {
    identifier: {
      type: String,
      required: true,
      lowercase: true,
      index: true,
    },
    otpCode: {
      type: String,
      required: true,
    },
    purpose: {
      type: String,
      enum: Object.values(OTP_PURPOSE),
      required: true,
      index: true,
    },
    attempts: {
      type: Number,
      default: 0,
    },
    maxAttempts: {
      type: Number,
      default: 3,
    },
    expiresAt: {
      type: Date,
      required: true,
    },
    isUsed: {
      type: Boolean,
      default: false,
    },
    verifiedAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
  },
);

// Compound index to quickly find the latest active OTP for an identifier and purpose
OtpVerificationSchema.index({ identifier: 1, purpose: 1, createdAt: -1 });

// Auto-delete expired OTPs
OtpVerificationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Pre-save hook to hash the OTP code
OtpVerificationSchema.pre("save", function (next) {
  if (!this.isModified("otpCode")) {
    return next();
  }
  try {
    this.otpCode = hashOtp(this.otpCode);
    next();
  } catch (error) {
    next(error as CallbackError);
  }
});

// Method to verify raw OTP against the hashed one
OtpVerificationSchema.methods.verifyOtp = function (rawOtp: string): boolean {
  return verifyOtpHash(rawOtp, this.otpCode);
};

export const OtpVerificationModel = mongoose.model<IOtpVerificationDocument>(
  "OtpVerification",
  OtpVerificationSchema,
);
