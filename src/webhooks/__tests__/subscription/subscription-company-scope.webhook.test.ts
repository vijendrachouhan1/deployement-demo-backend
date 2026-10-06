import { createApp } from "@/app";
import { Company } from "@/db/models/company";
import { Subscription } from "@/db/models/subscription";
import { STRIPE_SUBSCRIPTION_STATUS } from "@/modules/subscription/utils/subscription.enum";
import {
  createCompanylessWebhookUser,
  createWebhookUser,
  subscriptionDeletedEvent,
  subscriptionUpdatedEvent,
} from "@/webhooks/__tests__/subscription/helpers/subscription-event.helper";
import { seedSubscription } from "@/tests/utils/payment-factories";
import { postStripeWebhook } from "@/tests/utils/stripe-webhook";
import { describe, expect, it } from "vitest";

/**
 * POST /webhook/subscription — which Company row the handler writes, and when
 *
 * Two separate ways the company pointer goes wrong. A customer with no
 * companyRef cannot be recorded at all, because Subscription.companyRef is
 * required — left alone the create throws, the handler answers 400, and Stripe
 * retries an event that can never succeed. And the delete branch clears the
 * pointer for any deletion at all, including one for a subscription the
 * company already moved off; cleanupIncompleteSubscriptions emits exactly that
 * on every create and every free-to-paid change, so a late-arriving delete
 * event revokes access the customer is paying for.
 */

describe("subscription webhook — company scope", () => {
  const app = createApp();
  const post = (event: unknown) =>
    postStripeWebhook(app, "/webhook/subscription", event);

  describe("a customer with no company", () => {
    it("records no subscription row it cannot scope to a company", async () => {
      await createCompanylessWebhookUser();

      await post(subscriptionUpdatedEvent({ id: "sub_orphan" }));

      expect(
        await Subscription.findOne({ stripeSubscriptionId: "sub_orphan" }),
      ).toBeNull();
    });

    // The create can never succeed for this customer, so a 400 would put
    // Stripe into a retry loop with no exit.
    it("acknowledges the event rather than leaving Stripe to retry it", async () => {
      await createCompanylessWebhookUser();

      const res = await post(subscriptionUpdatedEvent({ id: "sub_orphan" }));

      expect(res.status).toBe(200);
    });

    it("leaves every other company's pointer alone", async () => {
      const bystander = await createWebhookUser("cus_bystander");
      const live = await seedSubscription(bystander);
      await Company.findByIdAndUpdate(bystander.company._id, {
        subscriptionRef: live._id,
      });
      await createCompanylessWebhookUser();

      await post(subscriptionUpdatedEvent({ id: "sub_orphan" }));
      await post(subscriptionDeletedEvent({ id: "sub_orphan" }));

      const company = await Company.findById(bystander.company._id);
      expect(company?.subscriptionRef?.toString()).toBe(live._id.toString());
    });
  });

  describe("deletion of a subscription the company has already moved off", () => {
    it("keeps the pointer to the live subscription", async () => {
      const session = await createWebhookUser();
      const live = await seedSubscription(session, {
        stripeSubscriptionId: "sub_live",
      });
      await seedSubscription(session, {
        stripeSubscriptionId: "sub_incomplete_cleaned_up",
      });
      await Company.findByIdAndUpdate(session.company._id, {
        subscriptionRef: live._id,
      });

      const res = await post(
        subscriptionDeletedEvent({ id: "sub_incomplete_cleaned_up" }),
      );

      expect(res.status).toBe(200);
      const company = await Company.findById(session.company._id);
      expect(company?.subscriptionRef?.toString()).toBe(live._id.toString());
    });

    it("still deactivates the deleted row", async () => {
      const session = await createWebhookUser();
      const live = await seedSubscription(session, {
        stripeSubscriptionId: "sub_live",
      });
      await seedSubscription(session, {
        stripeSubscriptionId: "sub_incomplete_cleaned_up",
      });
      await Company.findByIdAndUpdate(session.company._id, {
        subscriptionRef: live._id,
      });

      await post(subscriptionDeletedEvent({ id: "sub_incomplete_cleaned_up" }));

      const row = await Subscription.findOne({
        stripeSubscriptionId: "sub_incomplete_cleaned_up",
      });
      expect(row?.status).toBe(STRIPE_SUBSCRIPTION_STATUS.INACTIVE);
    });

    it("clears the pointer when the deleted subscription is the referenced one", async () => {
      const session = await createWebhookUser();
      const live = await seedSubscription(session, {
        stripeSubscriptionId: "sub_live",
      });
      await Company.findByIdAndUpdate(session.company._id, {
        subscriptionRef: live._id,
      });

      await post(subscriptionDeletedEvent({ id: "sub_live" }));

      const company = await Company.findById(session.company._id);
      expect(company?.subscriptionRef ?? null).toBeNull();
    });
  });
});
