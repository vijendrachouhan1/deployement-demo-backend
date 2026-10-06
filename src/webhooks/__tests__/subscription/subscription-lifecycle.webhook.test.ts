import { createApp } from "@/app";
import { Company } from "@/db/models/company";
import { Subscription } from "@/db/models/subscription";
import { STRIPE_SUBSCRIPTION_STATUS } from "@/modules/subscription/utils/subscription.enum";
import {
  createWebhookUser,
  subscriptionDeletedEvent,
  subscriptionUpdatedEvent,
} from "@/webhooks/__tests__/subscription/helpers/subscription-event.helper";
import { seedSubscription } from "@/tests/utils/payment-factories";
import { stripePlan } from "@/tests/utils/stripe-samples";
import { createTestSession } from "@/tests/utils/auth";
import { postStripeWebhook } from "@/tests/utils/stripe-webhook";
import { describe, expect, it } from "vitest";

/**
 * POST /webhook/subscription — customer.subscription.{updated,deleted}
 *
 * These two events are the only thing keeping local access rights in step with
 * what Stripe believes the customer is paying for, so the cases below walk the
 * whole status vocabulary rather than just the happy "active" path: a status
 * that fails to land here is a customer with access they no longer pay for.
 */

describe("subscription webhook — lifecycle", () => {
  const app = createApp();
  const post = (event: unknown) =>
    postStripeWebhook(app, "/webhook/subscription", event);

  describe("customer.subscription.updated — create path", () => {
    it("creates the local subscription row for a new active subscription", async () => {
      const session = await createWebhookUser();

      const res = await post(subscriptionUpdatedEvent({ id: "sub_brand_new" }));

      expect(res.status).toBe(200);
      const created = await Subscription.findOne({
        stripeSubscriptionId: "sub_brand_new",
      });
      expect(created).not.toBeNull();
      expect(created?.status).toBe(STRIPE_SUBSCRIPTION_STATUS.ACTIVE);
      expect(created?.userRef.toString()).toBe(session.user._id.toString());
      expect(created?.companyRef.toString()).toBe(
        session.company._id.toString(),
      );
    });

    it("links the new subscription to the user's company", async () => {
      const session = await createWebhookUser();

      await post(subscriptionUpdatedEvent({ id: "sub_brand_new" }));

      const created = await Subscription.findOne({
        stripeSubscriptionId: "sub_brand_new",
      });
      const company = await Company.findById(session.company._id);
      expect(company?.subscriptionRef?.toString()).toBe(
        created?._id.toString(),
      );
    });

    it("falls back to 'Unnamed Plan' when no nickname is sent at all", async () => {
      await createWebhookUser();
      const namelessPlan = stripePlan({ nickname: null });
      const namelessItem = {
        current_period_start: 1735689600,
        current_period_end: 1738368000,
        plan: namelessPlan,
        price: namelessPlan,
      };

      await post(
        subscriptionUpdatedEvent({
          id: "sub_nameless",
          plan: { nickname: null },
          items: { data: [namelessItem] },
        }),
      );

      const created = await Subscription.findOne({
        stripeSubscriptionId: "sub_nameless",
      });
      expect(created?.planName).toBe("Unnamed Plan");
    });

    // planName drives the frontend's plan-hierarchy lookup, so "Unnamed Plan"
    // for a multi-item subscription loses the "Current Plan" highlight and
    // renders every paid tier as an upgrade.
    it("takes the plan name from the item when Stripe sends no top-level plan", async () => {
      await createWebhookUser();

      await post(
        subscriptionUpdatedEvent({ id: "sub_multi_named", plan: null }),
      );

      const created = await Subscription.findOne({
        stripeSubscriptionId: "sub_multi_named",
      });
      expect(created?.planName).toBe("Pro");
    });
  });

  describe("customer.subscription.updated — update path", () => {
    it("updates plan fields on an existing row", async () => {
      const session = await createWebhookUser();
      await seedSubscription(session, { planName: "Starter", price: 900 });

      const res = await post(
        subscriptionUpdatedEvent({
          plan: { nickname: "Pro", amount: 2900, id: "price_pro" },
        }),
      );

      expect(res.status).toBe(200);
      const updated = await Subscription.findOne({
        stripeSubscriptionId: "sub_test_default",
      });
      expect(updated?.planName).toBe("Pro");
      expect(updated?.price).toBe(2900);
      expect(updated?.planId).toBe("price_pro");
    });

    it("does not duplicate the row when the same subscription updates twice", async () => {
      const session = await createWebhookUser();
      await seedSubscription(session);

      await post(subscriptionUpdatedEvent());
      await post(subscriptionUpdatedEvent());

      const rows = await Subscription.find({
        stripeSubscriptionId: "sub_test_default",
      });
      expect(rows).toHaveLength(1);
    });
  });

  describe("customer.subscription.updated — non-active statuses", () => {
    it.each([
      ["past_due", STRIPE_SUBSCRIPTION_STATUS.PAST_DUE],
      ["unpaid", STRIPE_SUBSCRIPTION_STATUS.INACTIVE],
      ["canceled", STRIPE_SUBSCRIPTION_STATUS.INACTIVE],
      ["paused", STRIPE_SUBSCRIPTION_STATUS.INACTIVE],
      ["incomplete_expired", STRIPE_SUBSCRIPTION_STATUS.INACTIVE],
    ])("persists Stripe status %s as %s", async (stripeStatus, expected) => {
      const session = await createWebhookUser();
      await seedSubscription(session);

      const res = await post(
        subscriptionUpdatedEvent({ status: stripeStatus }),
      );

      expect(res.status).toBe(200);
      const updated = await Subscription.findOne({
        stripeSubscriptionId: "sub_test_default",
      });
      expect(updated?.status).toBe(expected);
    });

    it("treats trialing as active access", async () => {
      const session = await createWebhookUser();
      await seedSubscription(session);

      await post(subscriptionUpdatedEvent({ status: "trialing" }));

      const updated = await Subscription.findOne({
        stripeSubscriptionId: "sub_test_default",
      });
      expect(updated?.status).toBe(STRIPE_SUBSCRIPTION_STATUS.ACTIVE);
    });

    it("does not invent a row for a non-active status it has never seen", async () => {
      await createWebhookUser();

      const res = await post(
        subscriptionUpdatedEvent({ id: "sub_unknown", status: "canceled" }),
      );

      expect(res.status).toBe(200);
      expect(
        await Subscription.findOne({ stripeSubscriptionId: "sub_unknown" }),
      ).toBeNull();
    });

    it("writes nothing for a status outside Stripe's known set", async () => {
      const session = await createWebhookUser();
      await seedSubscription(session);

      const res = await post(
        subscriptionUpdatedEvent({ status: "some_future_status" }),
      );

      expect(res.status).toBe(200);
      const row = await Subscription.findOne({
        stripeSubscriptionId: "sub_test_default",
      });
      expect(row?.status).toBe(STRIPE_SUBSCRIPTION_STATUS.ACTIVE);
    });
  });

  describe("customer.subscription.deleted", () => {
    it.each([true, false])(
      "deactivates the row when cancel_at_period_end is %s",
      async (cancelAtPeriodEnd) => {
        const session = await createWebhookUser();
        await seedSubscription(session);

        const res = await post(
          subscriptionDeletedEvent({
            cancel_at_period_end: cancelAtPeriodEnd,
          }),
        );

        expect(res.status).toBe(200);
        const row = await Subscription.findOne({
          stripeSubscriptionId: "sub_test_default",
        });
        expect(row?.status).toBe(STRIPE_SUBSCRIPTION_STATUS.INACTIVE);
      },
    );

    it("clears the company's subscription link on deletion", async () => {
      const session = await createWebhookUser();
      const subscription = await seedSubscription(session);
      await Company.findByIdAndUpdate(session.company._id, {
        subscriptionRef: subscription._id,
      });

      await post(subscriptionDeletedEvent({ cancel_at_period_end: false }));

      const company = await Company.findById(session.company._id);
      expect(company?.subscriptionRef ?? null).toBeNull();
    });

    // The user is looked up by Stripe customer id, so their companyRef is not
    // proof of who owns the subscription.
    it("clears the link on the company that owns the row, not the user's current one", async () => {
      const session = await createWebhookUser();
      const owner = await createTestSession();
      const subscription = await seedSubscription({
        userRef: session.user._id,
        companyRef: owner.company._id,
      });
      await Company.findByIdAndUpdate(owner.company._id, {
        subscriptionRef: subscription._id,
      });

      await post(subscriptionDeletedEvent({ cancel_at_period_end: false }));

      const ownerCompany = await Company.findById(owner.company._id);
      expect(ownerCompany?.subscriptionRef ?? null).toBeNull();
    });
  });
});
