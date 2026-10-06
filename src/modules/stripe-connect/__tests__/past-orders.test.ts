import { createApp } from "@/app";
import { StripeConnectProducts } from "@/db/models/stripeConnect/products";
import {
  createBuyerSession,
  createCustomerlessBuyerSession,
  getPastOrders,
  getPastOrdersCount,
  seedOrderFor,
  seedProductFor,
} from "@/modules/stripe-connect/__tests__/helpers/stripe-connect-endpoint.helper";
import {
  daysAgo,
  OTHER_CONNECT_CUSTOMER_ID,
  REFUND_WINDOW_DAYS,
  STRIPE_CONNECT_PATH,
} from "@/modules/stripe-connect/__tests__/utils/stripe-connect.constant";
import { DELETED_PRODUCT_NAME } from "@/modules/stripe-connect/utils/stripe-connect.constant";
import { PAYMENT_STATUS } from "@/providers/payment/stripe/stripe.types";
import request from "supertest";
import { describe, expect, it } from "vitest";

/**
 * GET /api/stripe-connect/past-orders and /past-orders/count
 *
 * The buyer's own order history. Ownership is the Connect customer id, and the
 * list projects `isRefundEligible` — the flag the refund button reads, which
 * must agree with what the refund endpoint will actually accept.
 */

async function seedVisibleOrder(
  session: Awaited<ReturnType<typeof createBuyerSession>>,
  overrides: Record<string, unknown> = {},
) {
  const product = await seedProductFor(session);
  return seedOrderFor(session, undefined, {
    productRef: product._id,
    paymentStatus: PAYMENT_STATUS.PAID,
    ...overrides,
  });
}

describe("GET /api/stripe-connect/past-orders", () => {
  const app = createApp();

  describe("success", () => {
    it("returns the caller's own orders", async () => {
      const session = await createBuyerSession();
      const order = await seedVisibleOrder(session);

      const res = await getPastOrders(app, session);

      expect(res.status).toBe(200);
      expect(res.body.data.data).toHaveLength(1);
      expect(res.body.data.data[0]._id).toBe(order._id.toString());
    });

    it("does not return another buyer's orders", async () => {
      const session = await createBuyerSession();
      await seedVisibleOrder(session, {
        stripeCustomerId: OTHER_CONNECT_CUSTOMER_ID,
      });

      const res = await getPastOrders(app, session);

      expect(res.body.data.data).toHaveLength(0);
    });

    it("hides an order whose payment never completed", async () => {
      const session = await createBuyerSession();
      await seedVisibleOrder(session, {
        paymentStatus: PAYMENT_STATUS.PENDING,
      });

      const res = await getPastOrders(app, session);

      expect(res.body.data.data).toHaveLength(0);
    });
  });

  describe("refund eligibility", () => {
    it("offers a refund on a fresh, unrefunded order", async () => {
      const session = await createBuyerSession();
      await seedVisibleOrder(session);

      const res = await getPastOrders(app, session);

      expect(res.body.data.data[0].isRefundEligible).toBe(true);
    });

    it("withdraws it once the payout has closed the order", async () => {
      const session = await createBuyerSession();
      await seedVisibleOrder(session, { isRefundable: false });

      const res = await getPastOrders(app, session);

      expect(res.body.data.data[0].isRefundEligible).toBe(false);
    });

    it("withdraws it once the order is refunded", async () => {
      const session = await createBuyerSession();
      await seedVisibleOrder(session, {
        refunded: true,
        paymentStatus: PAYMENT_STATUS.REFUNDED,
      });

      const res = await getPastOrders(app, session);

      expect(res.body.data.data[0].isRefundEligible).toBe(false);
    });

    it("withdraws it once the window has passed", async () => {
      const session = await createBuyerSession();
      await seedVisibleOrder(session, {
        orderPlacedAt: daysAgo(REFUND_WINDOW_DAYS + 1),
      });

      const res = await getPastOrders(app, session);

      expect(res.body.data.data[0].isRefundEligible).toBe(false);
    });
  });

  describe("business scenarios", () => {
    it("answers an empty list for a caller who has never bought", async () => {
      const session = await createCustomerlessBuyerSession();

      const res = await getPastOrders(app, session);

      expect(res.status).toBe(200);
      expect(res.body.data.data).toEqual([]);
      expect(res.body.data.pagination.totalCount).toBe(0);
    });

    /*
     * The product row is gone but the order is not: the buyer may still be
     * inside its refund window, and an order they cannot see is one they
     * cannot refund.
     */
    it("keeps an order whose product was deleted", async () => {
      const session = await createBuyerSession();
      const order = await seedVisibleOrder(session);
      await StripeConnectProducts.deleteOne({ _id: order.productRef });

      const res = await getPastOrders(app, session);

      expect(res.body.data.data).toHaveLength(1);
      expect(res.body.data.data[0]._id).toBe(order._id.toString());
      expect(res.body.data.data[0].productName).toBe(DELETED_PRODUCT_NAME);
      expect(res.body.data.data[0].isRefundEligible).toBe(true);
    });
  });

  it("401s when unauthenticated", async () => {
    const res = await request(app).get(`${STRIPE_CONNECT_PATH}/past-orders`);

    expect(res.status).toBe(401);
  });
});

describe("GET /api/stripe-connect/past-orders/count", () => {
  const app = createApp();

  it("counts the caller's completed and refunded orders", async () => {
    const session = await createBuyerSession();
    await seedVisibleOrder(session);
    await seedVisibleOrder(session, {
      refunded: true,
      paymentStatus: PAYMENT_STATUS.REFUNDED,
    });

    const res = await getPastOrdersCount(app, session);

    expect(res.status).toBe(200);
    expect(res.body.data.allPayments).toBe(2);
    expect(res.body.data.completed).toBe(1);
    expect(res.body.data.refunded).toBe(1);
  });

  it("still counts an order whose product was deleted", async () => {
    const session = await createBuyerSession();
    const order = await seedVisibleOrder(session);
    await StripeConnectProducts.deleteOne({ _id: order.productRef });

    const res = await getPastOrdersCount(app, session);

    // The list and the counters read the same rows; if only one of the two
    // pipelines preserved the order they would disagree with each other.
    expect(res.body.data.allPayments).toBe(1);
    expect(res.body.data.completed).toBe(1);
  });

  it("does not count another buyer's orders", async () => {
    const session = await createBuyerSession();
    await seedVisibleOrder(session, {
      stripeCustomerId: OTHER_CONNECT_CUSTOMER_ID,
    });

    const res = await getPastOrdersCount(app, session);

    expect(res.body.data.allPayments).toBe(0);
  });

  /*
   * A count endpoint that answers [] for a first-time caller reads as "no
   * data" to anything doing arithmetic on it.
   */
  it("answers zeroed counts, not an empty list, for a caller with no customer", async () => {
    const session = await createCustomerlessBuyerSession();

    const res = await getPastOrdersCount(app, session);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      allPayments: 0,
      pending: 0,
      completed: 0,
      refunded: 0,
    });
  });

  it("401s when unauthenticated", async () => {
    const res = await request(app).get(
      `${STRIPE_CONNECT_PATH}/past-orders/count`,
    );

    expect(res.status).toBe(401);
  });
});
