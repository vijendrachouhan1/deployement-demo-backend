import { TEST_WEBHOOK_SECRETS } from "@/tests/mocks/stripe.mock";
import type { TStripeWebhookPath } from "@/tests/utils/stripe-webhook";

export const WEBHOOK_PATHS: TStripeWebhookPath[] = [
  "/webhook/subscription",
  "/webhook/stripe-payment",
  "/webhook/stripe-connect",
];

/** Each endpoint paired with a secret that belongs to a DIFFERENT endpoint. */
export const FOREIGN_SECRET_FOR: Record<TStripeWebhookPath, string> = {
  "/webhook/subscription": TEST_WEBHOOK_SECRETS.PAYMENT,
  "/webhook/stripe-payment": TEST_WEBHOOK_SECRETS.CONNECT,
  "/webhook/stripe-connect": TEST_WEBHOOK_SECRETS.SUBSCRIPTION,
};
