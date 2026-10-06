import { createApp } from "@/app";
import { StripeConnectTransactions } from "@/db/models/stripeConnect/transactions";
import {
  createBuyerSession,
  postRefund,
  seedOrderFor,
} from "@/modules/stripe-connect/__tests__/helpers/stripe-connect-endpoint.helper";
import {
  CONNECT_CUSTOMER_ID,
  daysAgo,
  REFUND_WINDOW_DAYS,
} from "@/modules/stripe-connect/__tests__/utils/stripe-connect.constant";
import { TRANSFER_STATUS } from "@/modules/stripe-connect/utils/stripe-connect.enum";
import { PAYMENT_STATUS } from "@/providers/payment/stripe/stripe.types";
import { stripeMock } from "@/tests/mocks/stripe.mock";
import { describe, expect, it } from "vitest";

/**
 * POST /api/stripe-connect/refund/:id — when the order cannot be refunded.
 *
 * Each case used to answer 200 SUCCESS having moved no money.
 */

describe("stripe connect refund — eligibility", () => {
  const app = createApp();

  describe("already refunded", () => {
    it("returns 409 rather than a second refund", async () => {
      const session = await createBuyerSession();
      const order = await seedOrderFor(session, CONNECT_CUSTOMER_ID, {
        refunded: true,
      });

      const res = await postRefund(app, session, order._id.toString());

      expect(res.status).toBe(409);
      expect(stripeMock.refunds.create).not.toHaveBeenCalled();
    });
  });

  describe("charge not settled", () => {
    it("returns 409 when the charge id has not arrived yet", async () => {
      const session = await createBuyerSession();
      const order = await seedOrderFor(session, CONNECT_CUSTOMER_ID, {
        stripeChargeId: undefined,
      });

      const res = await postRefund(app, session, order._id.toString());

      expect(res.status).toBe(409);
      expect(stripeMock.refunds.create).not.toHaveBeenCalled();
    });

    it("does not mark the order refunded", async () => {
      const session = await createBuyerSession();
      const order = await seedOrderFor(session, CONNECT_CUSTOMER_ID, {
        stripeChargeId: undefined,
      });

      await postRefund(app, session, order._id.toString());

      const persisted = await StripeConnectTransactions.findById(order._id);
      expect(persisted?.refunded).toBe(false);
    });
  });

  describe("refund window", () => {
    it("allows a refund on the last day of the window", async () => {
      const session = await createBuyerSession();
      const order = await seedOrderFor(session, CONNECT_CUSTOMER_ID, {
        orderPlacedAt: daysAgo(REFUND_WINDOW_DAYS),
      });
      stripeMock.refunds.create.mockResolvedValueOnce({ id: "re_test_1" });

      const res = await postRefund(app, session, order._id.toString());

      expect(res.status).toBe(200);
    });

    it("returns 409 once the window has passed", async () => {
      const session = await createBuyerSession();
      const order = await seedOrderFor(session, CONNECT_CUSTOMER_ID, {
        orderPlacedAt: daysAgo(REFUND_WINDOW_DAYS + 1),
      });

      const res = await postRefund(app, session, order._id.toString());

      expect(res.status).toBe(409);
      expect(stripeMock.refunds.create).not.toHaveBeenCalled();
    });

    it("leaves an expired order unrefunded", async () => {
      const session = await createBuyerSession();
      const order = await seedOrderFor(session, CONNECT_CUSTOMER_ID, {
        orderPlacedAt: daysAgo(REFUND_WINDOW_DAYS + 1),
      });

      await postRefund(app, session, order._id.toString());

      const persisted = await StripeConnectTransactions.findById(order._id);
      expect(persisted?.refunded).toBe(false);
      expect(persisted?.paymentStatus).not.toBe(PAYMENT_STATUS.REFUNDED);
    });
  });

  // The window floors to whole days but the payout job does not, so day 10.0
  // to 11.0 is a band where the window still says yes after the money has gone.
  describe("payout already sent to the vendor", () => {
    it("returns 409 while the window still reads as open", async () => {
      const session = await createBuyerSession();
      const order = await seedOrderFor(session, CONNECT_CUSTOMER_ID, {
        orderPlacedAt: daysAgo(REFUND_WINDOW_DAYS + 0.5),
        isRefundable: false,
        transferStatus: TRANSFER_STATUS.SUCCEEDED,
      });

      const res = await postRefund(app, session, order._id.toString());

      expect(res.status).toBe(409);
      expect(stripeMock.refunds.create).not.toHaveBeenCalled();
    });

    it("does not mark the order refunded", async () => {
      const session = await createBuyerSession();
      const order = await seedOrderFor(session, CONNECT_CUSTOMER_ID, {
        orderPlacedAt: daysAgo(REFUND_WINDOW_DAYS + 0.5),
        isRefundable: false,
        transferStatus: TRANSFER_STATUS.SUCCEEDED,
      });

      await postRefund(app, session, order._id.toString());

      const persisted = await StripeConnectTransactions.findById(order._id);
      expect(persisted?.refunded).toBe(false);
      expect(persisted?.paymentStatus).not.toBe(PAYMENT_STATUS.REFUNDED);
    });

    it("returns 409 once the job has closed the order, inside the window", async () => {
      const session = await createBuyerSession();
      const order = await seedOrderFor(session, CONNECT_CUSTOMER_ID, {
        isRefundable: false,
      });

      const res = await postRefund(app, session, order._id.toString());

      expect(res.status).toBe(409);
      expect(stripeMock.refunds.create).not.toHaveBeenCalled();
    });
  });

  describe("concurrent requests", () => {
    it("refunds once when the same order is refunded twice at once", async () => {
      const session = await createBuyerSession();
      const order = await seedOrderFor(session);
      stripeMock.refunds.create.mockResolvedValue({ id: "re_test_1" });

      const [first, second] = await Promise.all([
        postRefund(app, session, order._id.toString()),
        postRefund(app, session, order._id.toString()),
      ]);

      expect(stripeMock.refunds.create).toHaveBeenCalledTimes(1);

      const statuses = [first.status, second.status].sort();
      expect(statuses).toEqual([200, 409]);
    });
  });
});
