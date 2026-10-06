import { createApp } from "@/app";
import { Subscription } from "@/db/models/subscription";
import { STRIPE_SUBSCRIPTION_STATUS } from "@/modules/subscription/utils/subscription.enum";
import { putCancelSubscription } from "@/modules/subscription/__tests__/helpers/subscription-endpoint.helper";
import { mockEmailService } from "@/tests/mocks/email-service.mock";
import { stripeMock } from "@/tests/mocks/stripe.mock";
import { seedSubscription } from "@/tests/utils/payment-factories";
import { stripeEvent } from "@/tests/utils/stripe-samples";
import {
  postStripeWebhook,
  postStripeWebhookTwice,
  staleTimestamp,
} from "@/tests/utils/stripe-webhook";
import {
  createWebhookUser,
  subscriptionUpdatedEvent,
} from "@/webhooks/__tests__/subscription/helpers/subscription-event.helper";
import { describe, expect, it, vi } from "vitest";

/**
 * POST /webhook/subscription — signature handling, unknown customers,
 * invoice.payment_failed, and delivery replay.
 */

describe("subscription webhook — billing and delivery", () => {
  const app = createApp();
  const post = (event: unknown) =>
    postStripeWebhook(app, "/webhook/subscription", event);

  function invoicePaymentFailedEvent(invoice: Record<string, unknown> = {}) {
    const body = {
      id: "in_test_default",
      object: "invoice",
      customer: "cus_test_default",
      subscription: "sub_test_default",
      billing_reason: "subscription_cycle",
      payment_intent: "pi_test_default",
      ...invoice,
    };
    return stripeEvent("invoice.payment_failed", body);
  }

  describe("signature", () => {
    it("returns 400 for a payload signed with the wrong secret", async () => {
      await createWebhookUser();

      const res = await postStripeWebhook(
        app,
        "/webhook/subscription",
        subscriptionUpdatedEvent(),
        { secret: "whsec_not_the_one" },
      );

      expect(res.status).toBe(400);
    });

    it("returns 400 when the signature timestamp is outside the tolerance", async () => {
      await createWebhookUser();

      const res = await postStripeWebhook(
        app,
        "/webhook/subscription",
        subscriptionUpdatedEvent(),
        { timestamp: staleTimestamp() },
      );

      expect(res.status).toBe(400);
    });

    it("writes nothing when the signature fails", async () => {
      await createWebhookUser();

      await postStripeWebhook(
        app,
        "/webhook/subscription",
        subscriptionUpdatedEvent({ id: "sub_unsigned" }),
        { omitSignature: true },
      );

      expect(
        await Subscription.findOne({ stripeSubscriptionId: "sub_unsigned" }),
      ).toBeNull();
    });
  });

  describe("unknown customer", () => {
    it("returns 200 and writes nothing when no user matches the Stripe customer", async () => {
      const res = await post(
        subscriptionUpdatedEvent({
          id: "sub_orphan",
          customer: "cus_nobody_here",
        }),
      );

      expect(res.status).toBe(200);
      expect(
        await Subscription.findOne({ stripeSubscriptionId: "sub_orphan" }),
      ).toBeNull();
    });

    it("records the dropped event rather than reporting success", async () => {
      const consoleWarn = vi
        .spyOn(console, "warn")
        .mockImplementation(() => {});

      await post(
        subscriptionUpdatedEvent({
          id: "sub_orphan",
          customer: "cus_nobody_here",
        }),
      );

      expect(consoleWarn).toHaveBeenCalledWith(
        expect.stringContaining("cus_nobody_here"),
      );
      consoleWarn.mockRestore();
    });
  });

  describe("cancel_at_period_end", () => {
    it("emails the customer that the subscription is ending", async () => {
      const session = await createWebhookUser();
      await seedSubscription(session, { planName: "Starter" });

      const res = await post(
        subscriptionUpdatedEvent(
          { cancel_at_period_end: true },
          { cancel_at_period_end: false },
        ),
      );

      expect(res.status).toBe(200);
      expect(mockEmailService.sendEmail).toHaveBeenCalledTimes(1);
    });

    it("emails after the cancellation endpoint has already set the local flag, once per event", async () => {
      const session = await createWebhookUser();
      const subscription = await seedSubscription(session);
      stripeMock.subscriptions.update.mockResolvedValueOnce({
        id: subscription.stripeSubscriptionId,
        cancel_at_period_end: true,
      });

      const cancel = await putCancelSubscription(app, session, {
        subId: subscription.stripeSubscriptionId,
      });
      expect(cancel.status).toBe(200);
      expect(
        (await Subscription.findById(subscription._id))
          ?.subscriptionCancellationRequested,
      ).toBe(true);

      const event = subscriptionUpdatedEvent(
        { cancel_at_period_end: true },
        { cancel_at_period_end: false },
      );
      expect((await post(event)).status).toBe(200);
      expect((await post(event)).status).toBe(200);
      expect(mockEmailService.sendEmail).toHaveBeenCalledTimes(1);
      expect(mockEmailService.sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: session.user.email,
          subject: expect.stringContaining("Subscription cancelled!"),
        }),
      );
    });

    it("retries a failed cancellation email even after the webhook has stored the flag", async () => {
      const session = await createWebhookUser();
      const subscription = await seedSubscription(session);
      const event = subscriptionUpdatedEvent(
        { cancel_at_period_end: true },
        { cancel_at_period_end: false },
      );
      mockEmailService.sendEmail.mockRejectedValueOnce(
        new Error("Email unavailable"),
      );

      expect((await post(event)).status).toBe(500);
      expect(
        (await Subscription.findById(subscription._id))
          ?.subscriptionCancellationRequested,
      ).toBe(true);
      expect((await post(event)).status).toBe(200);
      expect(mockEmailService.sendEmail).toHaveBeenCalledTimes(2);
    });

    it.each([null, {}, { status: "active" }])(
      "does not infer a cancellation transition from a stale local flag when previous attributes are %j",
      async (previousAttributes) => {
        const session = await createWebhookUser();
        await seedSubscription(session, {
          subscriptionCancellationRequested: false,
        });
        const response = await post(
          subscriptionUpdatedEvent(
            { cancel_at_period_end: true, status: "past_due" },
            previousAttributes,
          ),
        );
        expect(response.status).toBe(200);
        expect(mockEmailService.sendEmail).not.toHaveBeenCalled();
      },
    );

    it("records the request on the subscription row", async () => {
      const session = await createWebhookUser();
      await seedSubscription(session, {
        subscriptionCancellationRequested: false,
      });

      await post(subscriptionUpdatedEvent({ cancel_at_period_end: true }));

      const row = await Subscription.findOne({
        stripeSubscriptionId: "sub_test_default",
      });
      expect(row?.subscriptionCancellationRequested).toBe(true);
    });

    it("still applies a status change while the cancellation is pending", async () => {
      const session = await createWebhookUser();
      await seedSubscription(session);

      await post(
        subscriptionUpdatedEvent({
          cancel_at_period_end: true,
          status: "past_due",
        }),
      );

      const row = await Subscription.findOne({
        stripeSubscriptionId: "sub_test_default",
      });
      expect(row?.status).toBe(STRIPE_SUBSCRIPTION_STATUS.PAST_DUE);
    });

    it("does not re-send the email on a later event carrying the same flag", async () => {
      const session = await createWebhookUser();
      await seedSubscription(session, {
        subscriptionCancellationRequested: true,
      });

      await post(
        subscriptionUpdatedEvent({
          id: "sub_test_default",
          cancel_at_period_end: true,
        }),
      );

      expect(mockEmailService.sendEmail).not.toHaveBeenCalled();
    });
  });

  describe("invoice.payment_failed", () => {
    const basilInvoiceEvent = () =>
      stripeEvent(
        "invoice.payment_failed",
        {
          id: "in_basil",
          object: "invoice",
          customer: "cus_test_default",
          billing_reason: "subscription_cycle",
          parent: {
            type: "subscription_details",
            subscription_details: { subscription: "sub_test_default" },
          },
        },
        { api_version: "2025-03-31.basil" },
      );

    const retrievedInvoice = {
      id: "in_basil",
      subscription: "sub_test_default",
      billing_reason: "subscription_cycle",
      payment_intent: "pi_test_default",
    };

    it("handles Basil deliveries through the SDK invoice format and deduplicates retries", async () => {
      const session = await createWebhookUser();
      const subscription = await seedSubscription(session);
      stripeMock.invoices.retrieve.mockResolvedValueOnce(retrievedInvoice);
      const event = basilInvoiceEvent();

      expect((await post(event)).status).toBe(200);
      expect((await post(event)).status).toBe(200);
      expect(stripeMock.invoices.retrieve).toHaveBeenCalledExactlyOnceWith(
        "in_basil",
      );
      expect((await Subscription.findById(subscription._id))?.status).toBe(
        STRIPE_SUBSCRIPTION_STATUS.PAST_DUE,
      );
      expect(mockEmailService.sendEmail).toHaveBeenCalledTimes(1);
      expect(stripeMock.paymentIntents.retrieve).not.toHaveBeenCalled();
    });

    it("allows redelivery after the invoice lookup fails", async () => {
      const session = await createWebhookUser();
      const subscription = await seedSubscription(session);
      stripeMock.invoices.retrieve
        .mockRejectedValueOnce(new Error("Stripe unavailable"))
        .mockResolvedValueOnce(retrievedInvoice);
      const event = basilInvoiceEvent();

      expect((await post(event)).status).toBe(500);
      expect((await Subscription.findById(subscription._id))?.status).toBe(
        STRIPE_SUBSCRIPTION_STATUS.ACTIVE,
      );
      expect(mockEmailService.sendEmail).not.toHaveBeenCalled();
      expect((await post(event)).status).toBe(200);
      expect((await Subscription.findById(subscription._id))?.status).toBe(
        STRIPE_SUBSCRIPTION_STATUS.PAST_DUE,
      );
      expect(mockEmailService.sendEmail).toHaveBeenCalledTimes(1);
    });

    it("keeps non-subscription invoices from modifying a subscription after lookup", async () => {
      const session = await createWebhookUser();
      const subscription = await seedSubscription(session);
      stripeMock.invoices.retrieve.mockResolvedValueOnce({
        ...retrievedInvoice,
        subscription: null,
        payment_intent: null,
      });
      expect((await post(basilInvoiceEvent())).status).toBe(200);
      expect((await Subscription.findById(subscription._id))?.status).toBe(
        STRIPE_SUBSCRIPTION_STATUS.ACTIVE,
      );
      expect(mockEmailService.sendEmail).not.toHaveBeenCalled();
    });

    it("marks the subscription PAST_DUE on a failed renewal", async () => {
      const session = await createWebhookUser();
      await seedSubscription(session);

      const res = await post(invoicePaymentFailedEvent());

      expect(res.status).toBe(200);
      const row = await Subscription.findOne({
        stripeSubscriptionId: "sub_test_default",
      });
      expect(row?.status).toBe(STRIPE_SUBSCRIPTION_STATUS.PAST_DUE);
    });

    it("reads the invoice off the event instead of refetching it", async () => {
      const session = await createWebhookUser();
      await seedSubscription(session);

      await post(invoicePaymentFailedEvent());

      // Both calls were round trips for data the event already carried, and
      // the payment intent's result was discarded on arrival.
      expect(stripeMock.invoices.retrieve).not.toHaveBeenCalled();
      expect(stripeMock.paymentIntents.retrieve).not.toHaveBeenCalled();
    });

    it("emails the customer about the failed renewal", async () => {
      const session = await createWebhookUser();
      await seedSubscription(session);

      await post(invoicePaymentFailedEvent());

      expect(mockEmailService.sendEmail).toHaveBeenCalledTimes(1);
    });

    it("ignores the first invoice of a brand-new subscription", async () => {
      const session = await createWebhookUser();
      await seedSubscription(session);

      const res = await post(
        invoicePaymentFailedEvent({ billing_reason: "subscription_create" }),
      );

      expect(res.status).toBe(200);
      const row = await Subscription.findOne({
        stripeSubscriptionId: "sub_test_default",
      });
      expect(row?.status).toBe(STRIPE_SUBSCRIPTION_STATUS.ACTIVE);
      expect(mockEmailService.sendEmail).not.toHaveBeenCalled();
    });

    it("skips the email when the invoice carries no payment intent", async () => {
      const session = await createWebhookUser();
      await seedSubscription(session);

      await post(invoicePaymentFailedEvent({ payment_intent: null }));

      const row = await Subscription.findOne({
        stripeSubscriptionId: "sub_test_default",
      });
      expect(row?.status).toBe(STRIPE_SUBSCRIPTION_STATUS.PAST_DUE);
      expect(mockEmailService.sendEmail).not.toHaveBeenCalled();
    });
  });

  describe("replay", () => {
    it("does not create a second row when Stripe redelivers the same event", async () => {
      await createWebhookUser();

      const { first, second } = await postStripeWebhookTwice(
        app,
        "/webhook/subscription",
        subscriptionUpdatedEvent({ id: "sub_replayed" }),
      );

      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      const rows = await Subscription.find({
        stripeSubscriptionId: "sub_replayed",
      });
      expect(rows).toHaveLength(1);
    });

    /*
     * The subscription row survives a replay on its own, because that write is
     * update-shaped. The email is the side effect that does not, and it is
     * what the event-id guard is there for.
     */
    it("sends the welcome email once for a redelivered event", async () => {
      await createWebhookUser();

      await postStripeWebhookTwice(
        app,
        "/webhook/subscription",
        subscriptionUpdatedEvent({ id: "sub_replayed" }),
      );

      expect(mockEmailService.sendEmail).toHaveBeenCalledTimes(1);
    });
  });
});
