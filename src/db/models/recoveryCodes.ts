import envConfig from "@/config/env";
import mongoose, { Schema } from "mongoose";
import { createHmac, timingSafeEqual } from "node:crypto";

export function hashRecoveryCode(raw: string): string {
  return createHmac("sha256", envConfig.OTP_HASH_SECRET)
    .update(raw)
    .digest("hex");
}

function verifyRecoveryCode(raw: string, hashed: string): boolean {
  const rawHashed = Buffer.from(hashRecoveryCode(raw));
  const storedHashed = Buffer.from(hashed);
  if (rawHashed.length !== storedHashed.length) return false;
  return timingSafeEqual(rawHashed, storedHashed);
}

interface IRecoveryCode {
  _id: string;
  code: string;
  used: boolean;
  usedAt?: Date;
  userRef: mongoose.Types.ObjectId;
}

export interface IRecoveryCodeDocument extends IRecoveryCode {
  createdAt: Date;
  updatedAt: Date;
  verifyCode(raw: string): boolean;
}

const RecoveryCodeSchema = new Schema<IRecoveryCodeDocument>(
  {
    code: {
      type: String,
      required: true,
    },
    used: {
      type: Boolean,
      default: false,
    },
    usedAt: {
      type: Date,
      required: false,
    },
    userRef: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  { timestamps: true },
);

RecoveryCodeSchema.methods.verifyCode = function (raw: string): boolean {
  return verifyRecoveryCode(raw, this.code);
};

export const RecoveryCodeModel = mongoose.model<IRecoveryCodeDocument>(
  "RecoveryCodes",
  RecoveryCodeSchema,
);
