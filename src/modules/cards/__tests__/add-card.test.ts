import { createApp } from "@/app";
import {
  createCardHolderSession,
  createCustomerlessSession,
  postAddCard,
} from "@/modules/cards/__tests__/helpers/card-endpoint.helper";
import {
  CARDS_PATH,
  CUSTOMER_ID,
  NEW_CUSTOMER_ID,
  SETUP_INTENT_CLIENT_SECRET,
} from "@/modules/cards/__tests__/utils/card.constant";
import { User } from "@/db/models/user";
import { stripeMock } from "@/tests/mocks/stripe.mock";
import request from "supertest";
import { describe, expect, it } from "vitest";

/**
 * POST /api/admin/cards/add
 *
 * Creates a SetupIntent and hands back its client secret; the card itself
 * never touches this server. The secret is the whole payload, so the cases
 * that matter are the ones where it could come back absent or belong to
 * somebody else's customer.
 */

describe("POST /api/admin/cards/add", () => {
  const app = createApp();

  describe("success", () => {
    it("returns the setup intent's client secret", async () => {
      const session = await createCardHolderSession();
      stripeMock.setupIntents.create.mockResolvedValueOnce({
        id: "seti_test_default",
        client_secret: SETUP_INTENT_CLIENT_SECRET,
      });

      const res = await postAddCard(app, session);

      expect(res.status).toBe(200);
      expect(res.body.data.client_secret).toBe(SETUP_INTENT_CLIENT_SECRET);
    });

    it("creates the intent against the caller's own customer", async () => {
      const session = await createCardHolderSession("cus_caller_own");
      stripeMock.setupIntents.create.mockResolvedValueOnce({
        client_secret: SETUP_INTENT_CLIENT_SECRET,
      });

      await postAddCard(app, session);

      expect(stripeMock.setupIntents.create).toHaveBeenCalledWith({
        customer: "cus_caller_own",
      });
    });

    it("does not invent a customer id when one is already on the session", async () => {
      const session = await createCardHolderSession();
      stripeMock.setupIntents.create.mockResolvedValueOnce({
        client_secret: SETUP_INTENT_CLIENT_SECRET,
      });

      await postAddCard(app, session);

      expect(stripeMock.customers.create).not.toHaveBeenCalled();
      expect(stripeMock.setupIntents.create).toHaveBeenCalledWith({
        customer: CUSTOMER_ID,
      });
    });
  });

  // Two clicks on "Add card" from a caller who has no customer yet: both
  // requests find none and both create one, so only one id can survive on the
  // user. A secret issued against the discarded customer saves the card where
  // nothing ever looks for it again.
  describe("concurrent first-time adds", () => {
    it("issues every secret against the customer the user keeps", async () => {
      const session = await createCustomerlessSession();
      stripeMock.customers.create
        .mockResolvedValueOnce({ id: "cus_race_first" })
        .mockResolvedValueOnce({ id: "cus_race_second" });
      stripeMock.setupIntents.create.mockResolvedValue({
        client_secret: SETUP_INTENT_CLIENT_SECRET,
      });

      await Promise.all([postAddCard(app, session), postAddCard(app, session)]);

      const persisted = await User.findById(session.user._id);
      const intentCustomers = stripeMock.setupIntents.create.mock.calls.map(
        (call) => (call[0] as { customer: string }).customer,
      );

      expect(intentCustomers).toHaveLength(2);
      expect(new Set(intentCustomers)).toEqual(
        new Set([persisted?.stripeCustomerId]),
      );
    });
  });

  describe("business scenarios", () => {
    it("creates a Stripe customer on the fly for a caller who has none", async () => {
      const session = await createCustomerlessSession();
      stripeMock.customers.create.mockResolvedValueOnce({
        id: NEW_CUSTOMER_ID,
      });
      stripeMock.setupIntents.create.mockResolvedValueOnce({
        client_secret: SETUP_INTENT_CLIENT_SECRET,
      });

      const res = await postAddCard(app, session);

      expect(res.status).toBe(200);
      expect(res.body.data.client_secret).toBe(SETUP_INTENT_CLIENT_SECRET);
      expect(stripeMock.setupIntents.create).toHaveBeenCalledWith({
        customer: NEW_CUSTOMER_ID,
      });
    });

    it("persists the new customer id so the next call does not create a second one", async () => {
      const session = await createCustomerlessSession();
      stripeMock.customers.create.mockResolvedValueOnce({
        id: NEW_CUSTOMER_ID,
      });
      stripeMock.setupIntents.create.mockResolvedValueOnce({
        client_secret: SETUP_INTENT_CLIENT_SECRET,
      });

      await postAddCard(app, session);

      const stored = await User.findById(session.user._id);
      expect(stored?.stripeCustomerId).toBe(NEW_CUSTOMER_ID);
    });

    it("creates the customer against the caller's own name and email", async () => {
      const session = await createCustomerlessSession();
      stripeMock.customers.create.mockResolvedValueOnce({
        id: NEW_CUSTOMER_ID,
      });
      stripeMock.setupIntents.create.mockResolvedValueOnce({
        client_secret: SETUP_INTENT_CLIENT_SECRET,
      });

      await postAddCard(app, session);

      expect(stripeMock.customers.create).toHaveBeenCalledWith({
        name: `${session.user.name.first} ${session.user.name.last}`,
        email: session.user.email,
      });
    });
  });

  describe("server errors", () => {
    it("does not answer 200 when the customer cannot be created", async () => {
      const session = await createCustomerlessSession();
      stripeMock.customers.create.mockRejectedValueOnce(
        new Error("Stripe is down"),
      );

      const res = await postAddCard(app, session);

      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(stripeMock.setupIntents.create).not.toHaveBeenCalled();
    });

    it("does not answer 200 when Stripe rejects the setup intent", async () => {
      const session = await createCardHolderSession();
      stripeMock.setupIntents.create.mockRejectedValueOnce(
        new Error("Stripe is down"),
      );

      const res = await postAddCard(app, session);

      expect(res.status).toBeGreaterThanOrEqual(400);
    });
  });

  describe("auth errors", () => {
    it("returns 401 when unauthenticated", async () => {
      const res = await request(app)
        .post(`${CARDS_PATH}/add`)
        .set("Accept", "application/json");

      expect(res.status).toBe(401);
    });
  });
});
