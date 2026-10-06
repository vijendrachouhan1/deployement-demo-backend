import { createApp } from "@/app";
import { StripeConnectTransactions } from "@/db/models/stripeConnect/transactions";
import { StripePaymentTransactions } from "@/db/models/stripePayment/transactions";
import { Subscription } from "@/db/models/subscription";
import { createAdminSession } from "@/tests/utils/auth";
import {
  seedStripeConnectTransaction,
  seedStripePaymentTransaction,
} from "@/tests/utils/payment-factories";
import {
  postStripeWebhook,
  staleTimestamp,
} from "@/tests/utils/stripe-webhook";
import { buildEvent } from "@/webhooks/__tests__/helpers/webhook-event.helper";
import {
  createWebhookUser,
  subscriptionUpdatedEvent,
} from "@/webhooks/__tests__/subscription/helpers/subscription-event.helper";
import { describe, expect, it, vi } from "vitest";

/**
 * What each webhook answers when its own work fails.
 *
 * Stripe reads the status code as a verdict on the delivery: 2xx stops the
 * retries, everything else schedules another. A database failure answered with
 * 400 tells Stripe the payload was malformed — which is both untrue and, since
 * it still retries, a claim that redelivering a malformed payload will help.
 * The distinction that matters is signature (never retry) versus internal
 * failure (retry, the next attempt may well succeed).
 */

describe("webhook failure status codes", () => {
  const app = createApp();

  describe("subscription", () => {
    it("answers 500 when the subscription write fails", async () => {
      await createWebhookUser();
      vi.spyOn(Subscription, "findOne").mockRejectedValue(
        new Error("connection lost"),
      );

      const res = await postStripeWebhook(
        app,
        "/webhook/subscription",
        subscriptionUpdatedEvent({ id: "sub_write_fails" }),
      );

      expect(res.status).toBe(500);
    });

    it("answers 400 only for a signature it cannot verify", async () => {
      await createWebhookUser();

      const res = await postStripeWebhook(
        app,
        "/webhook/subscription",
        subscriptionUpdatedEvent(),
        { timestamp: staleTimestamp() },
      );

      expect(res.status).toBe(400);
    });
  });

  describe("stripe payment", () => {
    it("answers 500 when the transaction write fails", async () => {
      const session = await createAdminSession();
      await seedStripePaymentTransaction(session);
      vi.spyOn(StripePaymentTransactions, "findOneAndUpdate").mockRejectedValue(
        new Error("connection lost"),
      );

      const res = await postStripeWebhook(
        app,
        "/webhook/stripe-payment",
        buildEvent(),
      );

      expect(res.status).toBe(500);
    });
  });

  describe("stripe connect", () => {
    it("answers 500 when the transaction write fails", async () => {
      const session = await createAdminSession();
      await seedStripeConnectTransaction(session);
      vi.spyOn(StripeConnectTransactions, "findOneAndUpdate").mockRejectedValue(
        new Error("connection lost"),
      );

      const res = await postStripeWebhook(
        app,
        "/webhook/stripe-connect",
        buildEvent(),
      );

      expect(res.status).toBe(500);
    });
  });
});
