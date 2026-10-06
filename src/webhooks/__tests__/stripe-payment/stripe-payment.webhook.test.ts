import { createApp } from "@/app";
import { StripePaymentTransactions } from "@/db/models/stripePayment/transactions";
import { PAYMENT_STATUS } from "@/providers/payment/stripe/stripe.types";
import { createAdminSession } from "@/tests/utils/auth";
import { seedStripePaymentTransaction } from "@/tests/utils/payment-factories";
import {
  postStripeWebhook,
  postStripeWebhookTwice,
  staleTimestamp,
} from "@/tests/utils/stripe-webhook";
import {
  AMOUNT_TOTAL_IN_CENTS,
  AMOUNT_TOTAL_IN_DOLLARS,
  checkoutSessionCompletedEvent,
} from "@/webhooks/__tests__/stripe-payment/helpers/stripe-payment-event.helper";
import { describe, expect, it } from "vitest";

/**
 * POST /webhook/stripe-payment — checkout.session.completed.
 *
 * The only place the amount the customer actually paid enters the database.
 */

describe("stripe payment webhook — checkout session completed", () => {
  const app = createApp();
  const post = (event: unknown) =>
    postStripeWebhook(app, "/webhook/stripe-payment", event);

  /** A pending row, as create-checkout-session leaves it. */
  async function seedPendingOrder(overrides: Record<string, unknown> = {}) {
    const session = await createAdminSession();
    return seedStripePaymentTransaction(session, {
      stripePaymentIntentId: undefined,
      stripeChargeId: undefined,
      amountPaid: undefined,
      orderPlacedAt: undefined,
      ...overrides,
    });
  }

  describe("success", () => {
    it("marks the order paid", async () => {
      const order = await seedPendingOrder();

      const res = await post(checkoutSessionCompletedEvent());

      expect(res.status).toBe(200);

      const persisted = await StripePaymentTransactions.findById(order._id);
      expect(persisted?.paymentStatus).toBe(PAYMENT_STATUS.PAID);
    });

    it("converts amount_total from cents to dollars", async () => {
      const order = await seedPendingOrder();

      await post(
        checkoutSessionCompletedEvent({ amountTotal: AMOUNT_TOTAL_IN_CENTS }),
      );

      const persisted = await StripePaymentTransactions.findById(order._id);
      expect(persisted?.amountPaid).toBe(AMOUNT_TOTAL_IN_DOLLARS);
    });

    it("stores the discounted total rather than the list price", async () => {
      const order = await seedPendingOrder();

      await post(checkoutSessionCompletedEvent({ amountTotal: 3999 }));

      const persisted = await StripePaymentTransactions.findById(order._id);
      expect(persisted?.amountPaid).toBe(39.99);
    });

    it("links the payment intent and stamps the order date", async () => {
      const order = await seedPendingOrder();

      await post(
        checkoutSessionCompletedEvent({ paymentIntentId: "pi_test_linked" }),
      );

      const persisted = await StripePaymentTransactions.findById(order._id);
      expect(persisted?.stripePaymentIntentId).toBe("pi_test_linked");
      expect(persisted?.orderPlacedAt).toBeInstanceOf(Date);
    });
  });

  describe("business scenarios", () => {
    it("returns 200 and writes nothing for an unknown session id", async () => {
      const order = await seedPendingOrder();

      const res = await post(
        checkoutSessionCompletedEvent({ sessionId: "cs_test_unknown" }),
      );

      expect(res.status).toBe(200);

      const persisted = await StripePaymentTransactions.findById(order._id);
      expect(persisted?.paymentStatus).toBe(PAYMENT_STATUS.PENDING);
    });

    it("writes nothing when the session carries no payment intent", async () => {
      const order = await seedPendingOrder();

      const res = await post(
        checkoutSessionCompletedEvent({ paymentIntentId: null }),
      );

      expect(res.status).toBe(200);

      const persisted = await StripePaymentTransactions.findById(order._id);
      expect(persisted?.paymentStatus).toBe(PAYMENT_STATUS.PENDING);
    });

    it("leaves other companies' orders alone", async () => {
      await seedPendingOrder();
      const other = await seedPendingOrder({
        stripeCheckoutSessionId: "cs_test_other",
      });

      await post(checkoutSessionCompletedEvent());

      const persisted = await StripePaymentTransactions.findById(other._id);
      expect(persisted?.paymentStatus).toBe(PAYMENT_STATUS.PENDING);
    });
  });

  describe("delivery", () => {
    it("applies a redelivered event exactly once", async () => {
      const order = await seedPendingOrder();

      const { first, second } = await postStripeWebhookTwice(
        app,
        "/webhook/stripe-payment",
        checkoutSessionCompletedEvent(),
      );

      expect(first.status).toBe(200);
      expect(second.status).toBe(200);

      const persisted = await StripePaymentTransactions.findById(order._id);
      expect(persisted?.amountPaid).toBe(AMOUNT_TOTAL_IN_DOLLARS);
      expect(await StripePaymentTransactions.countDocuments()).toBe(1);
    });
  });

  describe("signature", () => {
    it("returns 400 for a payload signed with the wrong secret", async () => {
      await seedPendingOrder();

      const res = await postStripeWebhook(
        app,
        "/webhook/stripe-payment",
        checkoutSessionCompletedEvent(),
        { secret: "whsec_not_the_one" },
      );

      expect(res.status).toBe(400);
    });

    it("returns 400 when the signature timestamp is outside the tolerance", async () => {
      await seedPendingOrder();

      const res = await postStripeWebhook(
        app,
        "/webhook/stripe-payment",
        checkoutSessionCompletedEvent(),
        { timestamp: staleTimestamp() },
      );

      expect(res.status).toBe(400);
    });

    it("writes nothing when the signature is missing", async () => {
      const order = await seedPendingOrder();

      await postStripeWebhook(
        app,
        "/webhook/stripe-payment",
        checkoutSessionCompletedEvent(),
        { omitSignature: true },
      );

      const persisted = await StripePaymentTransactions.findById(order._id);
      expect(persisted?.paymentStatus).toBe(PAYMENT_STATUS.PENDING);
    });
  });
});
