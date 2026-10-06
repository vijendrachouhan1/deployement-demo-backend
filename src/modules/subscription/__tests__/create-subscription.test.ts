import { createApp } from "@/app";
import { User } from "@/db/models/user";
import {
  createBillingAdminSession,
  postCreateSubscription,
} from "@/modules/subscription/__tests__/helpers/subscription-endpoint.helper";
import {
  ADMIN_SUBSCRIPTION_PATH,
  PRICE_ID,
} from "@/modules/subscription/__tests__/utils/subscription.constant";
import { stripeMock } from "@/tests/mocks/stripe.mock";
import { createTestSession, createUserSession } from "@/tests/utils/auth";
import { USER_TYPE } from "@/enums";
import {
  stripeList,
  stripeSubscriptionWithInvoice,
} from "@/tests/utils/stripe-samples";
import request from "supertest";
import { describe, expect, it } from "vitest";

/**
 * POST /api/admin/subscription
 *
 * The response feeds straight into the frontend's confirmCardPayment(), so a
 * failure has to surface as an error status rather than a success body with a
 * missing client secret. The failure paths matter as much as the happy one.
 */

describe("POST /api/admin/subscription — create subscription", () => {
  const app = createApp();

  function stubSuccessfulCreate(clientSecret = "pi_secret_created") {
    stripeMock.subscriptions.list.mockResolvedValueOnce(stripeList([]));
    stripeMock.subscriptions.create.mockResolvedValueOnce(
      stripeSubscriptionWithInvoice("pi_succeeded", {
        id: "sub_created",
        latest_invoice: { payment_intent: { client_secret: clientSecret } },
      }),
    );
  }

  describe("success", () => {
    it("returns the subscription id and client secret", async () => {
      const session = await createBillingAdminSession();
      stubSuccessfulCreate();

      const res = await postCreateSubscription(app, session, {
        priceId: PRICE_ID,
      });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toMatchObject({
        subscriptionId: "sub_created",
        clientSecret: "pi_secret_created",
      });
    });

    it("creates a Stripe customer first when the user has none", async () => {
      const session = await createTestSession(USER_TYPE.ADMIN);
      stripeMock.customers.create.mockResolvedValueOnce({ id: "cus_fresh" });
      stubSuccessfulCreate();

      const res = await postCreateSubscription(app, session, {
        priceId: PRICE_ID,
      });

      expect(res.status).toBe(200);
      expect(res.body.data.stripeCustomerId).toBe("cus_fresh");

      const persisted = await User.findById(session.user._id);
      expect(persisted?.stripeCustomerId).toBe("cus_fresh");
    });
  });

  describe("business scenarios", () => {
    it("cancels leftover incomplete subscriptions before creating the new one", async () => {
      const session = await createBillingAdminSession();
      stripeMock.subscriptions.list.mockResolvedValueOnce(
        stripeList([{ id: "sub_stale", status: "incomplete" }]),
      );
      stripeMock.subscriptions.cancel.mockResolvedValueOnce({
        id: "sub_stale",
        status: "canceled",
      });
      stripeMock.subscriptions.create.mockResolvedValueOnce(
        stripeSubscriptionWithInvoice(),
      );

      const res = await postCreateSubscription(app, session, {
        priceId: PRICE_ID,
      });

      expect(res.status).toBe(200);
      expect(stripeMock.subscriptions.cancel).toHaveBeenCalledWith("sub_stale");
      // Ordering is the point: a create that starts before the cleanup settles
      // can have its own subscription cancelled by the in-flight sweep.
      expect(
        stripeMock.subscriptions.cancel.mock.invocationCallOrder[0],
      ).toBeLessThan(
        stripeMock.subscriptions.create.mock.invocationCallOrder[0],
      );
    });

    it("leaves active subscriptions untouched during cleanup", async () => {
      const session = await createBillingAdminSession();
      stripeMock.subscriptions.list.mockResolvedValueOnce(
        stripeList([{ id: "sub_live", status: "active" }]),
      );
      stripeMock.subscriptions.create.mockResolvedValueOnce(
        stripeSubscriptionWithInvoice(),
      );

      await postCreateSubscription(app, session, { priceId: PRICE_ID });

      expect(stripeMock.subscriptions.cancel).not.toHaveBeenCalled();
    });
  });

  describe("server errors", () => {
    it("returns 402 with the provider message when Stripe rejects", async () => {
      const session = await createBillingAdminSession();
      stripeMock.subscriptions.list.mockResolvedValueOnce(stripeList([]));
      stripeMock.subscriptions.create.mockRejectedValueOnce(
        new Error("Your card was declined."),
      );

      const res = await postCreateSubscription(app, session, {
        priceId: PRICE_ID,
      });

      expect(res.status).toBe(402);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toBe("Your card was declined.");
    });

    it("returns 402 rather than a success carrying no client secret", async () => {
      const session = await createBillingAdminSession();
      stripeMock.subscriptions.list.mockResolvedValueOnce(stripeList([]));
      stripeMock.subscriptions.create.mockResolvedValueOnce(
        stripeSubscriptionWithInvoice("pi_succeeded", {
          latest_invoice: { payment_intent: { client_secret: null } },
        }),
      );

      const res = await postCreateSubscription(app, session, {
        priceId: PRICE_ID,
      });

      expect(res.status).toBe(402);
      expect(res.body.message).toBe("Could not retrieve client secret.");
    });
  });

  describe("validation errors", () => {
    it("returns 400 when priceId is missing", async () => {
      const session = await createBillingAdminSession();

      const res = await postCreateSubscription(app, session, {});

      expect(res.status).toBe(400);
    });

    it("returns 400 when priceId is empty", async () => {
      const session = await createBillingAdminSession();

      const res = await postCreateSubscription(app, session, { priceId: "" });

      expect(res.status).toBe(400);
    });
  });

  describe("auth errors", () => {
    it("returns 401, not 403, when unauthenticated", async () => {
      const res = await request(app)
        .post(ADMIN_SUBSCRIPTION_PATH)
        .set("Accept", "application/json")
        .send({ priceId: PRICE_ID });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it("returns 403 for a principal without subscription:write", async () => {
      const session = await createUserSession();

      const res = await postCreateSubscription(app, session, {
        priceId: PRICE_ID,
      });

      expect(res.status).toBe(403);
    });
  });
});
