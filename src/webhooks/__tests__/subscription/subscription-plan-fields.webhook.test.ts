import { createApp } from "@/app";
import { Subscription } from "@/db/models/subscription";
import {
  createWebhookUser,
  subscriptionUpdatedEvent,
} from "@/webhooks/__tests__/subscription/helpers/subscription-event.helper";
import { seedSubscription } from "@/tests/utils/payment-factories";
import { postStripeWebhook } from "@/tests/utils/stripe-webhook";
import { describe, expect, it, vi } from "vitest";

/**
 * POST /webhook/subscription — deriving plan fields from the event
 *
 * Stripe only populates the top-level `plan` when a subscription has exactly
 * one item; add a second and it comes through as null. `price` is required on
 * the model, so reading it from `plan` alone turns a perfectly ordinary
 * multi-item subscription into a create that throws, a 400 back to Stripe, and
 * an event Stripe then retries on its own schedule for days.
 */

describe("subscription webhook — plan fields", () => {
  const app = createApp();
  const post = (event: unknown) =>
    postStripeWebhook(app, "/webhook/subscription", event);

  const multiItemEvent = (id: string) =>
    subscriptionUpdatedEvent({ id, plan: null });

  it("creates the row for a subscription whose top-level plan is null", async () => {
    await createWebhookUser();

    const res = await post(multiItemEvent("sub_multi_item"));

    expect(res.status).toBe(200);
    const created = await Subscription.findOne({
      stripeSubscriptionId: "sub_multi_item",
    });
    expect(created).not.toBeNull();
  });

  it("takes the price from the first subscription item", async () => {
    await createWebhookUser();

    await post(multiItemEvent("sub_multi_item"));

    const created = await Subscription.findOne({
      stripeSubscriptionId: "sub_multi_item",
    });
    expect(created?.price).toBe(2900);
  });

  it("updates the price on an existing row from the item", async () => {
    const session = await createWebhookUser();
    await seedSubscription(session, { price: 900 });

    await post(multiItemEvent("sub_test_default"));

    const updated = await Subscription.findOne({
      stripeSubscriptionId: "sub_test_default",
    });
    expect(updated?.price).toBe(2900);
  });

  // changeSubscription compares planId to refuse a re-purchase of the current
  // plan; undefined here means that guard can never fire.
  it("takes the plan id from the first subscription item", async () => {
    await createWebhookUser();

    await post(multiItemEvent("sub_multi_item"));

    const created = await Subscription.findOne({
      stripeSubscriptionId: "sub_multi_item",
    });
    expect(created?.planId).toBe("price_test_pro_monthly");
  });

  // A partial replay can omit `data`. Indexing it directly throws, which the
  // handler turns into a 400 and Stripe retries forever.
  it("survives an items list that arrives without its data array", async () => {
    const session = await createWebhookUser();
    await seedSubscription(session, { price: 900 });

    const res = await post(
      subscriptionUpdatedEvent({
        plan: { amount: 4900, id: "price_pro" },
        items: { data: undefined },
      }),
    );

    expect(res.status).toBe(200);
    const updated = await Subscription.findOne({
      stripeSubscriptionId: "sub_test_default",
    });
    expect(updated?.price).toBe(4900);
  });

  // Tiered and metered prices carry no `plan.amount` at either level, so the
  // required `price` stays unset and the create throws.
  describe("an event that can never be recorded", () => {
    const unpricedEvent = subscriptionUpdatedEvent({
      id: "sub_metered",
      plan: { amount: null, id: "price_metered" },
      items: {
        data: [
          {
            plan: { amount: null, id: "price_metered" },
            current_period_start: 1735689600,
            current_period_end: 1738368000,
          },
        ],
      },
    });

    it("answers 200 rather than asking Stripe to retry", async () => {
      await createWebhookUser();

      const res = await post(unpricedEvent);

      expect(res.status).toBe(200);
    });

    it("records no partial row", async () => {
      await createWebhookUser();

      await post(unpricedEvent);

      const created = await Subscription.findOne({
        stripeSubscriptionId: "sub_metered",
      });
      expect(created).toBeNull();
    });
  });

  // The catch that swallows the case above must not widen into "any failure is
  // unrecordable": Stripe redelivers only on a non-2xx, so a swallowed blip
  // loses a live subscription for good.
  describe("a failure that would improve on redelivery", () => {
    it("asks Stripe to retry when the write fails transiently", async () => {
      await createWebhookUser();
      vi.spyOn(Subscription, "create").mockRejectedValueOnce(
        new Error("connection reset by peer"),
      );

      const res = await post(multiItemEvent("sub_transient"));

      expect(res.status).toBeGreaterThanOrEqual(400);
    });

    it("records no row for the failed write", async () => {
      await createWebhookUser();
      vi.spyOn(Subscription, "create").mockRejectedValueOnce(
        new Error("connection reset by peer"),
      );

      await post(multiItemEvent("sub_transient"));

      const created = await Subscription.findOne({
        stripeSubscriptionId: "sub_transient",
      });
      expect(created).toBeNull();
    });
  });

  it("still prefers the top-level plan when Stripe sends one", async () => {
    await createWebhookUser();

    await post(
      subscriptionUpdatedEvent({
        id: "sub_single_item",
        plan: { amount: 4900 },
      }),
    );

    const created = await Subscription.findOne({
      stripeSubscriptionId: "sub_single_item",
    });
    expect(created?.price).toBe(4900);
  });
});
