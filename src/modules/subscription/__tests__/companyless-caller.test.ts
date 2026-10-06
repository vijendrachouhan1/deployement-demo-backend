import { createApp } from "@/app";
import {
  createCompanylessBillingSession,
  getUserPlans,
  postChangeSubscription,
  postCreateSubscription,
  putCancelSubscription,
} from "@/modules/subscription/__tests__/helpers/subscription-endpoint.helper";
import {
  NEW_PRICE_ID,
  PRICE_ID,
  SUBSCRIPTION_ID,
} from "@/modules/subscription/__tests__/utils/subscription.constant";
import { stripeMock } from "@/tests/mocks/stripe.mock";
import { describe, expect, it } from "vitest";

/**
 * Every company-scoped subscription endpoint, called by a principal that has
 * no company.
 *
 * companyRef is optional on User — phone-OTP login (otp.helper.ts) creates
 * users without one — but required on Subscription. Such a caller therefore
 * cannot have a subscription row, and cannot be given one: the webhook's
 * create throws on the missing companyRef. The purchase endpoints are the
 * sharp end of that. Nothing stops them reaching Stripe, so the caller is
 * charged for a subscription no webhook can ever record, and the events for
 * it 400 back to Stripe on every retry.
 *
 * These endpoints refuse the caller instead.
 */

describe("subscription endpoints — caller with no company", () => {
  const app = createApp();

  describe("POST /api/admin/subscription", () => {
    it("refuses rather than charging for an unrecordable subscription", async () => {
      const caller = await createCompanylessBillingSession("cus_no_company");

      const res = await postCreateSubscription(app, caller, {
        priceId: PRICE_ID,
      });

      expect(res.status).toBe(403);
    });

    it("never reaches Stripe", async () => {
      const caller = await createCompanylessBillingSession("cus_no_company");

      await postCreateSubscription(app, caller, { priceId: PRICE_ID });

      expect(stripeMock.subscriptions.create).not.toHaveBeenCalled();
    });
  });

  describe("POST /api/admin/subscription/plans", () => {
    it("refuses rather than reading the caller as a free-plan upgrade", async () => {
      const caller = await createCompanylessBillingSession("cus_no_company");

      const res = await postChangeSubscription(app, caller, {
        newPriceId: NEW_PRICE_ID,
      });

      expect(res.status).toBe(403);
    });

    it("neither creates nor updates a subscription at Stripe", async () => {
      const caller = await createCompanylessBillingSession("cus_no_company");

      await postChangeSubscription(app, caller, { newPriceId: NEW_PRICE_ID });

      expect(stripeMock.subscriptions.create).not.toHaveBeenCalled();
      expect(stripeMock.subscriptions.update).not.toHaveBeenCalled();
    });
  });

  describe("GET /api/admin/subscription", () => {
    it("refuses instead of answering 200 with no plan", async () => {
      const caller = await createCompanylessBillingSession("cus_no_company");

      const res = await getUserPlans(app, caller);

      expect(res.status).toBe(403);
    });
  });

  describe("PUT /api/admin/subscription/cancel", () => {
    it("refuses instead of reporting the subscription missing", async () => {
      const caller = await createCompanylessBillingSession("cus_no_company");

      const res = await putCancelSubscription(app, caller, {
        subId: SUBSCRIPTION_ID,
      });

      expect(res.status).toBe(403);
    });

    it("never reaches Stripe", async () => {
      const caller = await createCompanylessBillingSession("cus_no_company");

      await putCancelSubscription(app, caller, { subId: SUBSCRIPTION_ID });

      expect(stripeMock.subscriptions.update).not.toHaveBeenCalled();
    });
  });
});
