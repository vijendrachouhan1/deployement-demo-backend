import mongoose from "mongoose";
import { STATUS } from "@/enums";
import { auditPlugin } from "@/db/plugins/audit/audit.plugin";

const ObjectId = mongoose.Schema.Types.ObjectId;

export interface ISubscription {
  _id: mongoose.Types.ObjectId;
  userRef: mongoose.Types.ObjectId;
  planId?: string;
  planName?: string;
  price: number;
  currentPeriodStarts: number;
  currentPeriodEnds: number;
  period?: string;
  stripeSubscriptionId?: string;
  subscriptionCancellationRequested?: boolean;
  stripeCustomerId?: string;
  productId?: string;
  status: STATUS;
  companyRef: mongoose.Types.ObjectId;
  subscriptionActiveUntil?: number;
}

export interface ISubscriptionDocument
  extends ISubscription, mongoose.Document {
  createdAt: Date;
  updatedAt: Date;
}

const SubscriptionSchema = new mongoose.Schema<ISubscriptionDocument>(
  {
    userRef: {
      type: ObjectId,
      ref: "User",
      required: true,
    },
    planId: {
      type: String, // stripe susbscription plan id
      required: false,
    },
    planName: {
      type: String,
      required: false,
    },
    price: {
      type: Number, // stripe susbscription price
      required: true,
    },
    currentPeriodStarts: {
      type: Number,
      required: true,
    },
    currentPeriodEnds: {
      type: Number,
      required: true,
    },
    // TODO: need to add a description explaining what this does.
    period: {
      type: String,
      required: false,
    },
    stripeSubscriptionId: {
      type: String, // stripe susbscription purchase id
      required: false,
    },
    subscriptionCancellationRequested: {
      type: Boolean,
      default: false,
    },
    stripeCustomerId: {
      type: String,
    },
    productId: {
      type: String,
      required: false,
    },
    status: {
      type: String,
      enum: Object.values(STATUS),
      required: true,
      default: STATUS.ACTIVE,
    },
    companyRef: {
      type: ObjectId,
      required: true,
      ref: "Company",
    },
    subscriptionActiveUntil: {
      type: Number,
      default: 1578883746, // Use 1578883746 for 13th Jan 2020 & use 1607827746 for dec 2020
      set: (d: number) => {
        return d * 1000;
      },
    },
  },
  { timestamps: true },
);

SubscriptionSchema.virtual("isPaidUser").get(function (): boolean {
  const dateDifference = (this.subscriptionActiveUntil ?? 0) - Date.now();
  return dateDifference / 1000 / 60 / 60 / 24 > 0 ? true : false;
});

SubscriptionSchema.plugin(auditPlugin, {
  model: "subscription",
  labelField: "planName",
});

export const Subscription = mongoose.model<ISubscriptionDocument>(
  "Subscription",
  SubscriptionSchema,
);
