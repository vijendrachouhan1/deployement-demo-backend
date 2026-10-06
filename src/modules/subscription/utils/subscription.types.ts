import { subscriptionValidators } from "@/modules/subscription/utils/subscription.validation";
import { TObjectId } from "@/types";

export type TSubscriptionController = typeof subscriptionValidators;

// Interfaces

export interface IUserPlanResponse {
  planName?: string;
  price?: number;
  description: string;
  period?: string;
  features: any;
  planId?: string;
  stripeSubscriptionId?: string;
  billingCycle?: Date | number;
  subscriptionCancellationRequested?: boolean;
}

export interface ISubscription {
  userRef?: TObjectId;
  planId?: string;
  planName?: string;
  price?: number;
  currentPeriodStarts?: number;
  currentPeriodEnds?: number;
  stripeSubscriptionId?: string;
  subscriptionCancellationRequested?: boolean;
  stripeCustomerId?: string;
  productId?: string;
  status?: string;
  companyRef?: TObjectId;
  subscriptionActiveUntil?: number;
}
