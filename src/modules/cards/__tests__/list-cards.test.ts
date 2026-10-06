import { createApp } from "@/app";
import {
  createCardHolderSession,
  createCustomerlessSession,
  getCards,
  stripeCard,
  stripeCustomer,
} from "@/modules/cards/__tests__/helpers/card-endpoint.helper";
import {
  CARDS_PATH,
  CUSTOMER_ID,
  OTHER_PAYMENT_METHOD_ID,
  PAYMENT_METHOD_ID,
} from "@/modules/cards/__tests__/utils/card.constant";
import { stripeMock } from "@/tests/mocks/stripe.mock";
import request from "supertest";
import { describe, expect, it } from "vitest";

/**
 * GET /api/admin/cards
 *
 * Cards are read straight from Stripe against the caller's own
 * `stripeCustomerId`, so there is no local row to scope against and no id in
 * the request to tamper with. What the suite watches instead is the deleted
 * customer case — Stripe answers a delete stub rather than an error, and the
 * check that spots it was reading the wrong field entirely.
 */

describe("GET /api/admin/cards", () => {
  const app = createApp();

  describe("success", () => {
    it("returns the caller's cards", async () => {
      const session = await createCardHolderSession();
      stripeMock.paymentMethods.list.mockResolvedValueOnce({
        data: [stripeCard(PAYMENT_METHOD_ID)],
      });
      stripeMock.customers.retrieve.mockResolvedValueOnce(stripeCustomer());

      const res = await getCards(app, session);

      expect(res.status).toBe(200);
      expect(res.body.data.cards).toHaveLength(1);
      expect(res.body.data.cards[0].id).toBe(PAYMENT_METHOD_ID);
    });

    it("asks Stripe only for the caller's own customer", async () => {
      const session = await createCardHolderSession();
      stripeMock.paymentMethods.list.mockResolvedValueOnce({ data: [] });
      stripeMock.customers.retrieve.mockResolvedValueOnce(stripeCustomer());

      await getCards(app, session);

      expect(stripeMock.paymentMethods.list).toHaveBeenCalledWith({
        customer: CUSTOMER_ID,
        type: "card",
      });
    });

    it("surfaces which card is the default", async () => {
      const session = await createCardHolderSession();
      stripeMock.paymentMethods.list.mockResolvedValueOnce({
        data: [
          stripeCard(PAYMENT_METHOD_ID),
          stripeCard(OTHER_PAYMENT_METHOD_ID),
        ],
      });
      stripeMock.customers.retrieve.mockResolvedValueOnce(
        stripeCustomer(OTHER_PAYMENT_METHOD_ID),
      );

      const res = await getCards(app, session);

      expect(res.body.data.defaultPaymentMethodId).toBe(
        OTHER_PAYMENT_METHOD_ID,
      );
    });

    it("reports no default when the customer has none set", async () => {
      const session = await createCardHolderSession();
      stripeMock.paymentMethods.list.mockResolvedValueOnce({
        data: [stripeCard(PAYMENT_METHOD_ID)],
      });
      stripeMock.customers.retrieve.mockResolvedValueOnce(stripeCustomer(null));

      const res = await getCards(app, session);

      expect(res.status).toBe(200);
      expect(res.body.data.defaultPaymentMethodId ?? null).toBeNull();
    });

    it("returns an empty list for a customer with no saved cards", async () => {
      const session = await createCardHolderSession();
      stripeMock.paymentMethods.list.mockResolvedValueOnce({ data: [] });
      stripeMock.customers.retrieve.mockResolvedValueOnce(stripeCustomer());

      const res = await getCards(app, session);

      expect(res.status).toBe(200);
      expect(res.body.data.cards).toEqual([]);
    });
  });

  describe("business scenarios", () => {
    it("returns 404 when Stripe reports the customer deleted", async () => {
      const session = await createCardHolderSession();
      stripeMock.customers.retrieve.mockResolvedValueOnce({
        id: CUSTOMER_ID,
        object: "customer",
        deleted: true,
      });

      const res = await getCards(app, session);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });

    // Real Stripe throws resource_missing here, so listing first would return
    // the mapped error instead of the 404 above.
    it("checks the customer before asking Stripe to list its cards", async () => {
      const session = await createCardHolderSession();
      stripeMock.customers.retrieve.mockResolvedValueOnce({
        id: CUSTOMER_ID,
        object: "customer",
        deleted: true,
      });

      await getCards(app, session);

      expect(stripeMock.paymentMethods.list).not.toHaveBeenCalled();
    });

    it("does not treat a live customer as deleted", async () => {
      const session = await createCardHolderSession();
      stripeMock.paymentMethods.list.mockResolvedValueOnce({
        data: [stripeCard(PAYMENT_METHOD_ID)],
      });
      stripeMock.customers.retrieve.mockResolvedValueOnce({
        ...stripeCustomer(),
        deleted: false,
      });

      const res = await getCards(app, session);

      expect(res.status).toBe(200);
    });

    it("returns an empty list, not an error, when the caller has no Stripe customer yet", async () => {
      const session = await createCustomerlessSession();

      const res = await getCards(app, session);

      expect(res.status).toBe(200);
      expect(res.body.data.cards).toEqual([]);
      expect(res.body.data.defaultPaymentMethodId).toBeNull();
      expect(stripeMock.paymentMethods.list).not.toHaveBeenCalled();
    });

    it("does not create a Stripe customer as a side effect of a read", async () => {
      const session = await createCustomerlessSession();

      await getCards(app, session);

      expect(stripeMock.customers.create).not.toHaveBeenCalled();
    });
  });

  describe("server errors", () => {
    it("maps a Stripe failure rather than answering 200", async () => {
      const session = await createCardHolderSession();
      stripeMock.customers.retrieve.mockResolvedValueOnce(stripeCustomer());
      stripeMock.paymentMethods.list.mockRejectedValueOnce(
        new Error("Stripe is down"),
      );

      const res = await getCards(app, session);

      expect(res.status).toBeGreaterThanOrEqual(500);
    });
  });

  describe("auth errors", () => {
    // Unlike the subscription routers (B35), CardRouter mounts
    // middleware.authMiddleware, so an anonymous caller is correctly refused
    // as unauthenticated rather than forbidden.
    it("returns 401 when unauthenticated", async () => {
      const res = await request(app)
        .get(CARDS_PATH)
        .set("Accept", "application/json");

      expect(res.status).toBe(401);
    });
  });
});
