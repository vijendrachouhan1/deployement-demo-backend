import { createApp } from "@/app";
import { postRefund } from "@/modules/stripe-payment/__tests__/helpers/stripe-payment-endpoint.helper";
import { StripeErrors, stripeMock } from "@/tests/mocks/stripe.mock";
import { createAdminSession } from "@/tests/utils/auth";
import { seedStripePaymentTransaction } from "@/tests/utils/payment-factories";
import { describe, expect, it } from "vitest";

describe("global error handler — Stripe failures", () => {
  const app = createApp();

  async function refundRejectingWith(error: unknown) {
    const session = await createAdminSession();
    const order = await seedStripePaymentTransaction(session);
    stripeMock.refunds.create.mockRejectedValueOnce(error);

    return postRefund(app, session, order._id.toString());
  }

  describe("status mapping", () => {
    it("answers a declined card with 402", async () => {
      const res = await refundRejectingWith(
        new StripeErrors.StripeCardError({
          type: "card_error",
          message: "Your card was declined.",
          code: "card_declined",
        }),
      );

      expect(res.status).toBe(402);
    });

    it("answers a rejected request with 400", async () => {
      const res = await refundRejectingWith(
        new StripeErrors.StripeInvalidRequestError({
          type: "invalid_request_error",
          message: "No such charge: ch_test_default",
        }),
      );

      expect(res.status).toBe(400);
    });

    it("answers a rate limit with 429", async () => {
      const res = await refundRejectingWith(
        new StripeErrors.StripeRateLimitError({
          type: "rate_limit_error",
          message: "Too many requests",
        }),
      );

      expect(res.status).toBe(429);
    });

    it("answers a repeated idempotency key with 409", async () => {
      const res = await refundRejectingWith(
        new StripeErrors.StripeIdempotencyError({
          type: "idempotency_error",
          message: "Keys must differ",
        }),
      );

      expect(res.status).toBe(409);
    });

    it("answers a bad API key with 502", async () => {
      const res = await refundRejectingWith(
        new StripeErrors.StripeAuthenticationError({
          type: "authentication_error",
          message: "Invalid API Key provided: sk_live_************1234",
        }),
      );

      expect(res.status).toBe(502);
    });

    it("answers a network failure with 502", async () => {
      const res = await refundRejectingWith(
        new StripeErrors.StripeConnectionError({
          type: "api_error",
          message: "ECONNRESET",
        }),
      );

      expect(res.status).toBe(502);
    });

    it("still answers an ordinary failure with 500", async () => {
      const res = await refundRejectingWith(new Error("something broke"));

      expect(res.status).toBe(500);
    });
  });

  describe("what reaches the client", () => {
    it("forwards the decline reason, which Stripe writes for the cardholder", async () => {
      const res = await refundRejectingWith(
        new StripeErrors.StripeCardError({
          type: "card_error",
          message: "Your card has insufficient funds.",
          code: "card_declined",
        }),
      );

      expect(res.body.message).toBe("Your card has insufficient funds.");
    });

    it("withholds the raw text of a rejected request", async () => {
      const res = await refundRejectingWith(
        new StripeErrors.StripeInvalidRequestError({
          type: "invalid_request_error",
          message: "No such charge: ch_test_default",
        }),
      );

      expect(res.body.message).not.toContain("ch_test_default");
    });

    it("withholds the API key from an authentication failure", async () => {
      const res = await refundRejectingWith(
        new StripeErrors.StripeAuthenticationError({
          type: "authentication_error",
          message: "Invalid API Key provided: sk_live_************1234",
        }),
      );

      expect(res.body.message).not.toContain("sk_live");
    });
  });
});
