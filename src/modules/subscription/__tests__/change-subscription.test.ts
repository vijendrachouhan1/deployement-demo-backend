import { createApp } from "@/app";
import { SUBSCRIPTION_MESSAGES } from "@/modules/subscription/utils/subscription.constant";
import {
  createBillingAdminSession,
  postChangeSubscription,
} from "@/modules/subscription/__tests__/helpers/subscription-endpoint.helper";
import {
  NEW_PRICE_ID,
  PRICE_ID,
  SUBSCRIPTION_ID,
} from "@/modules/subscription/__tests__/utils/subscription.constant";
import { stripeMock } from "@/tests/mocks/stripe.mock";
import { seedSubscription } from "@/tests/utils/payment-factories";
import { stripeSubscriptionWithInvoice } from "@/tests/utils/stripe-samples";
import { describe, expect, it } from "vitest";

/**
 * POST /api/admin/subscription/plans
 *
 * Two shapes behind one route: a free user gets a brand-new subscription, an
 * existing subscriber gets an in-place price swap. The swap has four possible
 * outcomes depending on how Stripe settled the proration invoice, and each one
 * maps to a different response — so each gets its own case below.
 */

describe("POST /api/admin/subscription/plans — change plan", () => {
  const app = createApp();

  /** findUserPlans() resolves the plan's product before it returns. */
  function stubProductLookup() {
    stripeMock.products.retrieve.mockResolvedValueOnce({
      id: "prod_test_pro",
      description: "Pro plan",
      marketing_features: [],
    });
  }

  describe("free to paid", () => {
    it("creates a new subscription when the company has no plan", async () => {
      const session = await createBillingAdminSession();
      stripeMock.subscriptions.list.mockResolvedValueOnce({ data: [] });
      stripeMock.subscriptions.create.mockResolvedValueOnce(
        stripeSubscriptionWithInvoice("pi_succeeded", {
          id: "sub_new",
          latest_invoice: {
            payment_intent: { client_secret: "pi_secret_new" },
          },
        }),
      );

      const res = await postChangeSubscription(app, session, {
        newPriceId: NEW_PRICE_ID,
      });

      expect(res.status).toBe(200);
      expect(res.body.message).toBe(SUBSCRIPTION_MESSAGES.UPGRADED_FROM_FREE);
      expect(res.body.data).toMatchObject({
        subscriptionId: "sub_new",
        clientSecret: "pi_secret_new",
        changeType: "upgrade_from_free",
      });
    });

    it("returns 402 when Stripe rejects the new subscription", async () => {
      const session = await createBillingAdminSession();
      stripeMock.subscriptions.list.mockResolvedValueOnce({ data: [] });
      stripeMock.subscriptions.create.mockRejectedValueOnce(
        new Error("Your card was declined."),
      );

      const res = await postChangeSubscription(app, session, {
        newPriceId: NEW_PRICE_ID,
      });

      expect(res.status).toBe(402);
      expect(res.body.message).toBe("Your card was declined.");
    });
  });

  describe("the webhook lag window", () => {
    /*
     * findUserPlans reads a row only the webhook writes, so it reports "free"
     * between creating a subscription and Stripe announcing it went active. A
     * second call in that window used to open a second paid subscription.
     */

    it("does not open a second subscription while one is already live at Stripe", async () => {
      const session = await createBillingAdminSession();
      stripeMock.subscriptions.list.mockResolvedValueOnce({
        data: [
          {
            id: "sub_live",
            status: "active",
            items: { data: [{ price: { id: PRICE_ID } }] },
          },
        ],
      });
      stripeMock.subscriptions.update.mockResolvedValueOnce(
        stripeSubscriptionWithInvoice("pi_succeeded", {
          id: "sub_live",
          latest_invoice: { status: "paid" },
        }),
      );
      stripeMock.subscriptions.retrieve.mockResolvedValueOnce({
        items: { data: [{ id: "si_1" }] },
      });

      const res = await postChangeSubscription(app, session, {
        newPriceId: NEW_PRICE_ID,
      });

      expect(res.status).toBe(200);
      expect(stripeMock.subscriptions.create).not.toHaveBeenCalled();
      expect(stripeMock.subscriptions.update).toHaveBeenCalledWith(
        "sub_live",
        expect.anything(),
      );
    });

    it("rejects a repeat of the plan already live at Stripe", async () => {
      const session = await createBillingAdminSession();
      stripeMock.subscriptions.list.mockResolvedValueOnce({
        data: [
          {
            id: "sub_live",
            status: "active",
            items: { data: [{ price: { id: NEW_PRICE_ID } }] },
          },
        ],
      });

      const res = await postChangeSubscription(app, session, {
        newPriceId: NEW_PRICE_ID,
      });

      expect(res.status).toBe(400);
      expect(res.body.message).toBe(SUBSCRIPTION_MESSAGES.ALREADY_SUBSCRIBED);
      expect(stripeMock.subscriptions.create).not.toHaveBeenCalled();
    });

    it("clears an abandoned incomplete attempt before starting another", async () => {
      const session = await createBillingAdminSession();
      stripeMock.subscriptions.list.mockResolvedValueOnce({
        data: [{ id: "sub_abandoned", status: "incomplete" }],
      });
      stripeMock.subscriptions.cancel.mockResolvedValueOnce({
        id: "sub_abandoned",
      });
      stripeMock.subscriptions.create.mockResolvedValueOnce(
        stripeSubscriptionWithInvoice("pi_succeeded", {
          id: "sub_retry",
          latest_invoice: {
            payment_intent: { client_secret: "pi_secret_retry" },
          },
        }),
      );

      const res = await postChangeSubscription(app, session, {
        newPriceId: NEW_PRICE_ID,
      });

      expect(res.status).toBe(200);
      expect(stripeMock.subscriptions.cancel).toHaveBeenCalledWith(
        "sub_abandoned",
      );
      expect(res.body.data.subscriptionId).toBe("sub_retry");
    });

    it("still creates for a customer Stripe holds nothing live for", async () => {
      const session = await createBillingAdminSession();
      stripeMock.subscriptions.list.mockResolvedValueOnce({
        data: [{ id: "sub_gone", status: "canceled" }],
      });
      stripeMock.subscriptions.create.mockResolvedValueOnce(
        stripeSubscriptionWithInvoice("pi_succeeded", {
          id: "sub_fresh",
          latest_invoice: {
            payment_intent: { client_secret: "pi_secret_fresh" },
          },
        }),
      );

      const res = await postChangeSubscription(app, session, {
        newPriceId: NEW_PRICE_ID,
      });

      expect(res.status).toBe(200);
      expect(res.body.data.subscriptionId).toBe("sub_fresh");
    });
  });

  describe("paid to paid", () => {
    it("returns 400 when switching to the plan already held", async () => {
      const session = await createBillingAdminSession();
      await seedSubscription(session, { planId: PRICE_ID });
      stubProductLookup();

      const res = await postChangeSubscription(app, session, {
        newPriceId: PRICE_ID,
      });

      expect(res.status).toBe(400);
      expect(res.body.message).toBe(SUBSCRIPTION_MESSAGES.ALREADY_SUBSCRIBED);
      expect(stripeMock.subscriptions.update).not.toHaveBeenCalled();
    });

    it("succeeds without a client secret when the proration invoice is already paid", async () => {
      const session = await createBillingAdminSession();
      await seedSubscription(session, { planId: PRICE_ID });
      stubProductLookup();
      stripeMock.subscriptions.retrieve.mockResolvedValueOnce(
        stripeSubscriptionWithInvoice(),
      );
      stripeMock.subscriptions.update.mockResolvedValueOnce(
        stripeSubscriptionWithInvoice("invoice_paid", { id: SUBSCRIPTION_ID }),
      );

      const res = await postChangeSubscription(app, session, {
        newPriceId: NEW_PRICE_ID,
      });

      expect(res.status).toBe(200);
      expect(res.body.message).toBe(SUBSCRIPTION_MESSAGES.SUBSCRIPTION_CHANGED);
      expect(res.body.data.subscriptionId).toBe(SUBSCRIPTION_ID);
      expect(res.body.data.clientSecret).toBeUndefined();
    });

    it("succeeds without a client secret when the payment intent already succeeded", async () => {
      const session = await createBillingAdminSession();
      await seedSubscription(session, { planId: PRICE_ID });
      stubProductLookup();
      stripeMock.subscriptions.retrieve.mockResolvedValueOnce(
        stripeSubscriptionWithInvoice(),
      );
      stripeMock.subscriptions.update.mockResolvedValueOnce(
        stripeSubscriptionWithInvoice("pi_succeeded", { id: SUBSCRIPTION_ID }),
      );

      const res = await postChangeSubscription(app, session, {
        newPriceId: NEW_PRICE_ID,
      });

      expect(res.status).toBe(200);
      expect(res.body.data.clientSecret).toBeUndefined();
    });

    it("returns the client secret when the charge requires 3DS confirmation", async () => {
      const session = await createBillingAdminSession();
      await seedSubscription(session, { planId: PRICE_ID });
      stubProductLookup();
      stripeMock.subscriptions.retrieve.mockResolvedValueOnce(
        stripeSubscriptionWithInvoice(),
      );
      stripeMock.subscriptions.update.mockResolvedValueOnce(
        stripeSubscriptionWithInvoice("pi_requires_action", {
          id: SUBSCRIPTION_ID,
          latest_invoice: {
            payment_intent: { client_secret: "pi_secret_3ds" },
          },
        }),
      );

      const res = await postChangeSubscription(app, session, {
        newPriceId: NEW_PRICE_ID,
      });

      expect(res.status).toBe(200);
      expect(res.body.data.clientSecret).toBe("pi_secret_3ds");
    });

    it("returns 400 when the payment method is declined mid-change", async () => {
      const session = await createBillingAdminSession();
      await seedSubscription(session, { planId: PRICE_ID });
      stubProductLookup();
      stripeMock.subscriptions.retrieve.mockResolvedValueOnce(
        stripeSubscriptionWithInvoice(),
      );
      stripeMock.subscriptions.update.mockResolvedValueOnce(
        stripeSubscriptionWithInvoice("pi_requires_payment_method", {
          id: SUBSCRIPTION_ID,
        }),
      );

      const res = await postChangeSubscription(app, session, {
        newPriceId: NEW_PRICE_ID,
      });

      expect(res.status).toBe(400);
      expect(res.body.message).toBe(
        "Payment failed. Please update your payment method.",
      );
    });

    it("returns 400 when Stripe rejects the update outright", async () => {
      const session = await createBillingAdminSession();
      await seedSubscription(session, { planId: PRICE_ID });
      stubProductLookup();
      stripeMock.subscriptions.retrieve.mockRejectedValueOnce(
        new Error("No such subscription"),
      );

      const res = await postChangeSubscription(app, session, {
        newPriceId: NEW_PRICE_ID,
      });

      expect(res.status).toBe(400);
      expect(res.body.message).toBe("No such subscription");
    });
  });

  describe("incomplete subscription rows", () => {
    /**
     * A webhook whose event carried no plan product writes a live row with no
     * productId. Reading that as "no plan" opens a second paid subscription
     * next to the one still billing.
     */
    it("changes the existing plan rather than opening a second subscription", async () => {
      const session = await createBillingAdminSession();
      await seedSubscription(session, {
        planId: PRICE_ID,
        productId: undefined,
      });
      stripeMock.subscriptions.retrieve.mockResolvedValueOnce(
        stripeSubscriptionWithInvoice(),
      );
      stripeMock.subscriptions.update.mockResolvedValueOnce(
        stripeSubscriptionWithInvoice("invoice_paid", { id: SUBSCRIPTION_ID }),
      );

      const res = await postChangeSubscription(app, session, {
        newPriceId: NEW_PRICE_ID,
      });

      expect(res.status).toBe(200);
      expect(res.body.message).toBe(SUBSCRIPTION_MESSAGES.SUBSCRIPTION_CHANGED);
      expect(stripeMock.subscriptions.create).not.toHaveBeenCalled();
    });

    it("returns 409 when the row carries no Stripe subscription id", async () => {
      const session = await createBillingAdminSession();
      await seedSubscription(session, {
        planId: PRICE_ID,
        stripeSubscriptionId: undefined,
      });
      stubProductLookup();

      const res = await postChangeSubscription(app, session, {
        newPriceId: NEW_PRICE_ID,
      });

      expect(res.status).toBe(409);
      expect(res.body.message).toBe(
        SUBSCRIPTION_MESSAGES.SUBSCRIPTION_NOT_CHANGEABLE,
      );
      expect(stripeMock.subscriptions.create).not.toHaveBeenCalled();
    });
  });

  describe("a pending cancellation", () => {
    it("returns 409 when the local row has a cancellation pending", async () => {
      const session = await createBillingAdminSession();
      await seedSubscription(session, {
        planId: PRICE_ID,
        subscriptionCancellationRequested: true,
      });
      stubProductLookup();

      const res = await postChangeSubscription(app, session, {
        newPriceId: NEW_PRICE_ID,
      });

      expect(res.status).toBe(409);
      expect(res.body.message).toBe(SUBSCRIPTION_MESSAGES.CANCELLATION_PENDING);
      expect(stripeMock.subscriptions.update).not.toHaveBeenCalled();
      expect(stripeMock.subscriptions.create).not.toHaveBeenCalled();
    });

    it("returns 409 when only Stripe knows the cancellation is pending", async () => {
      const session = await createBillingAdminSession();
      stripeMock.subscriptions.list.mockResolvedValueOnce({
        data: [
          {
            id: "sub_live",
            status: "active",
            cancel_at_period_end: true,
            items: { data: [{ price: { id: PRICE_ID } }] },
          },
        ],
      });

      const res = await postChangeSubscription(app, session, {
        newPriceId: NEW_PRICE_ID,
      });

      expect(res.status).toBe(409);
      expect(res.body.message).toBe(SUBSCRIPTION_MESSAGES.CANCELLATION_PENDING);
      expect(stripeMock.subscriptions.update).not.toHaveBeenCalled();
      expect(stripeMock.subscriptions.create).not.toHaveBeenCalled();
    });

    it("allows a change once no cancellation is pending", async () => {
      const session = await createBillingAdminSession();
      await seedSubscription(session, {
        planId: PRICE_ID,
        subscriptionCancellationRequested: false,
      });
      stubProductLookup();
      stripeMock.subscriptions.retrieve.mockResolvedValueOnce(
        stripeSubscriptionWithInvoice(),
      );
      stripeMock.subscriptions.update.mockResolvedValueOnce(
        stripeSubscriptionWithInvoice("invoice_paid", { id: SUBSCRIPTION_ID }),
      );

      const res = await postChangeSubscription(app, session, {
        newPriceId: NEW_PRICE_ID,
      });

      expect(res.status).toBe(200);
      expect(res.body.message).toBe(SUBSCRIPTION_MESSAGES.SUBSCRIPTION_CHANGED);
    });
  });

  describe("validation errors", () => {
    it("returns 400 when newPriceId is missing", async () => {
      const session = await createBillingAdminSession();

      const res = await postChangeSubscription(app, session, {});

      expect(res.status).toBe(400);
      expect(stripeMock.subscriptions.create).not.toHaveBeenCalled();
    });
  });
});
