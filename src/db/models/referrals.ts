import mongoose from "mongoose";
import { REFERRAL_TYPE } from "@/enums";
import { REFERRAL_STATUS } from "@/modules/referrals/utils/referrals.enum";

const ObjectId = mongoose.Schema.Types.ObjectId;

export interface IReferrals {
  _id: mongoose.Types.ObjectId;
  referredByRef: mongoose.Types.ObjectId;
  referredToRef: mongoose.Types.ObjectId;
  type: REFERRAL_TYPE;
  status: REFERRAL_STATUS;
}

export interface IReferralsDocument extends IReferrals, mongoose.Document {
  createdAt: Date;
  updatedAt: Date;
}

const ReferralsSchema = new mongoose.Schema<IReferralsDocument>(
  {
    referredByRef: {
      type: ObjectId,
      ref: "User",
      required: true,
    },
    referredToRef: {
      type: ObjectId,
      ref: "User",
    },
    type: {
      type: String,
      enum: Object.values(REFERRAL_TYPE),
      required: false,
    },
    status: {
      type: String,
      enum: Object.values(REFERRAL_STATUS),
      default: REFERRAL_STATUS.PENDING,
    },
  },
  { timestamps: true },
);

export const Referrals = mongoose.model<IReferralsDocument>(
  "Referrals",
  ReferralsSchema,
);
