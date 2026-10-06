import {
  REFERRAL_REWARD_TRIGGER,
  REFERRAL_ROLE,
  REWARD_STATUS,
  REWARD_TYPE,
} from "@/modules/referrals/utils/referrals.enum";
import { Schema, Types, model } from "mongoose";

export interface IReferralReward {
  userRef: Types.ObjectId;
  referralRef: Types.ObjectId;
  rewardType: REWARD_TYPE;
  rewardValue: number;
  status: REWARD_STATUS;
  role: REFERRAL_ROLE;
  trigger: REFERRAL_REWARD_TRIGGER;
}

export interface IReferralRewardDocument extends IReferralReward {
  createdAt: Date;
  updatedAt: Date;
}

const ReferralRewardSchema = new Schema<IReferralRewardDocument>(
  {
    userRef: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    referralRef: {
      type: Schema.Types.ObjectId,
      ref: "Referral",
      required: true,
    },
    rewardType: {
      type: String,
      enum: Object.values(REWARD_TYPE),
      required: true,
    },
    rewardValue: {
      type: Number,
      default: 0,
      required: true,
    },
    status: {
      type: String,
      enum: Object.values(REWARD_STATUS),
      default: REWARD_STATUS.PENDING,
    },
    role: {
      type: String,
      enum: Object.values(REFERRAL_ROLE),
      required: true,
    },
    trigger: {
      type: String,
      enum: Object.values(REFERRAL_REWARD_TRIGGER),
      required: true,
    },
  },
  { timestamps: true },
);

export const ReferralReward = model<IReferralRewardDocument>(
  "referral_reward",
  ReferralRewardSchema,
);
