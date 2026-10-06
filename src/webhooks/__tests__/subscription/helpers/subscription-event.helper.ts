import { USER_TYPE } from "@/enums";
import {
  createCompanylessSession,
  createTestSession,
} from "@/tests/utils/auth";
import {
  DeepPartial,
  stripeEvent,
  stripeSubscriptionWithInvoice,
  TStripeObject,
} from "@/tests/utils/stripe-samples";

export const WEBHOOK_CUSTOMER_ID = "cus_test_default";

/**
 * The handler resolves the local user by the event's customer id. Without a
 * user carrying that same stripeCustomerId, every event is a silent no-op and
 * the test passes for the wrong reason.
 */
export function createWebhookUser(stripeCustomerId = WEBHOOK_CUSTOMER_ID) {
  return createTestSession(USER_TYPE.ADMIN, { stripeCustomerId });
}

/**
 * The same webhook principal, belonging to no company. Stripe still resolves
 * it by customer id, so every event reaches the handler exactly as it would
 * for a normal user — only the company write has nothing to aim at.
 */
export function createCompanylessWebhookUser(
  stripeCustomerId = WEBHOOK_CUSTOMER_ID,
) {
  return createCompanylessSession(USER_TYPE.ADMIN, { stripeCustomerId });
}

/** customer.subscription.updated carrying an arbitrary Stripe status. */
export function subscriptionUpdatedEvent(
  overrides?: DeepPartial<TStripeObject>,
  previousAttributes: TStripeObject | null = null,
) {
  return stripeEvent(
    "customer.subscription.updated",
    stripeSubscriptionWithInvoice("pi_succeeded", overrides),
    { data: { previous_attributes: previousAttributes } },
  );
}

export function subscriptionDeletedEvent(
  overrides?: DeepPartial<TStripeObject>,
) {
  return stripeEvent(
    "customer.subscription.deleted",
    stripeSubscriptionWithInvoice("pi_succeeded", overrides),
  );
}
