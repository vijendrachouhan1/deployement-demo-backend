/*
 * Shared Stripe object/event builders.
 *
 * Lives here rather than inline in each test file (the buildXPayload() pattern
 * used across modules/auth) for two reasons specific to Stripe:
 *
 *  1. The objects are deeply nested and large — a subscription with an expanded
 *     latest_invoice.payment_intent is ~40 lines, versus ~6 for a login payload.
 *  2. subscription.webhook.ts reads a LEGACY wire shape that the modern Stripe
 *     TS types no longer describe. That knowledge has to live in exactly one
 *     place; duplicating it inline is how "sample passes, production breaks"
 *     happens.
 *
 * Anything used by a single test file should still be an inline build*() helper
 * in that file, per the house pattern.
 */

import type {
  DeepPartial,
  IChargeEventOptions,
  IStripeEvent,
  TStripeObject,
  TSubscriptionPaymentState,
} from "@/tests/utils/stripe-samples.types";

export type {
  DeepPartial,
  IChargeEventOptions,
  IStripeEvent,
  TStripeObject,
  TSubscriptionPaymentState,
};

const NOW = 1_700_000_000;
const MONTH = 30 * 24 * 60 * 60;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

/**
 * Recursive merge for overrides. A shallow spread cannot express
 * `{ latest_invoice: { payment_intent: { client_secret } } }` without wiping
 * the rest of latest_invoice, which is why this exists. Arrays are replaced
 * wholesale — overriding items.data means "use exactly this".
 */
export function merge<T>(base: T, overrides?: DeepPartial<T>): T {
  if (overrides === undefined) return base;
  if (!isPlainObject(base) || !isPlainObject(overrides)) {
    return overrides as unknown as T;
  }

  const result: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(overrides)) {
    result[key] =
      isPlainObject(value) && isPlainObject(result[key])
        ? merge(result[key], value)
        : value;
  }
  return result as T;
}

let uidCounter = 0;

/** Unique but deterministic — samples must not use Math.random or a failing test won't reproduce. */
export function uid(prefix: string): string {
  uidCounter += 1;
  return `${prefix}_test_${uidCounter.toString().padStart(6, "0")}`;
}

// ---------------------------------------------------------------------------
// Stripe API return values
// ---------------------------------------------------------------------------

export function stripePlan(overrides?: DeepPartial<TStripeObject>) {
  return merge(
    {
      id: "price_test_pro_monthly",
      object: "plan",
      amount: 2900,
      currency: "usd",
      interval: "month",
      nickname: "Pro",
      product: "prod_test_pro",
    } as TStripeObject,
    overrides,
  );
}

export function stripePaymentIntent(overrides?: DeepPartial<TStripeObject>) {
  return merge(
    {
      id: "pi_test_default",
      object: "payment_intent",
      amount: 5000,
      currency: "usd",
      customer: "cus_test_default",
      status: "succeeded",
      client_secret: "pi_test_default_secret_abc",
    } as TStripeObject,
    overrides,
  );
}

export function stripeList<T>(
  data: T[],
  overrides?: DeepPartial<TStripeObject>,
) {
  return merge(
    { object: "list", data, has_more: false, url: "/v1/test" } as TStripeObject,
    overrides,
  ) as TStripeObject & { data: T[] };
}

export function stripeSubscriptionWithInvoice(
  state: TSubscriptionPaymentState = "pi_succeeded",
  overrides?: DeepPartial<TStripeObject>,
) {
  const paymentIntentStatus =
    state === "pi_requires_action"
      ? "requires_action"
      : state === "pi_requires_payment_method"
        ? "requires_payment_method"
        : "succeeded";

  const plan = stripePlan();

  return merge(
    {
      id: "sub_test_default",
      object: "subscription",
      customer: "cus_test_default",
      status: state === "pi_requires_payment_method" ? "incomplete" : "active",
      cancel_at_period_end: false,
      plan,
      items: {
        object: "list",
        data: [
          {
            id: "si_test_default",
            object: "subscription_item",
            current_period_start: NOW,
            current_period_end: NOW + MONTH,
            plan,
            price: plan,
          },
        ],
      },
      latest_invoice: {
        id: "in_test_default",
        object: "invoice",
        status: state === "invoice_paid" ? "paid" : "open",
        payment_intent: stripePaymentIntent({
          status: paymentIntentStatus,
          client_secret: "pi_test_default_secret_abc",
        }),
      },
    } as TStripeObject,
    overrides,
  );
}

/** latest_invoice returned as an unexpanded string id. */
export function stripeSubscriptionUnexpanded(
  overrides?: DeepPartial<TStripeObject>,
) {
  return merge(
    stripeSubscriptionWithInvoice("pi_succeeded", {
      latest_invoice: undefined,
    }),
    merge({ latest_invoice: "in_test_default" } as TStripeObject, overrides),
  );
}

// ---------------------------------------------------------------------------
// Webhook events
// ---------------------------------------------------------------------------

export function stripeEvent<T extends TStripeObject>(
  type: string,
  object: T,
  overrides?: DeepPartial<IStripeEvent<T>>,
): IStripeEvent<T> {
  // Annotated so `livemode: false` widens to boolean instead of narrowing
  // DeepPartial to the literal.
  const base: IStripeEvent<T> = {
    id: uid("evt"),
    object: "event",
    api_version: "2024-04-10",
    created: NOW,
    livemode: false,
    pending_webhooks: 1,
    request: { id: uid("req"), idempotency_key: null },
    type,
    data: { object, previous_attributes: null },
  };

  return merge(base, overrides);
}

export function chargeRefundedEvent(
  options: IChargeEventOptions = {},
  overrides?: DeepPartial<IStripeEvent>,
) {
  const {
    chargeId = "ch_test_default",
    paymentIntentId = "pi_test_default",
    customer = "cus_test_default",
    amount = 5000,
  } = options;

  return stripeEvent(
    "charge.refunded",
    {
      id: chargeId,
      object: "charge",
      customer,
      payment_intent: paymentIntentId,
      amount,
      currency: "usd",
      status: "succeeded",
      refunded: true,
    },
    overrides,
  );
}
