import { createApp } from "@/app";
import { StripePaymentTransactions } from "@/db/models/stripePayment/transactions";
import { createAdminSession } from "@/tests/utils/auth";
import { seedStripePaymentTransaction } from "@/tests/utils/payment-factories";
import { chargeRefundedEvent } from "@/tests/utils/stripe-samples";
import { postStripeWebhook } from "@/tests/utils/stripe-webhook";
import { chargeUpdatedEvent } from "@/webhooks/__tests__/stripe-payment/helpers/stripe-payment-event.helper";
import { describe, expect, it } from "vitest";

/**
 * POST /webhook/stripe-payment — the charge events.
 *
 * charge.updated supplies stripeChargeId, without which no refund can be
 * issued.
 */

describe("stripe payment webhook — charge events", () => {
  const app = createApp();
  const post = (event: unknown) =>
    postStripeWebhook(app, "/webhook/stripe-payment", event);

  async function seedPaidOrder(overrides: Record<string, unknown> = {}) {
    const session = await createAdminSession();
    return seedStripePaymentTransaction(session, overrides);
  }

  describe("charge.updated", () => {
    it("links the charge to the order by payment intent", async () => {
      const order = await seedPaidOrder({ stripeChargeId: undefined });

      const res = await post(chargeUpdatedEvent({ chargeId: "ch_test_new" }));

      expect(res.status).toBe(200);

      const persisted = await StripePaymentTransactions.findById(order._id);
      expect(persisted?.stripeChargeId).toBe("ch_test_new");
    });

    it("writes nothing for an unknown payment intent", async () => {
      const order = await seedPaidOrder({ stripeChargeId: undefined });

      const res = await post(
        chargeUpdatedEvent({ paymentIntentId: "pi_test_unknown" }),
      );

      expect(res.status).toBe(200);

      const persisted = await StripePaymentTransactions.findById(order._id);
      expect(persisted?.stripeChargeId).toBeUndefined();
    });

    it("writes nothing when the charge carries no payment intent", async () => {
      const order = await seedPaidOrder({ stripeChargeId: undefined });

      const res = await post(chargeUpdatedEvent({ paymentIntentId: null }));

      expect(res.status).toBe(200);

      const persisted = await StripePaymentTransactions.findById(order._id);
      expect(persisted?.stripeChargeId).toBeUndefined();
    });

    it("is safe to redeliver", async () => {
      const order = await seedPaidOrder({ stripeChargeId: undefined });

      await post(chargeUpdatedEvent({ chargeId: "ch_test_new" }));
      await post(chargeUpdatedEvent({ chargeId: "ch_test_new" }));

      const persisted = await StripePaymentTransactions.findById(order._id);
      expect(persisted?.stripeChargeId).toBe("ch_test_new");
      expect(await StripePaymentTransactions.countDocuments()).toBe(1);
    });
  });

  describe("charge.refunded", () => {
    it("flags the order as refunded", async () => {
      const order = await seedPaidOrder();

      const res = await post(chargeRefundedEvent());

      expect(res.status).toBe(200);

      const persisted = await StripePaymentTransactions.findById(order._id);
      expect(persisted?.refunded).toBe(true);
    });

    it("returns 200 and writes nothing for an unknown charge", async () => {
      const order = await seedPaidOrder();

      const res = await post(
        chargeRefundedEvent({ chargeId: "ch_test_unknown" }),
      );

      expect(res.status).toBe(200);

      const persisted = await StripePaymentTransactions.findById(order._id);
      expect(persisted?.refunded).toBe(false);
    });

    // A dashboard refund reaches us only through this event, and it leaves
    // paymentStatus on PAID, so the order list still counts it as a sale.
    it("KNOWN BUG: a dashboard refund leaves paymentStatus reading paid", async () => {
      const order = await seedPaidOrder({ paymentStatus: "paid" });

      await post(chargeRefundedEvent());

      const persisted = await StripePaymentTransactions.findById(order._id);
      expect(persisted?.paymentStatus).toBe("paid");
    });
  });
});
