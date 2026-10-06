import { createApp } from "@/app";
import {
  createOrdersOnlySession,
  createShopperSession,
  getSessionStatus,
} from "@/modules/stripe-payment/__tests__/helpers/stripe-payment-endpoint.helper";
import {
  CHECKOUT_SESSION_ID,
  STRIPE_PAYMENT_PATH,
} from "@/modules/stripe-payment/__tests__/utils/stripe-payment.constant";
import { stripeMock } from "@/tests/mocks/stripe.mock";
import { createAdminSession, createUserSession } from "@/tests/utils/auth";
import { seedStripePaymentTransaction } from "@/tests/utils/payment-factories";
import request from "supertest";
import { describe, expect, it } from "vitest";

/**
 * GET /api/stripe-payment/session-status
 *
 * A session id is neither secret nor scoped, so the local transaction row is
 * what proves the caller started this session.
 */

describe("GET /api/stripe-payment/session-status", () => {
  const app = createApp();

  const completedSession = {
    id: CHECKOUT_SESSION_ID,
    status: "complete",
    customer_details: { email: "buyer@example.com" },
  };

  describe("success", () => {
    it("returns the status and email for the caller's own session", async () => {
      const session = await createAdminSession();
      await seedStripePaymentTransaction(session);
      stripeMock.checkout.sessions.retrieve.mockResolvedValueOnce(
        completedSession,
      );

      const res = await getSessionStatus(app, session, {
        sessionId: CHECKOUT_SESSION_ID,
      });

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({
        status: "complete",
        customer_email: "buyer@example.com",
      });
    });

    it("passes the requested session id through to Stripe", async () => {
      const session = await createAdminSession();
      await seedStripePaymentTransaction(session, {
        stripeCheckoutSessionId: "cs_test_other",
      });
      stripeMock.checkout.sessions.retrieve.mockResolvedValueOnce(
        completedSession,
      );

      await getSessionStatus(app, session, { sessionId: "cs_test_other" });

      expect(stripeMock.checkout.sessions.retrieve).toHaveBeenCalledWith(
        "cs_test_other",
      );
    });
  });

  describe("business scenarios", () => {
    it("returns 404 for a session started by another user", async () => {
      const owner = await createAdminSession();
      await seedStripePaymentTransaction(owner);
      const attacker = await createShopperSession();

      const res = await getSessionStatus(app, attacker, {
        sessionId: CHECKOUT_SESSION_ID,
      });

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });

    it("never asks Stripe about a session the caller did not start", async () => {
      const owner = await createAdminSession();
      await seedStripePaymentTransaction(owner);
      const attacker = await createShopperSession();

      await getSessionStatus(app, attacker, {
        sessionId: CHECKOUT_SESSION_ID,
      });

      expect(stripeMock.checkout.sessions.retrieve).not.toHaveBeenCalled();
    });

    it("does not leak the buyer's email to another user", async () => {
      const owner = await createAdminSession();
      await seedStripePaymentTransaction(owner);
      const attacker = await createShopperSession();

      const res = await getSessionStatus(app, attacker, {
        sessionId: CHECKOUT_SESSION_ID,
      });

      expect(JSON.stringify(res.body)).not.toContain("buyer@example.com");
    });

    it("returns 404 for a session id with no local transaction", async () => {
      const session = await createAdminSession();

      const res = await getSessionStatus(app, session, {
        sessionId: "cs_test_never_created",
      });

      expect(res.status).toBe(404);
    });
  });

  describe("server errors", () => {
    it("returns 500 when Stripe rejects the retrieval", async () => {
      const session = await createAdminSession();
      await seedStripePaymentTransaction(session);
      stripeMock.checkout.sessions.retrieve.mockRejectedValueOnce(
        new Error("connection reset"),
      );

      const res = await getSessionStatus(app, session, {
        sessionId: CHECKOUT_SESSION_ID,
      });

      expect(res.status).toBe(500);
    });
  });

  describe("validation errors", () => {
    it("returns 400 when sessionId is missing", async () => {
      const session = await createAdminSession();

      const res = await getSessionStatus(app, session, {});

      expect(res.status).toBe(400);
    });
  });

  describe("auth errors", () => {
    it("returns 401 when unauthenticated", async () => {
      const res = await request(app)
        .get(`${STRIPE_PAYMENT_PATH}/session-status`)
        .set("Accept", "application/json")
        .query({ sessionId: CHECKOUT_SESSION_ID });

      expect(res.status).toBe(401);
    });

    it("returns 403 for a principal without my-orders:view", async () => {
      const session = await createUserSession();
      await seedStripePaymentTransaction(session);

      const res = await getSessionStatus(app, session, {
        sessionId: CHECKOUT_SESSION_ID,
      });

      expect(res.status).toBe(403);
    });

    it("accepts a principal holding only my-orders:view", async () => {
      const session = await createOrdersOnlySession();
      await seedStripePaymentTransaction(session);
      stripeMock.checkout.sessions.retrieve.mockResolvedValueOnce(
        completedSession,
      );

      const res = await getSessionStatus(app, session, {
        sessionId: CHECKOUT_SESSION_ID,
      });

      expect(res.status).toBe(200);
    });
  });
});
