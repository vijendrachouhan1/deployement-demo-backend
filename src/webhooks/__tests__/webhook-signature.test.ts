import { createApp } from "@/app";
import {
  postStripeWebhook,
  staleTimestamp,
  WEBHOOK_SECRET_FOR,
} from "@/tests/utils/stripe-webhook";
import { buildEvent } from "@/webhooks/__tests__/helpers/webhook-event.helper";
import {
  FOREIGN_SECRET_FOR,
  WEBHOOK_PATHS,
} from "@/webhooks/__tests__/utils/webhook-signature.constant";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Stripe webhook signature verification
 *
 * POST /webhook/subscription
 * POST /webhook/stripe-payment
 * POST /webhook/stripe-connect
 *
 *   Auth required : No — authenticity comes from the stripe-signature HMAC,
 *                   verified against a per-endpoint secret (STRIPE_WEBHOOK_SECRET,
 *                   STRIPE_PAYMENT_WEBHOOK_SECRET, STRIPE_CONNECT_WEBHOOK_SECRET).
 *   Body          : raw JSON Buffer — mounted with express.raw() BEFORE express.json()
 *   Headers       : stripe-signature (required)
 *
 *   Success  : 200 – event accepted
 *   Failures : 400 – missing / malformed / mismatched signature, tampered body,
 *                    timestamp outside Stripe's 300s tolerance
 *
 * Signatures here are real HMAC (stripe.mock.ts keeps Stripe.webhooks unmocked),
 * so these assertions exercise Stripe's own verifier rather than a stub of it.
 */

describe("Stripe webhook signature verification", () => {
  const app = createApp();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // =========================================================================
  // 1. Happy path — a correctly signed payload is accepted
  // =========================================================================

  describe("success", () => {
    it.each(WEBHOOK_PATHS)(
      "accepts a correctly signed payload at %s",
      async (path) => {
        const res = await postStripeWebhook(app, path, buildEvent());

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
      },
    );
  });

  // =========================================================================
  // 2. Signature errors (malicious user)
  // =========================================================================

  describe("signature errors", () => {
    it.each(WEBHOOK_PATHS)(
      "returns 400 when the stripe-signature header is missing at %s",
      async (path) => {
        const res = await postStripeWebhook(app, path, buildEvent(), {
          omitSignature: true,
        });

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
      },
    );

    it.each(WEBHOOK_PATHS)(
      "returns 400 when the signature header is malformed at %s",
      async (path) => {
        const res = await postStripeWebhook(app, path, buildEvent(), {
          signature: "t=1,v1=deadbeef",
        });

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
      },
    );

    it.each(WEBHOOK_PATHS)(
      "returns 400 when the body was tampered with after signing at %s",
      async (path) => {
        const res = await postStripeWebhook(app, path, buildEvent(), {
          tamperedBody: JSON.stringify({ id: "evt_injected", type: "noop" }),
        });

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
      },
    );

    it.each(WEBHOOK_PATHS)(
      "returns 400 when the signature timestamp is outside the tolerance window at %s",
      async (path) => {
        const res = await postStripeWebhook(app, path, buildEvent(), {
          timestamp: staleTimestamp(),
        });

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
      },
    );
  });

  // =========================================================================
  // 3. Business scenario — endpoint secrets must not be interchangeable
  // =========================================================================

  describe("business scenarios", () => {
    it.each(WEBHOOK_PATHS)(
      "%s rejects a signature made with another endpoint's secret",
      async (path) => {
        const foreignSecret = FOREIGN_SECRET_FOR[path];
        expect(foreignSecret).not.toBe(WEBHOOK_SECRET_FOR[path]);

        const res = await postStripeWebhook(app, path, buildEvent(), {
          secret: foreignSecret,
        });

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
      },
    );
  });
});
