import { stripeEvent } from "@/tests/utils/stripe-samples";

/** Cents, as Stripe sends amount_total. The handler divides by 100. */
export const AMOUNT_TOTAL_IN_CENTS = 5000;
export const AMOUNT_TOTAL_IN_DOLLARS = 50;

export interface ICheckoutCompletedOptions {
  sessionId?: string;
  /** null sends the event without a payment intent, as Stripe does for $0. */
  paymentIntentId?: string | null;
  amountTotal?: number;
}

export function checkoutSessionCompletedEvent(
  options: ICheckoutCompletedOptions = {},
) {
  const {
    sessionId = "cs_test_default",
    paymentIntentId = "pi_test_default",
    amountTotal = AMOUNT_TOTAL_IN_CENTS,
  } = options;

  return stripeEvent("checkout.session.completed", {
    id: sessionId,
    object: "checkout_session",
    customer: "cus_test_default",
    payment_intent: paymentIntentId,
    amount_total: amountTotal,
    currency: "usd",
    status: "complete",
    payment_status: "paid",
  });
}

export interface IChargeUpdatedOptions {
  chargeId?: string;
  /** null models a charge that arrives before its payment intent is known. */
  paymentIntentId?: string | null;
}

export function chargeUpdatedEvent(options: IChargeUpdatedOptions = {}) {
  const { chargeId = "ch_test_default", paymentIntentId = "pi_test_default" } =
    options;

  return stripeEvent("charge.updated", {
    id: chargeId,
    object: "charge",
    customer: "cus_test_default",
    payment_intent: paymentIntentId,
    amount: AMOUNT_TOTAL_IN_CENTS,
    currency: "usd",
    status: "succeeded",
  });
}
