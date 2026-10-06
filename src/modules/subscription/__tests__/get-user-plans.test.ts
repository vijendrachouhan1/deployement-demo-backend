import { createApp } from "@/app";
import { STATUS } from "@/enums";
import {
  createBillingAdminSession,
  getUserPlans,
  postChangeSubscription,
} from "@/modules/subscription/__tests__/helpers/subscription-endpoint.helper";
import { NEW_PRICE_ID } from "@/modules/subscription/__tests__/utils/subscription.constant";
import { stripeMock } from "@/tests/mocks/stripe.mock";
import { seedSubscription } from "@/tests/utils/payment-factories";
import { stripeSubscriptionWithInvoice } from "@/tests/utils/stripe-samples";
import { describe, expect, it } from "vitest";

/**
 * GET /api/admin/subscription — the company's current plan
 *
 * The row outlives the subscription: customer.subscription.deleted marks it
 * INACTIVE and leaves it in place, so reading by companyRef alone reports a
 * company that churned as still subscribed. Everything downstream then treats
 * it as a plan change rather than a purchase — no card is collected, and the
 * update is aimed at a subscription Stripe has already ended.
 */

describe("GET /api/admin/subscription — current plan", () => {
  const app = createApp();

  /** findUserPlans() resolves the plan's product before it returns. */
  function stubProductLookup() {
    stripeMock.products.retrieve.mockResolvedValueOnce({
      id: "prod_test_pro",
      description: "Pro plan",
      marketing_features: [],
    });
  }

  it("returns the plan while the subscription is active", async () => {
    const session = await createBillingAdminSession();
    await seedSubscription(session, { status: STATUS.ACTIVE });
    stubProductLookup();

    const res = await getUserPlans(app, session);

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ planName: "Pro" });
  });

  it("reports no plan once the subscription has ended", async () => {
    const session = await createBillingAdminSession();
    await seedSubscription(session, { status: STATUS.INACTIVE });

    const res = await getUserPlans(app, session);

    expect(res.status).toBe(200);
    expect(res.body.data).toBeNull();
  });

  // Dunning is not churn — the subscription still exists at Stripe, and the
  // company should keep seeing what it is behind on paying for.
  it("still reports the plan while the subscription is past due", async () => {
    const session = await createBillingAdminSession();
    await seedSubscription(session, { status: STATUS.PAST_DUE });
    stubProductLookup();

    const res = await getUserPlans(app, session);

    expect(res.body.data).toMatchObject({ planName: "Pro" });
  });

  // The cancel panel in the UI is the only confirmation a cancellation was
  // accepted, and it renders off this field.
  it("reports whether cancellation has been requested", async () => {
    const session = await createBillingAdminSession();
    await seedSubscription(session, {
      subscriptionCancellationRequested: true,
    });
    stubProductLookup();

    const res = await getUserPlans(app, session);

    expect(res.body.data.subscriptionCancellationRequested).toBe(true);
  });

  it("defaults the cancellation flag to false", async () => {
    const session = await createBillingAdminSession();
    await seedSubscription(session);
    stubProductLookup();

    const res = await getUserPlans(app, session);

    expect(res.body.data.subscriptionCancellationRequested).toBe(false);
  });

  it("lets a company that churned subscribe again", async () => {
    const session = await createBillingAdminSession();
    await seedSubscription(session, { status: STATUS.INACTIVE });
    // What churn leaves behind at Stripe: a cancelled subscription, which must
    // not read as a live one and block the new signup.
    stripeMock.subscriptions.list.mockResolvedValueOnce({
      data: [{ id: "sub_churned", status: "canceled" }],
    });
    stripeMock.subscriptions.create.mockResolvedValueOnce(
      stripeSubscriptionWithInvoice("pi_succeeded", { id: "sub_resubscribed" }),
    );

    const res = await postChangeSubscription(app, session, {
      newPriceId: NEW_PRICE_ID,
    });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      subscriptionId: "sub_resubscribed",
      changeType: "upgrade_from_free",
    });
    expect(stripeMock.subscriptions.update).not.toHaveBeenCalled();
  });
});
