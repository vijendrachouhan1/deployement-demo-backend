import { STRIPE_SUBSCRIPTION_STATUS } from "@/modules/subscription/utils/subscription.enum";

/**
 * Stripe's subscription status vocabulary projected onto the four states the
 * local schema accepts. `trialing` counts as ACTIVE because access is granted;
 * everything that is not currently paying-and-entitled collapses to INACTIVE,
 * with PAST_DUE kept distinct because dunning is still in flight.
 */
const LOCAL_STATUS_FOR: Record<string, STRIPE_SUBSCRIPTION_STATUS> = {
  active: STRIPE_SUBSCRIPTION_STATUS.ACTIVE,
  trialing: STRIPE_SUBSCRIPTION_STATUS.ACTIVE,
  past_due: STRIPE_SUBSCRIPTION_STATUS.PAST_DUE,
  unpaid: STRIPE_SUBSCRIPTION_STATUS.INACTIVE,
  canceled: STRIPE_SUBSCRIPTION_STATUS.INACTIVE,
  incomplete: STRIPE_SUBSCRIPTION_STATUS.INACTIVE,
  incomplete_expired: STRIPE_SUBSCRIPTION_STATUS.INACTIVE,
  paused: STRIPE_SUBSCRIPTION_STATUS.INACTIVE,
};

export function mapStripeSubscriptionStatus(
  stripeStatus: unknown,
): STRIPE_SUBSCRIPTION_STATUS | null {
  if (typeof stripeStatus !== "string") return null;
  return LOCAL_STATUS_FOR[stripeStatus] ?? null;
}
