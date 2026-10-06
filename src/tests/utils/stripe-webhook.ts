import type { Application } from "express";
import request from "supertest";

import { realWebhooks, TEST_WEBHOOK_SECRETS } from "@/tests/mocks/stripe.mock";

export type TStripeWebhookPath =
  | "/webhook/subscription"
  | "/webhook/stripe-payment"
  | "/webhook/stripe-connect";

/** The env secret each handler actually verifies against. */
export const WEBHOOK_SECRET_FOR: Record<TStripeWebhookPath, string> = {
  "/webhook/subscription": TEST_WEBHOOK_SECRETS.SUBSCRIPTION,
  "/webhook/stripe-payment": TEST_WEBHOOK_SECRETS.PAYMENT,
  "/webhook/stripe-connect": TEST_WEBHOOK_SECRETS.CONNECT,
};

export interface IPostStripeWebhookOptions {
  /**
   * Secret used to SIGN. Defaults to the correct one for `path`; pass another
   * endpoint's secret to test cross-endpoint secret confusion.
   */
  secret?: string;
  /** Fully-formed stripe-signature header; overrides secret/timestamp. */
  signature?: string;
  /** Unix seconds baked into the signature. now-600 exceeds Stripe's 300s tolerance. */
  timestamp?: number;
  /** Omit the stripe-signature header entirely. */
  omitSignature?: boolean;
  /** Send bytes that differ from what was signed. */
  tamperedBody?: string;
}

/**
 * Drives a Stripe webhook through the real raw-body pipeline with a real
 * signature, so signature-failure paths are genuinely exercised rather than
 * asserted against a stub.
 */
export function postStripeWebhook(
  app: Application,
  path: TStripeWebhookPath,
  event: unknown,
  options: IPostStripeWebhookOptions = {},
) {
  const payload = JSON.stringify(event);
  const secret = options.secret ?? WEBHOOK_SECRET_FOR[path];

  const signature =
    options.signature ??
    realWebhooks.generateTestHeaderString({
      payload,
      secret,
      ...(options.timestamp !== undefined
        ? { timestamp: options.timestamp }
        : {}),
    });

  const req = request(app)
    .post(path)
    // express.raw({type:"application/json"}) only engages on this exact type.
    .set("Content-Type", "application/json");

  if (!options.omitSignature) req.set("stripe-signature", signature);

  /*
   * MUST be a string. superagent treats a Buffer as an object and re-serializes
   * it to {"type":"Buffer","data":[...]} — measured: a 71-byte payload arrives
   * as 275 bytes and every signature check fails for the wrong reason. A string
   * is forwarded verbatim, so the bytes Stripe signed are the bytes
   * express.raw() hands to constructEvent.
   */
  return req.send(options.tamperedBody ?? payload);
}

/** Stripe retries redeliver the same event id. Same event, fresh signature, twice. */
export async function postStripeWebhookTwice(
  app: Application,
  path: TStripeWebhookPath,
  event: unknown,
  options: IPostStripeWebhookOptions = {},
) {
  const first = await postStripeWebhook(app, path, event, options);
  const second = await postStripeWebhook(app, path, event, options);
  return { first, second };
}

/** A signature timestamp outside Stripe's 300s tolerance window. */
export const staleTimestamp = (secondsAgo = 600) =>
  Math.floor(Date.now() / 1000) - secondsAgo;
