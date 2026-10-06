import { createApp } from "@/app";
import { StripePaymentCustomer } from "@/db/models/stripePayment/customer";
import { StripePaymentTransactions } from "@/db/models/stripePayment/transactions";
import { stripePaymentHelper } from "@/modules/stripe-payment/helpers/stripe-payment.helper";
import {
  createProductsOnlySession,
  postCreateCheckoutSession,
} from "@/modules/stripe-payment/__tests__/helpers/stripe-payment-endpoint.helper";
import {
  CHECKOUT_SESSION_ID,
  CUSTOMER_ID,
  PRODUCT_PRICE,
  PRODUCT_PRICE_IN_CENTS,
  STRIPE_PAYMENT_PATH,
} from "@/modules/stripe-payment/__tests__/utils/stripe-payment.constant";
import { PAYMENT_STATUS } from "@/providers/payment/stripe/stripe.types";
import { stripeMock } from "@/tests/mocks/stripe.mock";
import { createAdminSession, createUserSession } from "@/tests/utils/auth";
import {
  seedStripePaymentCustomer,
  seedStripePaymentProduct,
} from "@/tests/utils/payment-factories";
import mongoose from "mongoose";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

/** POST /api/stripe-payment/create-checkout-session */

describe("POST /api/stripe-payment/create-checkout-session", () => {
  const app = createApp();

  const stripeSession = {
    id: CHECKOUT_SESSION_ID,
    client_secret: "cs_test_default_secret_abc",
  };

  describe("success", () => {
    it("returns the client secret and session id", async () => {
      const session = await createAdminSession();
      const product = await seedStripePaymentProduct(session);
      await seedStripePaymentCustomer(session);
      stripeMock.checkout.sessions.create.mockResolvedValueOnce(stripeSession);

      const res = await postCreateCheckoutSession(app, session, {
        productId: product._id.toString(),
      });

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({
        clientSecret: "cs_test_default_secret_abc",
        sessionId: CHECKOUT_SESSION_ID,
      });
    });

    it("records a pending transaction for the new session", async () => {
      const session = await createAdminSession();
      const product = await seedStripePaymentProduct(session);
      await seedStripePaymentCustomer(session);
      stripeMock.checkout.sessions.create.mockResolvedValueOnce(stripeSession);

      await postCreateCheckoutSession(app, session, {
        productId: product._id.toString(),
      });

      const transaction = await StripePaymentTransactions.findOne({
        stripeCheckoutSessionId: CHECKOUT_SESSION_ID,
      });
      expect(transaction?.paymentStatus).toBe(PAYMENT_STATUS.PENDING);
      expect(transaction?.userRef.toString()).toBe(session.user._id.toString());
      expect(transaction?.productRef?.toString()).toBe(product._id.toString());
    });
  });

  describe("business scenarios", () => {
    it("creates a Stripe customer for a first-time buyer", async () => {
      const session = await createAdminSession();
      const product = await seedStripePaymentProduct(session);
      stripeMock.customers.create.mockResolvedValueOnce({ id: "cus_test_new" });
      stripeMock.checkout.sessions.create.mockResolvedValueOnce(stripeSession);

      const res = await postCreateCheckoutSession(app, session, {
        productId: product._id.toString(),
      });

      expect(res.status).toBe(200);
      expect(stripeMock.customers.create).toHaveBeenCalledWith({
        name: `${session.user.name.first} ${session.user.name.last}`,
        email: session.user.email,
      });

      const customer = await StripePaymentCustomer.findOne({
        userRef: session.user._id,
      });
      expect(customer?.stripeCustomerId).toBe("cus_test_new");
    });

    it("reuses an existing Stripe customer", async () => {
      const session = await createAdminSession();
      const product = await seedStripePaymentProduct(session);
      await seedStripePaymentCustomer(session);
      stripeMock.checkout.sessions.create.mockResolvedValueOnce(stripeSession);

      await postCreateCheckoutSession(app, session, {
        productId: product._id.toString(),
      });

      expect(stripeMock.customers.create).not.toHaveBeenCalled();
      expect(await StripePaymentCustomer.countDocuments()).toBe(1);
    });
  });

  describe("server errors", () => {
    it("records no transaction when Stripe rejects the session", async () => {
      const session = await createAdminSession();
      const product = await seedStripePaymentProduct(session);
      await seedStripePaymentCustomer(session);
      stripeMock.checkout.sessions.create.mockRejectedValueOnce(
        new Error("connection reset"),
      );

      const res = await postCreateCheckoutSession(app, session, {
        productId: product._id.toString(),
      });

      expect(res.status).toBe(500);
      expect(await StripePaymentTransactions.countDocuments()).toBe(0);
    });
  });

  describe("validation errors", () => {
    it("returns 400 for a product that does not exist", async () => {
      const session = await createAdminSession();

      const res = await postCreateCheckoutSession(app, session, {
        productId: new mongoose.Types.ObjectId().toString(),
      });

      expect(res.status).toBe(400);
      expect(stripeMock.checkout.sessions.create).not.toHaveBeenCalled();
    });

    it("returns 400 when productId is missing", async () => {
      const session = await createAdminSession();

      const res = await postCreateCheckoutSession(app, session, {});

      expect(res.status).toBe(400);
    });
  });

  describe("auth errors", () => {
    it("returns 401 when unauthenticated", async () => {
      const res = await request(app)
        .post(`${STRIPE_PAYMENT_PATH}/create-checkout-session`)
        .set("Accept", "application/json")
        .send({ productId: new mongoose.Types.ObjectId().toString() });

      expect(res.status).toBe(401);
    });

    it("returns 403 for a principal without products:view", async () => {
      const session = await createUserSession();
      const product = await seedStripePaymentProduct(session);

      const res = await postCreateCheckoutSession(app, session, {
        productId: product._id.toString(),
      });

      expect(res.status).toBe(403);
    });

    // The fix is a permission rename, so this assertion has to follow it.
    it("KNOWN BUG: a read-only products:view principal can start a payment", async () => {
      const session = await createProductsOnlySession();
      const product = await seedStripePaymentProduct(session);
      await seedStripePaymentCustomer(session);
      stripeMock.checkout.sessions.create.mockResolvedValueOnce(stripeSession);

      const res = await postCreateCheckoutSession(app, session, {
        productId: product._id.toString(),
      });

      expect(res.status).toBe(200);
    });
  });
});
