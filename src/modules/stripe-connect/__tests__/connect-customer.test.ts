import { createApp } from "@/app";
import { StripeConnectCustomer } from "@/db/models/stripeConnect/customer";
import {
  createBuyerSession,
  createCompanylessBuyerSession,
  createCustomerlessBuyerSession,
  getConnectCustomer,
  postConnectCustomer,
} from "@/modules/stripe-connect/__tests__/helpers/stripe-connect-endpoint.helper";
import {
  CONNECT_CUSTOMER_ID,
  STRIPE_CONNECT_PATH,
} from "@/modules/stripe-connect/__tests__/utils/stripe-connect.constant";
import { stripeMock } from "@/tests/mocks/stripe.mock";
import { seedStripeConnectCustomer } from "@/tests/utils/payment-factories";
import request from "supertest";
import { describe, expect, it } from "vitest";

/**
 * POST and GET /api/stripe-connect/customer
 *
 * The Connect customer row is what every buyer-side lookup keys on — ownership
 * of an order is `stripeCustomerId`, not `userRef`. Two rows for one user, or a
 * row bound to a customer Stripe discarded, and the buyer's orders belong to
 * nobody the app can find.
 */

describe("POST /api/stripe-connect/customer", () => {
  const app = createApp();

  describe("success", () => {
    it("creates the customer and returns its id", async () => {
      const session = await createCustomerlessBuyerSession();
      stripeMock.customers.create.mockResolvedValueOnce({ id: "cus_new" });

      const res = await postConnectCustomer(app, session);

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({ stripeCustomerId: "cus_new" });
    });

    it("creates it under the caller's real name and email", async () => {
      const session = await createCustomerlessBuyerSession();
      stripeMock.customers.create.mockResolvedValueOnce({ id: "cus_new" });

      await postConnectCustomer(app, session);

      expect(stripeMock.customers.create).toHaveBeenCalledWith({
        name: `${session.user.name.first} ${session.user.name.last}`,
        email: session.user.email,
      });
    });

    it("persists the row against the caller and their company", async () => {
      const session = await createCustomerlessBuyerSession();
      stripeMock.customers.create.mockResolvedValueOnce({ id: "cus_new" });

      await postConnectCustomer(app, session);

      const persisted = await StripeConnectCustomer.findOne({
        userRef: session.user._id,
      });
      expect(persisted?.stripeCustomerId).toBe("cus_new");
      expect(persisted?.companyRef?.toString()).toBe(
        session.company._id.toString(),
      );
    });
  });

  describe("business scenarios", () => {
    it("422s when the caller already has one, without asking Stripe", async () => {
      const session = await createBuyerSession();

      const res = await postConnectCustomer(app, session);

      expect(res.status).toBe(422);
      expect(stripeMock.customers.create).not.toHaveBeenCalled();
    });

    it("leaves one row when two requests race", async () => {
      const session = await createCustomerlessBuyerSession();
      stripeMock.customers.create
        .mockResolvedValueOnce({ id: "cus_race_a" })
        .mockResolvedValueOnce({ id: "cus_race_b" });

      const results = await Promise.all([
        postConnectCustomer(app, session),
        postConnectCustomer(app, session),
      ]);

      const rows = await StripeConnectCustomer.find({
        userRef: session.user._id,
      });
      expect(rows).toHaveLength(1);
      // Whoever lost adopts the surviving id rather than reporting its own.
      for (const res of results.filter((r) => r.status === 200)) {
        expect(res.body.data.stripeCustomerId).toBe(rows[0].stripeCustomerId);
      }
    });

    it("keeps userRef unique, which is what makes the upsert serialize", async () => {
      const indexes = await StripeConnectCustomer.collection.indexes();

      expect(
        indexes.some(
          (index) => index.unique === true && index.key.userRef === 1,
        ),
      ).toBe(true);
    });

    it("adopts the winner's id when a row lands while Stripe is being called", async () => {
      const session = await createCustomerlessBuyerSession();
      stripeMock.customers.create.mockImplementationOnce(async () => {
        await seedStripeConnectCustomer(session, {
          stripeCustomerId: "cus_winner",
        });
        return { id: "cus_loser" };
      });

      const res = await postConnectCustomer(app, session);

      expect(res.status).toBe(200);
      expect(res.body.data.stripeCustomerId).toBe("cus_winner");
      expect(
        await StripeConnectCustomer.countDocuments({
          userRef: session.user._id,
        }),
      ).toBe(1);
    });

    it("does not report success on a Stripe failure", async () => {
      const session = await createCustomerlessBuyerSession();
      stripeMock.customers.create.mockRejectedValueOnce(
        new Error("stripe is down"),
      );

      const res = await postConnectCustomer(app, session);

      expect(res.status).not.toBe(200);
      expect(
        await StripeConnectCustomer.countDocuments({
          userRef: session.user._id,
        }),
      ).toBe(0);
    });
  });

  describe("auth errors", () => {
    it("refuses a companyless caller, leaving no orphan at Stripe", async () => {
      const session = await createCompanylessBuyerSession();

      const res = await postConnectCustomer(app, session);

      expect(res.status).toBe(403);
      expect(stripeMock.customers.create).not.toHaveBeenCalled();
    });

    it("401s when unauthenticated", async () => {
      const res = await request(app).post(`${STRIPE_CONNECT_PATH}/customer`);

      expect(res.status).toBe(401);
    });
  });
});

describe("GET /api/stripe-connect/customer", () => {
  const app = createApp();

  it("returns the caller's own customer id", async () => {
    const session = await createBuyerSession();

    const res = await getConnectCustomer(app, session);

    expect(res.status).toBe(200);
    expect(res.body.data.stripeCustomerId).toBe(CONNECT_CUSTOMER_ID);
  });

  it("answers empty for a caller who has none, creating nothing", async () => {
    const session = await createCustomerlessBuyerSession();

    const res = await getConnectCustomer(app, session);

    expect(res.status).toBe(200);
    expect(res.body.data.stripeCustomerId).toBeUndefined();
    expect(stripeMock.customers.create).not.toHaveBeenCalled();
    expect(
      await StripeConnectCustomer.countDocuments({ userRef: session.user._id }),
    ).toBe(0);
  });

  it("does not return another buyer's customer", async () => {
    await createBuyerSession("cus_someone_else");
    const caller = await createCustomerlessBuyerSession();

    const res = await getConnectCustomer(app, caller);

    expect(res.body.data.stripeCustomerId).toBeUndefined();
  });

  it("401s when unauthenticated", async () => {
    const res = await request(app).get(`${STRIPE_CONNECT_PATH}/customer`);

    expect(res.status).toBe(401);
  });
});
