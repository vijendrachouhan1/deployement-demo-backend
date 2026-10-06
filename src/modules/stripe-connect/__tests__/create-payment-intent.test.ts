import { createApp } from "@/app";
import { StripeConnectCustomer } from "@/db/models/stripeConnect/customer";
import { StripeConnectTransactions } from "@/db/models/stripeConnect/transactions";
import {
  createBuyerSession,
  createCompanylessBuyerSession,
  createCustomerlessBuyerSession,
  postPaymentIntent,
  seedProductFor,
} from "@/modules/stripe-connect/__tests__/helpers/stripe-connect-endpoint.helper";
import {
  CONNECT_CUSTOMER_ID,
  STRIPE_CONNECT_PATH,
  VENDOR_ACCOUNT_ID,
} from "@/modules/stripe-connect/__tests__/utils/stripe-connect.constant";
import { stripeMock } from "@/tests/mocks/stripe.mock";
import mongoose from "mongoose";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";

/**
 * POST /api/stripe-connect/create-payment-intent
 *
 * The money-moving end of the buyer path: it resolves (or creates) the caller's
 * Connect customer, asks Stripe for an intent, and writes the local order the
 * webhook later completes and `pastOrders` reads back.
 */

const PAYMENT_INTENT = { id: "pi_test_new", client_secret: "pi_secret_new" };

describe("POST /api/stripe-connect/create-payment-intent", () => {
  const app = createApp();

  beforeEach(() => {
    stripeMock.paymentIntents.create.mockResolvedValue(PAYMENT_INTENT);
  });

  describe("success", () => {
    it("returns the client secret and intent id", async () => {
      const session = await createBuyerSession();
      const product = await seedProductFor(session);

      const res = await postPaymentIntent(app, session, {
        productId: product._id.toString(),
      });

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({
        clientSecret: PAYMENT_INTENT.client_secret,
        paymentIntentId: PAYMENT_INTENT.id,
      });
    });

    it("bills the caller's own Connect customer", async () => {
      const session = await createBuyerSession();
      const product = await seedProductFor(session, { price: 50 });

      await postPaymentIntent(app, session, {
        productId: product._id.toString(),
      });

      expect(stripeMock.paymentIntents.create).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: 5000,
          currency: "usd",
          customer: CONNECT_CUSTOMER_ID,
        }),
      );
    });

    /*
     * 19.99 * 100 is 1998.9999999999998 in binary floating point, and Stripe
     * rejects a non-integer amount — so this price could never be purchased.
     */
    it("sends whole cents for a price a float cannot hold exactly", async () => {
      const session = await createBuyerSession();
      const product = await seedProductFor(session, { price: 19.99 });

      await postPaymentIntent(app, session, {
        productId: product._id.toString(),
      });

      const { amount } = stripeMock.paymentIntents.create.mock.calls[0][0];
      expect(amount).toBe(1999);
      expect(Number.isInteger(amount)).toBe(true);
    });

    it("records the order against the vendor and the intent", async () => {
      const session = await createBuyerSession();
      const product = await seedProductFor(session, { price: 19.99 });

      await postPaymentIntent(app, session, {
        productId: product._id.toString(),
      });

      const order = await StripeConnectTransactions.findOne({
        stripePaymentIntentId: PAYMENT_INTENT.id,
      });
      expect(order?.stripeCustomerId).toBe(CONNECT_CUSTOMER_ID);
      expect(order?.stripeAccountId).toBe(VENDOR_ACCOUNT_ID);
      expect(order?.productRef?.toString()).toBe(product._id.toString());
      // DOLLARS here — the payout job applies the platform fee to this value.
      expect(order?.amountPaid).toBe(19.99);
    });
  });

  describe("business scenarios", () => {
    it("creates the Stripe customer for a first-time buyer and keeps it", async () => {
      const session = await createCustomerlessBuyerSession();
      const product = await seedProductFor(session);
      stripeMock.customers.create.mockResolvedValueOnce({ id: "cus_first" });

      await postPaymentIntent(app, session, {
        productId: product._id.toString(),
      });

      expect(stripeMock.customers.create).toHaveBeenCalledWith({
        name: `${session.user.name.first} ${session.user.name.last}`,
        email: session.user.email,
      });
      const persisted = await StripeConnectCustomer.findOne({
        userRef: session.user._id,
      });
      expect(persisted?.stripeCustomerId).toBe("cus_first");
      expect(stripeMock.paymentIntents.create).toHaveBeenCalledWith(
        expect.objectContaining({ customer: "cus_first" }),
      );
    });

    it("does not invent a second customer for a buyer who has one", async () => {
      const session = await createBuyerSession();
      const product = await seedProductFor(session);

      await postPaymentIntent(app, session, {
        productId: product._id.toString(),
      });

      expect(stripeMock.customers.create).not.toHaveBeenCalled();
      expect(
        await StripeConnectCustomer.countDocuments({
          userRef: session.user._id,
        }),
      ).toBe(1);
    });

    it("settles two concurrent first purchases on one customer", async () => {
      const session = await createCustomerlessBuyerSession();
      const product = await seedProductFor(session);
      stripeMock.customers.create
        .mockResolvedValueOnce({ id: "cus_race_a" })
        .mockResolvedValueOnce({ id: "cus_race_b" });

      await Promise.all([
        postPaymentIntent(app, session, { productId: product._id.toString() }),
        postPaymentIntent(app, session, { productId: product._id.toString() }),
      ]);

      const rows = await StripeConnectCustomer.find({
        userRef: session.user._id,
      });
      expect(rows).toHaveLength(1);
      const orders = await StripeConnectTransactions.find({});
      for (const order of orders) {
        expect(order.stripeCustomerId).toBe(rows[0].stripeCustomerId);
      }
    });
  });

  describe("validation errors", () => {
    it("400s for a product that does not exist, without charging", async () => {
      const session = await createBuyerSession();

      const res = await postPaymentIntent(app, session, {
        productId: new mongoose.Types.ObjectId().toString(),
      });

      expect(res.status).toBe(400);
      expect(stripeMock.paymentIntents.create).not.toHaveBeenCalled();
    });

    it("400s rather than 500s for a productId that is not an ObjectId", async () => {
      const session = await createBuyerSession();

      const res = await postPaymentIntent(app, session, {
        productId: "not-an-objectid",
      });

      expect(res.status).toBe(400);
      expect(stripeMock.paymentIntents.create).not.toHaveBeenCalled();
    });
  });

  describe("auth errors", () => {
    it("refuses a companyless caller rather than charging them", async () => {
      const buyer = await createBuyerSession();
      const product = await seedProductFor(buyer);
      const caller = await createCompanylessBuyerSession();

      const res = await postPaymentIntent(app, caller, {
        productId: product._id.toString(),
      });

      expect(res.status).toBe(403);
      expect(stripeMock.paymentIntents.create).not.toHaveBeenCalled();
      expect(stripeMock.customers.create).not.toHaveBeenCalled();
    });

    it("401s when unauthenticated", async () => {
      const res = await request(app)
        .post(`${STRIPE_CONNECT_PATH}/create-payment-intent`)
        .send({ productId: new mongoose.Types.ObjectId().toString() });

      expect(res.status).toBe(401);
    });
  });
});
