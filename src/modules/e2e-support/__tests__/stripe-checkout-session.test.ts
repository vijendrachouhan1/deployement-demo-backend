import request from "supertest";
import mongoose from "mongoose";
import { beforeEach, describe, expect, it, vi } from "vitest";

const envState = vi.hoisted(() => ({ development: true }));

vi.mock("@/helpers/common", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/helpers/common")>();
  return { ...actual, isDevEnvironment: () => envState.development };
});

import { createApp } from "@/app";
import { stripeMock } from "@/tests/mocks/stripe.mock";

describe("GET /api/e2e/stripe/checkout-sessions/:sessionId", () => {
  const app = createApp();

  beforeEach(() => {
    envState.development = true;
    vi.clearAllMocks();
  });

  it("returns only the completed session values needed by E2E webhooks", async () => {
    stripeMock.checkout.sessions.retrieve.mockResolvedValueOnce({
      id: "cs_test_completed123",
      amount_total: 2599,
      client_secret: "cs_secret_never_return_this",
      customer_details: { email: "private@example.com" },
      payment_intent: {
        id: "pi_real123",
        client_secret: "pi_secret_never_return_this",
        latest_charge: { id: "ch_real123", billing_details: {} },
      },
    });

    const res = await request(app).get(
      "/api/e2e/stripe/checkout-sessions/cs_test_completed123",
    );

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      sessionId: "cs_test_completed123",
      paymentIntentId: "pi_real123",
      chargeId: "ch_real123",
      amountTotal: 2599,
    });
    expect(JSON.stringify(res.body)).not.toContain("secret");
    expect(JSON.stringify(res.body)).not.toContain("private@example.com");
    expect(stripeMock.checkout.sessions.retrieve).toHaveBeenCalledWith(
      "cs_test_completed123",
      { expand: ["payment_intent.latest_charge"] },
    );
  });

  it("returns nullable identifiers while checkout is incomplete", async () => {
    stripeMock.checkout.sessions.retrieve.mockResolvedValueOnce({
      id: "cs_test_open123",
      amount_total: null,
      payment_intent: null,
    });

    const res = await request(app).get(
      "/api/e2e/stripe/checkout-sessions/cs_test_open123",
    );

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      sessionId: "cs_test_open123",
      paymentIntentId: null,
      chargeId: null,
      amountTotal: null,
    });
  });

  it.each(["not-stripe", "cs_", "cs_live_wrong123", "pi_wrong123"])(
    "rejects malformed session id %s before Stripe is contacted",
    async (sessionId) => {
      const res = await request(app).get(
        `/api/e2e/stripe/checkout-sessions/${sessionId}`,
      );

      expect(res.status).toBe(400);
      expect(stripeMock.checkout.sessions.retrieve).not.toHaveBeenCalled();
    },
  );

  it("rejects a missing session id before Stripe is contacted", async () => {
    const res = await request(app).get("/api/e2e/stripe/checkout-sessions");

    expect(res.status).toBe(400);
    expect(stripeMock.checkout.sessions.retrieve).not.toHaveBeenCalled();
  });

  it("rejects an unreasonably long session id before Stripe is contacted", async () => {
    const res = await request(app).get(
      `/api/e2e/stripe/checkout-sessions/cs_test_${"a".repeat(129)}`,
    );

    expect(res.status).toBe(400);
    expect(stripeMock.checkout.sessions.retrieve).not.toHaveBeenCalled();
  });

  it("is unavailable outside development and does not contact Stripe", async () => {
    envState.development = false;

    const res = await request(app).get(
      "/api/e2e/stripe/checkout-sessions/cs_test_completed123",
    );

    expect(res.status).toBe(404);
    expect(stripeMock.checkout.sessions.retrieve).not.toHaveBeenCalled();
  });

  it("passes Stripe failures to the existing sanitized error middleware", async () => {
    const sensitiveSentinel =
      "sk_test_sensitive_sentinel client_secret=pi_secret_sentinel";
    stripeMock.checkout.sessions.retrieve.mockRejectedValueOnce(
      new Error(sensitiveSentinel),
    );

    const res = await request(app).get(
      "/api/e2e/stripe/checkout-sessions/cs_test_missing123",
    );

    expect(res.status).toBe(500);
    expect(res.body.data).toEqual({});
    expect(JSON.stringify(res.body)).not.toContain(sensitiveSentinel);
    expect(JSON.stringify(res.body)).not.toContain("pi_secret_sentinel");
  });

  it("is not mounted when the app is constructed outside development", async () => {
    envState.development = false;
    vi.resetModules();
    mongoose.deleteModel(/.+/);
    const { createApp: createFreshApp } = await import("@/app");
    const freshApp = createFreshApp();

    const res = await request(freshApp).get(
      "/api/e2e/stripe/checkout-sessions/cs_test_completed123",
    );

    expect(res.status).toBe(404);
    expect(stripeMock.checkout.sessions.retrieve).not.toHaveBeenCalled();
  });
});
