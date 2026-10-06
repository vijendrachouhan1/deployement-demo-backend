import { createApp } from "@/app";
import { StripePaymentProducts } from "@/db/models/stripePayment/products";
import {
  getPastOrders,
  getPastOrdersCount,
} from "@/modules/stripe-payment/__tests__/helpers/stripe-payment-endpoint.helper";
import { daysAgo } from "@/modules/stripe-payment/__tests__/utils/stripe-payment.constant";
import {
  DELETED_PRODUCT_NAME,
  REFUND_PERIOD,
} from "@/modules/stripe-payment/utils/stripe-payment.constant";
import { PAYMENT_STATUS } from "@/providers/payment/stripe/stripe.types";
import {
  seedStripePaymentCustomer,
  seedStripePaymentProduct,
  seedStripePaymentTransaction,
} from "@/tests/utils/payment-factories";
import { createAdminSession, ITestSession } from "@/tests/utils/auth";
import { describe, expect, it } from "vitest";

/**
 * GET /api/stripe-payment/orders and /orders/count
 *
 * The buyer's own order history. The list projects `isRefundEligible` — the
 * flag the refund button reads, which must agree with what refundOrder will
 * actually accept, or the button 409s on click.
 */

async function seedBuyer() {
  const session = await createAdminSession();
  await seedStripePaymentCustomer(session);
  return session;
}

async function seedVisibleOrder(
  session: ITestSession,
  overrides: Record<string, unknown> = {},
) {
  const product = await seedStripePaymentProduct(session);
  return seedStripePaymentTransaction(session, {
    productRef: product._id,
    paymentStatus: PAYMENT_STATUS.PAID,
    ...overrides,
  });
}

describe("GET /api/stripe-payment/orders", () => {
  const app = createApp();

  describe("refund eligibility", () => {
    it("offers recovery for a refund requested before the window closed", async () => {
      const session = await seedBuyer();
      await seedVisibleOrder(session, {
        orderPlacedAt: daysAgo(11),
        refundRequestedAt: daysAgo(1),
      });
      const res = await getPastOrders(app, session);
      expect(res.status).toBe(200);
      expect(res.body.data.data[0].isRefundEligible).toBe(true);
    });

    it("offers a refund on a fresh, unrefunded order", async () => {
      const session = await seedBuyer();
      await seedVisibleOrder(session);

      const res = await getPastOrders(app, session);

      expect(res.status).toBe(200);
      expect(res.body.data.data[0].isRefundEligible).toBe(true);
    });

    it("withdraws it once the order is refunded", async () => {
      const session = await seedBuyer();
      await seedVisibleOrder(session, {
        refunded: true,
        paymentStatus: PAYMENT_STATUS.REFUNDED,
      });

      const res = await getPastOrders(app, session);

      expect(res.body.data.data[0].isRefundEligible).toBe(false);
    });

    it("withdraws it while the charge has not settled", async () => {
      const session = await seedBuyer();
      await seedVisibleOrder(session, { stripeChargeId: undefined });

      const res = await getPastOrders(app, session);

      expect(res.body.data.data[0].isRefundEligible).toBe(false);
    });

    it("withdraws it once the window has passed", async () => {
      const session = await seedBuyer();
      await seedVisibleOrder(session, {
        orderPlacedAt: daysAgo(REFUND_PERIOD.ELIGIBILITY_DAYS + 1),
      });

      const res = await getPastOrders(app, session);

      expect(res.body.data.data[0].isRefundEligible).toBe(false);
    });
  });

  /*
   * The product row is gone but the order is not: the buyer may still be
   * inside its refund window, and an order they cannot see is one they
   * cannot refund.
   */
  it("keeps an order whose product was deleted", async () => {
    const session = await seedBuyer();
    const order = await seedVisibleOrder(session);
    await StripePaymentProducts.deleteOne({ _id: order.productRef });

    const res = await getPastOrders(app, session);

    expect(res.body.data.data).toHaveLength(1);
    expect(res.body.data.data[0]._id).toBe(order._id.toString());
    expect(res.body.data.data[0].productName).toBe(DELETED_PRODUCT_NAME);
    expect(res.body.data.data[0].isRefundEligible).toBe(true);
  });
});

describe("GET /api/stripe-payment/orders/count", () => {
  const app = createApp();

  it("still counts an order whose product was deleted", async () => {
    const session = await seedBuyer();
    const order = await seedVisibleOrder(session);
    await StripePaymentProducts.deleteOne({ _id: order.productRef });

    const res = await getPastOrdersCount(app, session);

    // The list and the counters read the same rows; if only one of the two
    // pipelines preserved the order they would disagree with each other.
    expect(res.status).toBe(200);
    expect(res.body.data.allPayments).toBe(1);
    expect(res.body.data.completed).toBe(1);
  });
});
