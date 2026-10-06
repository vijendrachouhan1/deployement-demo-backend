import { createApp } from "@/app";
import { StripePaymentTransactions } from "@/db/models/stripePayment/transactions";
import {
  createOrdersOnlySession,
  createShopperSession,
  postRefund,
} from "@/modules/stripe-payment/__tests__/helpers/stripe-payment-endpoint.helper";
import {
  CHARGE_ID,
  daysAgo,
  STRIPE_PAYMENT_PATH,
} from "@/modules/stripe-payment/__tests__/utils/stripe-payment.constant";
import { PAYMENT_STATUS } from "@/providers/payment/stripe/stripe.types";
import { stripeMock } from "@/tests/mocks/stripe.mock";
import {
  createAdminSession,
  createColleagueSession,
  createUserSession,
} from "@/tests/utils/auth";
import { PERMISSIONS, USER_TYPE } from "@/enums";
import { seedStripePaymentTransaction } from "@/tests/utils/payment-factories";
import mongoose from "mongoose";
import request from "supertest";
import { describe, expect, it } from "vitest";

/**
 * POST /api/stripe-payment/refund/:id
 *
 * An order id is the only input, so ownership, the refund window and whether
 * the charge has settled all have to be established here.
 */

describe("POST /api/stripe-payment/refund/:id", () => {
  const app = createApp();

  describe("success", () => {
    it("refunds the charge and marks the order refunded", async () => {
      const session = await createAdminSession();
      const order = await seedStripePaymentTransaction(session);
      stripeMock.refunds.create.mockResolvedValueOnce({ id: "re_test_1" });

      const res = await postRefund(app, session, order._id.toString());

      expect(res.status).toBe(200);
      expect(stripeMock.refunds.create).toHaveBeenCalledWith(
        {
          charge: CHARGE_ID,
        },
        { idempotencyKey: `refund_${CHARGE_ID}` },
      );

      const persisted = await StripePaymentTransactions.findById(order._id);
      expect(persisted?.refunded).toBe(true);
      expect(persisted?.paymentStatus).toBe(PAYMENT_STATUS.REFUNDED);
    });

    it("allows a refund on the last day of the window", async () => {
      const session = await createAdminSession();
      const order = await seedStripePaymentTransaction(session, {
        orderPlacedAt: daysAgo(10),
      });
      stripeMock.refunds.create.mockResolvedValueOnce({ id: "re_test_1" });

      const res = await postRefund(app, session, order._id.toString());

      expect(res.status).toBe(200);
    });
  });

  describe("business scenarios", () => {
    it("returns 404 for an order belonging to another company", async () => {
      const owner = await createAdminSession();
      const order = await seedStripePaymentTransaction(owner);
      const attacker = await createShopperSession();

      const res = await postRefund(app, attacker, order._id.toString());

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });

    it("never reaches Stripe for another company's order", async () => {
      const owner = await createAdminSession();
      const order = await seedStripePaymentTransaction(owner);
      const attacker = await createShopperSession();

      await postRefund(app, attacker, order._id.toString());

      expect(stripeMock.refunds.create).not.toHaveBeenCalled();
    });

    it("leaves the targeted company's order unrefunded", async () => {
      const owner = await createAdminSession();
      const order = await seedStripePaymentTransaction(owner);
      const attacker = await createShopperSession();

      await postRefund(app, attacker, order._id.toString());

      const persisted = await StripePaymentTransactions.findById(order._id);
      expect(persisted?.refunded).toBe(false);
    });

    it("returns 404 for a colleague's order in the same company", async () => {
      const owner = await createAdminSession();
      const order = await seedStripePaymentTransaction(owner);
      const colleague = await createColleagueSession(owner);

      const res = await postRefund(app, colleague, order._id.toString());

      expect(res.status).toBe(404);
      expect(stripeMock.refunds.create).not.toHaveBeenCalled();
    });

    it("leaves a colleague's order unrefunded", async () => {
      const owner = await createAdminSession();
      const order = await seedStripePaymentTransaction(owner);
      const colleague = await createColleagueSession(owner);

      await postRefund(app, colleague, order._id.toString());

      const persisted = await StripePaymentTransactions.findById(order._id);
      expect(persisted?.refunded).toBe(false);
    });

    it("returns 404 for an order id that does not exist", async () => {
      const session = await createAdminSession();

      const res = await postRefund(
        app,
        session,
        new mongoose.Types.ObjectId().toString(),
      );

      expect(res.status).toBe(404);
    });

    it("returns 409 when the order is already refunded", async () => {
      const session = await createAdminSession();
      const order = await seedStripePaymentTransaction(session, {
        refunded: true,
      });

      const res = await postRefund(app, session, order._id.toString());

      expect(res.status).toBe(409);
      expect(stripeMock.refunds.create).not.toHaveBeenCalled();
    });

    it("returns 409 once the refund window has closed", async () => {
      const session = await createAdminSession();
      const order = await seedStripePaymentTransaction(session, {
        orderPlacedAt: daysAgo(11),
      });

      const res = await postRefund(app, session, order._id.toString());

      expect(res.status).toBe(409);
      expect(stripeMock.refunds.create).not.toHaveBeenCalled();
    });

    it("returns 409 when the charge has not settled yet", async () => {
      const session = await createAdminSession();
      const order = await seedStripePaymentTransaction(session, {
        stripeChargeId: undefined,
      });

      const res = await postRefund(app, session, order._id.toString());

      expect(res.status).toBe(409);
      expect(stripeMock.refunds.create).not.toHaveBeenCalled();
    });

    it("returns 409 when the order was never completed", async () => {
      const session = await createAdminSession();
      const order = await seedStripePaymentTransaction(session, {
        orderPlacedAt: undefined,
      });

      const res = await postRefund(app, session, order._id.toString());

      expect(res.status).toBe(409);
    });
  });

  describe("server errors", () => {
    it("leaves the order unrefunded when Stripe rejects", async () => {
      const session = await createAdminSession();
      const order = await seedStripePaymentTransaction(session);
      stripeMock.refunds.create.mockRejectedValueOnce(
        new Error("charge already refunded"),
      );

      const res = await postRefund(app, session, order._id.toString());

      expect(res.status).toBe(500);

      const persisted = await StripePaymentTransactions.findById(order._id);
      expect(persisted?.refunded).toBe(false);
      expect(persisted?.paymentStatus).toBe(PAYMENT_STATUS.PENDING);
    });
  });

  describe("auth errors", () => {
    it("returns 401 when unauthenticated", async () => {
      const res = await request(app)
        .post(`${STRIPE_PAYMENT_PATH}/refund/${new mongoose.Types.ObjectId()}`)
        .set("Accept", "application/json")
        .send();

      expect(res.status).toBe(401);
    });

    it("returns 403 for a principal without my-orders:view", async () => {
      const session = await createUserSession();
      const order = await seedStripePaymentTransaction(session);

      const res = await postRefund(app, session, order._id.toString());

      expect(res.status).toBe(403);
    });

    it("accepts a principal holding only my-orders:view, on its own order", async () => {
      const session = await createOrdersOnlySession();
      const order = await seedStripePaymentTransaction(session);
      stripeMock.refunds.create.mockResolvedValueOnce({ id: "re_test_1" });

      const res = await postRefund(app, session, order._id.toString());

      expect(res.status).toBe(200);
    });

    it("still refuses that principal someone else's order", async () => {
      const owner = await createAdminSession();
      const order = await seedStripePaymentTransaction(owner);
      const colleague = await createColleagueSession(owner, USER_TYPE.ADMIN, [
        PERMISSIONS.STRIPE_PAYMENT_ORDERS_VIEW,
      ]);

      const res = await postRefund(app, colleague, order._id.toString());

      expect(res.status).toBe(404);
    });
  });
});
