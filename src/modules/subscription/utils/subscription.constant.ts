import { STATUS } from "@/enums";

export const SUBSCRIPTION_MESSAGES = {
  FETCHED_SUCCESS: "Subscription plans fetched successfully.",
  FETCHED_ONE_SUCCESS: "Subscription plan fetched successfully.",
  USER_PLANS_SUCCESS: "User plans fetched successfully.",
  CUSTOMER_CREATED: "Stripe customer created successfully.",
  SUBSCRIPTION_CREATED: "Subscription created successfully.",
  SUBSCRIPTION_CANCELLED: "Subscription cancelled successfully.",
  SUBSCRIPTION_NOT_FOUND: "Subscription not found.",
  NO_COMPANY: "No company is associated with this account.",
  CANCEL_FAILED: "Failed to cancel subscription",
  SUBSCRIPTION_CHANGED: "Subscription changed successfully.",
  UPGRADED_FROM_FREE: "Successfully upgraded from free plan.",
  ALREADY_SUBSCRIBED: "You are already subscribed to this plan!",
  USERS_FETCHED_SUCCESS: "Subscribed users fetched successfully.",
  SUBSCRIPTION_NOT_CHANGEABLE:
    "This subscription cannot be changed right now. Please contact support.",
  CANCELLATION_PENDING:
    "Your subscription is scheduled to end at the close of the current billing period. You can choose a new plan once it ends.",
} as const;

// A row Stripe has ended is kept for history, not read as the current plan.
export const LIVE_SUBSCRIPTION_STATUSES = [
  STATUS.ACTIVE,
  STATUS.PAST_DUE,
] as const;

// Stripe's own vocabulary, not the local STATUS enum: a subscription awaiting
// its first payment. Stripe expires these on its own after ~23h.
export const STRIPE_INCOMPLETE_SUBSCRIPTION_STATUS = "incomplete";
