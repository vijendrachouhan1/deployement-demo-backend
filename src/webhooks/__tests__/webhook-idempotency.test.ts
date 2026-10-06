import { createApp } from "@/app";
import {
  PROCESSED_WEBHOOK_EVENT_STATUS,
  ProcessedWebhookEvent,
  WEBHOOK_SOURCE,
} from "@/db/models/processed-webhook-event";
import { StripePaymentTransactions } from "@/db/models/stripePayment/transactions";
import { createAdminSession } from "@/tests/utils/auth";
import { seedStripePaymentTransaction } from "@/tests/utils/payment-factories";
import {
  postStripeWebhook,
  postStripeWebhookTwice,
  staleTimestamp,
  type TStripeWebhookPath,
} from "@/tests/utils/stripe-webhook";
import {
  completeWebhookEvent,
  releaseWebhookEvent,
} from "@/webhooks/helpers/webhook-idempotency.helper";
import { buildEvent } from "@/webhooks/__tests__/helpers/webhook-event.helper";
import { checkoutSessionCompletedEvent } from "@/webhooks/__tests__/stripe-payment/helpers/stripe-payment-event.helper";
import { describe, expect, it, vi } from "vitest";

/**
 * Event-id deduplication across all three Stripe endpoints.
 *
 * Stripe redelivers on any non-2xx and on its own schedule, so every handler
 * runs more than once for the same event as a matter of routine. The writes
 * happen to be update-shaped and survive that; the side effects around them —
 * emails, transfers — do not.
 */

const ENDPOINTS: Array<[TStripeWebhookPath, WEBHOOK_SOURCE]> = [
  ["/webhook/subscription", WEBHOOK_SOURCE.SUBSCRIPTION],
  ["/webhook/stripe-payment", WEBHOOK_SOURCE.STRIPE_PAYMENT],
  ["/webhook/stripe-connect", WEBHOOK_SOURCE.STRIPE_CONNECT],
];

describe("webhook idempotency", () => {
  const app = createApp();

  /** A pending order, as create-checkout-session leaves it. */
  async function seedPendingOrder() {
    const session = await createAdminSession();
    return seedStripePaymentTransaction(session, {
      stripePaymentIntentId: undefined,
      stripeChargeId: undefined,
      amountPaid: undefined,
      orderPlacedAt: undefined,
    });
  }

  async function seedClaim(
    source: WEBHOOK_SOURCE,
    eventId: string,
    overrides: Record<string, unknown> = {},
  ) {
    // Inserted through the driver: mongoose would stamp `updatedAt` itself and
    // an abandoned claim is defined by how old that stamp is.
    await ProcessedWebhookEvent.collection.insertOne({
      source,
      eventId,
      eventType: "charge.refunded",
      status: PROCESSED_WEBHOOK_EVENT_STATUS.PROCESSING,
      expiresAt: new Date(Date.now() + 60_000),
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    });
  }

  describe("recording", () => {
    it.each(ENDPOINTS)(
      "records the delivered event id on %s",
      async (path, source) => {
        const event = buildEvent();

        const res = await postStripeWebhook(app, path, event);

        expect(res.status).toBe(200);
        const recorded = await ProcessedWebhookEvent.findOne({
          source,
          eventId: event.id,
        });
        expect(recorded?.status).toBe(PROCESSED_WEBHOOK_EVENT_STATUS.COMPLETED);
      },
    );

    /*
     * The guard runs after verification for a reason: a payload that could
     * claim an id before the real delivery arrives would suppress it.
     */
    it.each(ENDPOINTS)(
      "records nothing for a payload that fails verification on %s",
      async (path) => {
        const event = buildEvent();

        const res = await postStripeWebhook(app, path, event, {
          timestamp: staleTimestamp(),
        });

        expect(res.status).toBe(400);
        expect(await ProcessedWebhookEvent.countDocuments()).toBe(0);
      },
    );
  });

  describe("redelivery", () => {
    it("does not re-run the handler when Stripe redelivers the same event", async () => {
      await seedPendingOrder();
      const applied = vi.spyOn(StripePaymentTransactions, "findOneAndUpdate");

      const { first, second } = await postStripeWebhookTwice(
        app,
        "/webhook/stripe-payment",
        checkoutSessionCompletedEvent(),
      );

      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      expect(applied).toHaveBeenCalledTimes(1);
    });

    it("acknowledges the redelivery as already processed", async () => {
      await seedPendingOrder();

      const { second } = await postStripeWebhookTwice(
        app,
        "/webhook/stripe-payment",
        checkoutSessionCompletedEvent(),
      );

      expect(second.body.message).toBe("Event already processed.");
    });

    it("still applies an event Stripe has not sent before", async () => {
      await seedPendingOrder();
      const applied = vi.spyOn(StripePaymentTransactions, "findOneAndUpdate");

      await postStripeWebhook(app, "/webhook/stripe-payment", buildEvent());
      await postStripeWebhook(app, "/webhook/stripe-payment", buildEvent());

      expect(applied).toHaveBeenCalledTimes(2);
    });

    /*
     * charge.refunded is handled by both payment webhooks, so an account
     * subscribing both endpoints to it receives one event id twice. Keyed on
     * the id alone, whichever arrived first would silence the other.
     */
    it("applies one event id once per endpoint it is delivered to", async () => {
      const event = buildEvent();

      const payment = await postStripeWebhook(
        app,
        "/webhook/stripe-payment",
        event,
      );
      const connect = await postStripeWebhook(
        app,
        "/webhook/stripe-connect",
        event,
      );

      expect(payment.status).toBe(200);
      expect(connect.status).toBe(200);
      expect(await ProcessedWebhookEvent.countDocuments()).toBe(2);
    });
  });

  describe("claims", () => {
    it("answers 409 while an earlier delivery is still in flight", async () => {
      const event = buildEvent();
      await seedClaim(WEBHOOK_SOURCE.STRIPE_PAYMENT, event.id);

      const res = await postStripeWebhook(
        app,
        "/webhook/stripe-payment",
        event,
      );

      expect(res.status).toBe(409);
    });

    /*
     * A process killed between the claim and the completion leaves the row
     * PROCESSING forever. Without a takeover window that event answers 409 to
     * every retry and is never applied at all.
     */
    it("takes over a claim abandoned mid-flight", async () => {
      await seedPendingOrder();
      const event = checkoutSessionCompletedEvent();
      await seedClaim(WEBHOOK_SOURCE.STRIPE_PAYMENT, event.id, {
        updatedAt: new Date(Date.now() - 60 * 60 * 1000),
      });

      const res = await postStripeWebhook(
        app,
        "/webhook/stripe-payment",
        event,
      );

      expect(res.status).toBe(200);
      const claim = await ProcessedWebhookEvent.findOne({ eventId: event.id });
      expect(claim?.status).toBe(PROCESSED_WEBHOOK_EVENT_STATUS.COMPLETED);
    });

    /*
     * The claim is written before the work, so a handler that then fails must
     * drop it — otherwise the dedupe guard, not the handler, is what makes the
     * retry a no-op, and the event is lost.
     */
    it("releases the claim when the handler fails, so the retry re-runs", async () => {
      const order = await seedPendingOrder();
      const event = checkoutSessionCompletedEvent();
      // Once only: the spy falls back to the real write for the retry.
      vi.spyOn(
        StripePaymentTransactions,
        "findOneAndUpdate",
      ).mockRejectedValueOnce(new Error("write conflict"));

      const failed = await postStripeWebhook(
        app,
        "/webhook/stripe-payment",
        event,
      );
      expect(failed.status).toBe(500);
      expect(
        await ProcessedWebhookEvent.countDocuments({ eventId: event.id }),
      ).toBe(0);

      const retried = await postStripeWebhook(
        app,
        "/webhook/stripe-payment",
        event,
      );

      expect(retried.status).toBe(200);
      const persisted = await StripePaymentTransactions.findById(order._id);
      expect(persisted?.stripePaymentIntentId).toBe("pi_test_default");
    });

    /*
     * Takeover and release are each correct alone and wrong together: the
     * displaced delivery is still running, and on failure would drop the row
     * its replacement had already completed.
     */
    it("ignores a release from a delivery a takeover displaced", async () => {
      await seedPendingOrder();
      const event = checkoutSessionCompletedEvent();
      const displacedClaimId = "claim-displaced";
      await seedClaim(WEBHOOK_SOURCE.STRIPE_PAYMENT, event.id, {
        claimId: displacedClaimId,
        updatedAt: new Date(Date.now() - 60 * 60 * 1000),
      });

      const takeover = await postStripeWebhook(
        app,
        "/webhook/stripe-payment",
        event,
      );
      expect(takeover.status).toBe(200);

      await releaseWebhookEvent(
        WEBHOOK_SOURCE.STRIPE_PAYMENT,
        event.id,
        displacedClaimId,
      );

      const claim = await ProcessedWebhookEvent.findOne({ eventId: event.id });
      expect(claim?.status).toBe(PROCESSED_WEBHOOK_EVENT_STATUS.COMPLETED);
    });

    it("ignores a completion from a delivery a takeover displaced", async () => {
      const event = buildEvent();
      const displacedClaimId = "claim-displaced";
      await seedClaim(WEBHOOK_SOURCE.STRIPE_CONNECT, event.id, {
        claimId: displacedClaimId,
      });

      await completeWebhookEvent(
        WEBHOOK_SOURCE.STRIPE_CONNECT,
        event.id,
        "some-other-claim",
      );

      const claim = await ProcessedWebhookEvent.findOne({ eventId: event.id });
      expect(claim?.status).toBe(PROCESSED_WEBHOOK_EVENT_STATUS.PROCESSING);
    });
  });
});
