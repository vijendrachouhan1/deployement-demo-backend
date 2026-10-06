import { createApp } from "@/app";
import { StripeConnectTransactions } from "@/db/models/stripeConnect/transactions";
import {
  createBuyerSession,
  createCustomerlessBuyerSession,
  postRefund,
  seedOrderFor,
} from "@/modules/stripe-connect/__tests__/helpers/stripe-connect-endpoint.helper";
import {
  CHARGE_ID,
  OTHER_CONNECT_CUSTOMER_ID,
  STRIPE_CONNECT_PATH,
} from "@/modules/stripe-connect/__tests__/utils/stripe-connect.constant";
import { PAYMENT_STATUS } from "@/providers/payment/stripe/stripe.types";
import { stripeMock } from "@/tests/mocks/stripe.mock";
import mongoose from "mongoose";
import request from "supertest";
import { describe, expect, it } from "vitest";

/**
 * POST /api/stripe-connect/refund/:id
 *
 * Every buyer holds ORDERS_MANAGE, so the permission gate cannot tell one
 * customer's order from another's. The scope key is the Connect customer id.
 */

describe("POST /api/stripe-connect/refund/:id", () => {
  const app = createApp();

  describe("success", () => {
    it("refunds the charge and marks the order refunded", async () => {
      const session = await createBuyerSession();
      const order = await seedOrderFor(session);
      stripeMock.refunds.create.mockResolvedValueOnce({ id: "re_test_1" });

      const res = await postRefund(app, session, order._id.toString());

      expect(res.status).toBe(200);
      expect(stripeMock.refunds.create).toHaveBeenCalledWith(
        {
          charge: CHARGE_ID,
        },
        { idempotencyKey: `refund_${CHARGE_ID}` },
      );

      const persisted = await StripeConnectTransactions.findById(order._id);
      expect(persisted?.refunded).toBe(true);
      expect(persisted?.paymentStatus).toBe(PAYMENT_STATUS.REFUNDED);
    });

    it("closes the order to further refunds", async () => {
      const session = await createBuyerSession();
      const order = await seedOrderFor(session);
      stripeMock.refunds.create.mockResolvedValueOnce({ id: "re_test_1" });

      await postRefund(app, session, order._id.toString());

      const persisted = await StripeConnectTransactions.findById(order._id);
      expect(persisted?.isRefundable).toBe(false);
    });
  });

  describe("business scenarios", () => {
    it("does not let a buyer refund an order belonging to someone else", async () => {
      const session = await createBuyerSession();
      const order = await seedOrderFor(session, OTHER_CONNECT_CUSTOMER_ID);

      const res = await postRefund(app, session, order._id.toString());

      expect(res.status).toBe(404);
      expect(stripeMock.refunds.create).not.toHaveBeenCalled();
    });

    it("leaves someone else's order untouched", async () => {
      const session = await createBuyerSession();
      const order = await seedOrderFor(session, OTHER_CONNECT_CUSTOMER_ID);

      await postRefund(app, session, order._id.toString());

      const persisted = await StripeConnectTransactions.findById(order._id);
      expect(persisted?.refunded).toBe(false);
      expect(persisted?.paymentStatus).not.toBe(PAYMENT_STATUS.REFUNDED);
    });

    it("returns 404 when the caller has never bought anything", async () => {
      const session = await createCustomerlessBuyerSession();
      const order = await seedOrderFor(session);

      const res = await postRefund(app, session, order._id.toString());

      expect(res.status).toBe(404);
      expect(stripeMock.refunds.create).not.toHaveBeenCalled();
    });

    it("returns 404 for an order that does not exist", async () => {
      const session = await createBuyerSession();

      const res = await postRefund(
        app,
        session,
        new mongoose.Types.ObjectId().toString(),
      );

      expect(res.status).toBe(404);
      expect(stripeMock.refunds.create).not.toHaveBeenCalled();
    });
  });

  describe("validation errors", () => {
    it("returns 400, not 500, for an id that is not an ObjectId", async () => {
      const session = await createBuyerSession();

      const res = await postRefund(app, session, "not-an-object-id");

      expect(res.status).toBe(400);
      expect(stripeMock.refunds.create).not.toHaveBeenCalled();
    });
  });

  describe("server errors", () => {
    it("does not report success when Stripe rejects the refund", async () => {
      const session = await createBuyerSession();
      const order = await seedOrderFor(session);
      stripeMock.refunds.create.mockRejectedValueOnce(
        new Error("Stripe is down"),
      );

      const res = await postRefund(app, session, order._id.toString());

      expect(res.status).toBeGreaterThanOrEqual(400);
    });

    it("leaves the order refundable when Stripe rejects the refund", async () => {
      const session = await createBuyerSession();
      const order = await seedOrderFor(session);
      stripeMock.refunds.create.mockRejectedValueOnce(
        new Error("Stripe is down"),
      );

      await postRefund(app, session, order._id.toString());

      const persisted = await StripeConnectTransactions.findById(order._id);
      expect(persisted?.refunded).toBe(false);
      expect(persisted?.isRefundable).toBe(true);
    });
  });

  describe("auth errors", () => {
    it("returns 401 when unauthenticated", async () => {
      const res = await request(app)
        .post(`${STRIPE_CONNECT_PATH}/refund/${new mongoose.Types.ObjectId()}`)
        .set("Accept", "application/json");

      expect(res.status).toBe(401);
    });
  });
});
