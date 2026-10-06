import { createApp } from "@/app";
import { Subscription } from "@/db/models/subscription";
import {
  createBillingAdminSession,
  putCancelSubscription,
} from "@/modules/subscription/__tests__/helpers/subscription-endpoint.helper";
import {
  ADMIN_SUBSCRIPTION_PATH,
  SUBSCRIPTION_ID,
} from "@/modules/subscription/__tests__/utils/subscription.constant";
import { stripeMock } from "@/tests/mocks/stripe.mock";
import { createUserSession } from "@/tests/utils/auth";
import { seedSubscription } from "@/tests/utils/payment-factories";
import request from "supertest";
import { describe, expect, it } from "vitest";

/**
 * PUT /api/admin/subscription/cancel
 *
 * The subscription id arrives in the request body, so most of this suite is
 * about ownership: a caller may only cancel a subscription belonging to their
 * own company, and a rejected attempt must reach neither Stripe nor the
 * targeted row.
 */

describe("PUT /api/admin/subscription/cancel", () => {
  const app = createApp();

  describe("success", () => {
    it("cancels at Stripe and flags the caller's own subscription", async () => {
      const session = await createBillingAdminSession();
      const subscription = await seedSubscription(session);
      stripeMock.subscriptions.update.mockResolvedValueOnce({
        id: SUBSCRIPTION_ID,
        cancel_at_period_end: true,
      });

      const res = await putCancelSubscription(app, session, {
        subId: SUBSCRIPTION_ID,
      });

      expect(res.status).toBe(200);
      expect(stripeMock.subscriptions.update).toHaveBeenCalledWith(
        SUBSCRIPTION_ID,
        { cancel_at_period_end: true },
      );

      const persisted = await Subscription.findById(subscription._id);
      expect(persisted?.subscriptionCancellationRequested).toBe(true);
    });
  });

  describe("business scenarios", () => {
    it("returns 404 for a subId belonging to another company", async () => {
      const owner = await createBillingAdminSession();
      await seedSubscription(owner, {
        stripeSubscriptionId: "sub_someone_else",
      });
      const attacker = await createBillingAdminSession("cus_attacker");

      const res = await putCancelSubscription(app, attacker, {
        subId: "sub_someone_else",
      });

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });

    it("never reaches Stripe for a subscription the caller does not own", async () => {
      const owner = await createBillingAdminSession();
      await seedSubscription(owner, {
        stripeSubscriptionId: "sub_someone_else",
      });
      const attacker = await createBillingAdminSession("cus_attacker");

      await putCancelSubscription(app, attacker, {
        subId: "sub_someone_else",
      });

      expect(stripeMock.subscriptions.update).not.toHaveBeenCalled();
    });

    it("leaves the targeted company's row untouched", async () => {
      const owner = await createBillingAdminSession();
      const victim = await seedSubscription(owner, {
        stripeSubscriptionId: "sub_someone_else",
      });
      const attacker = await createBillingAdminSession("cus_attacker");

      await putCancelSubscription(app, attacker, {
        subId: "sub_someone_else",
      });

      const persisted = await Subscription.findById(victim._id);
      expect(persisted?.subscriptionCancellationRequested).toBe(false);
    });

    it("returns 404 when the company has no subscription at all", async () => {
      const session = await createBillingAdminSession();

      const res = await putCancelSubscription(app, session, {
        subId: SUBSCRIPTION_ID,
      });

      expect(res.status).toBe(404);
    });
  });

  describe("server errors", () => {
    it("returns 400 and leaves the row unflagged when Stripe rejects", async () => {
      const session = await createBillingAdminSession();
      const subscription = await seedSubscription(session);
      stripeMock.subscriptions.update.mockRejectedValueOnce(
        new Error("No such subscription"),
      );

      const res = await putCancelSubscription(app, session, {
        subId: SUBSCRIPTION_ID,
      });

      expect(res.status).toBe(400);

      const persisted = await Subscription.findById(subscription._id);
      expect(persisted?.subscriptionCancellationRequested).toBe(false);
    });
  });

  describe("validation errors", () => {
    it("returns 400 when subId is missing", async () => {
      const session = await createBillingAdminSession();

      const res = await putCancelSubscription(app, session, {});

      expect(res.status).toBe(400);
    });
  });

  describe("auth errors", () => {
    it("returns 401, not 403, when unauthenticated", async () => {
      const res = await request(app)
        .put(`${ADMIN_SUBSCRIPTION_PATH}/cancel`)
        .set("Accept", "application/json")
        .send({ subId: SUBSCRIPTION_ID });

      expect(res.status).toBe(401);
    });

    it("returns 403 for a principal without subscription:manage", async () => {
      const session = await createUserSession();

      const res = await putCancelSubscription(app, session, {
        subId: SUBSCRIPTION_ID,
      });

      expect(res.status).toBe(403);
    });
  });
});
