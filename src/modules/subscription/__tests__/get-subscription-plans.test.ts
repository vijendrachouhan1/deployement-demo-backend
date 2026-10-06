import { createApp } from "@/app";
import { createBillingAdminSession } from "@/modules/subscription/__tests__/helpers/subscription-endpoint.helper";
import { ADMIN_SUBSCRIPTION_PATH } from "@/modules/subscription/__tests__/utils/subscription.constant";
import { SUBSCRIPTION_MESSAGES } from "@/modules/subscription/utils/subscription.constant";
import { stripeMock } from "@/tests/mocks/stripe.mock";
import { createUserSession, ITestSession } from "@/tests/utils/auth";
import { seedSubscription } from "@/tests/utils/payment-factories";
import { stripeList, stripePlan } from "@/tests/utils/stripe-samples";
import request from "supertest";
import { describe, expect, it } from "vitest";

/**
 * GET /api/admin/subscription/plans — the Stripe catalogue
 * GET /api/admin/subscription       — the caller company's current plan
 */

describe("GET subscription read endpoints", () => {
  const app = createApp();

  const get = (path: string, session: ITestSession) =>
    request(app)
      .get(path)
      .set("Cookie", session.cookie)
      .set("Accept", "application/json");

  describe("GET /plans", () => {
    it("returns active products with their plans attached", async () => {
      const session = await createBillingAdminSession();
      stripeMock.products.list.mockResolvedValueOnce(
        stripeList([
          { id: "prod_pro", active: true, name: "Pro" },
          { id: "prod_legacy", active: false, name: "Legacy" },
        ]),
      );
      stripeMock.plans.list.mockResolvedValueOnce(
        stripeList([stripePlan({ id: "price_pro_monthly" })]),
      );

      const res = await get(`${ADMIN_SUBSCRIPTION_PATH}/plans`, session);

      expect(res.status).toBe(200);
      expect(res.body.message).toBe(SUBSCRIPTION_MESSAGES.FETCHED_SUCCESS);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0]).toMatchObject({ id: "prod_pro" });
      expect(res.body.data[0].plans[0].id).toBe("price_pro_monthly");
    });

    it("returns an empty list when no product is active", async () => {
      const session = await createBillingAdminSession();
      stripeMock.products.list.mockResolvedValueOnce(
        stripeList([{ id: "prod_legacy", active: false }]),
      );

      const res = await get(`${ADMIN_SUBSCRIPTION_PATH}/plans`, session);

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
      expect(stripeMock.plans.list).not.toHaveBeenCalled();
    });

    it("returns 500 when Stripe rejects the catalogue call", async () => {
      const session = await createBillingAdminSession();
      stripeMock.products.list.mockRejectedValueOnce(
        new Error("Stripe is down"),
      );

      const res = await get(`${ADMIN_SUBSCRIPTION_PATH}/plans`, session);

      expect(res.status).toBe(500);
    });

    it("returns 403 for a principal without subscription:view", async () => {
      const session = await createUserSession();

      const res = await get(`${ADMIN_SUBSCRIPTION_PATH}/plans`, session);

      expect(res.status).toBe(403);
    });
  });

  describe("GET /", () => {
    it("returns the company's current plan merged with Stripe product detail", async () => {
      const session = await createBillingAdminSession();
      await seedSubscription(session);
      stripeMock.products.retrieve.mockResolvedValueOnce({
        id: "prod_test_pro",
        description: "Everything in Pro",
        marketing_features: [{ name: "Unlimited seats" }],
      });

      const res = await get(ADMIN_SUBSCRIPTION_PATH, session);

      expect(res.status).toBe(200);
      expect(res.body.message).toBe(SUBSCRIPTION_MESSAGES.USER_PLANS_SUCCESS);
      expect(res.body.data).toMatchObject({
        planName: "Pro",
        price: 2900,
        period: "month",
        description: "Everything in Pro",
        stripeSubscriptionId: "sub_test_default",
      });
    });

    it("returns null for a company on the free plan", async () => {
      const session = await createBillingAdminSession();

      const res = await get(ADMIN_SUBSCRIPTION_PATH, session);

      expect(res.status).toBe(200);
      expect(res.body.data).toBeNull();
      expect(stripeMock.products.retrieve).not.toHaveBeenCalled();
    });

    it("does not leak another company's subscription", async () => {
      const owner = await createBillingAdminSession();
      await seedSubscription(owner);
      const outsider = await createBillingAdminSession("cus_outsider");

      const res = await get(ADMIN_SUBSCRIPTION_PATH, outsider);

      expect(res.status).toBe(200);
      expect(res.body.data).toBeNull();
    });

    it("returns 403 for a principal without subscription:view", async () => {
      const session = await createUserSession();

      const res = await get(ADMIN_SUBSCRIPTION_PATH, session);

      expect(res.status).toBe(403);
    });
  });
});
