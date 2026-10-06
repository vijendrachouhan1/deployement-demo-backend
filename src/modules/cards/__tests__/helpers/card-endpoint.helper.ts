import type { Application } from "express";
import request from "supertest";

import { USER_TYPE } from "@/enums";
import {
  CARDS_PATH,
  CUSTOMER_ID,
  PAYMENT_METHOD_ID,
} from "@/modules/cards/__tests__/utils/card.constant";
import { createTestSession, ITestSession } from "@/tests/utils/auth";

/**
 * Every cards endpoint reads `stripeCustomerId` off the session and refuses
 * without one, so this is the baseline principal for the happy paths. The
 * router gates on authMiddleware alone — no permission is involved — so the
 * role here is incidental.
 */
export function createCardHolderSession(
  stripeCustomerId: string = CUSTOMER_ID,
) {
  return createTestSession(USER_TYPE.USER, { stripeCustomerId });
}

/** The same principal, before Stripe has ever issued them a customer. */
export function createCustomerlessSession() {
  return createTestSession(USER_TYPE.USER);
}

export function getCards(app: Application, session: ITestSession) {
  return request(app)
    .get(CARDS_PATH)
    .set("Cookie", session.cookie)
    .set("Accept", "application/json");
}

export function postAddCard(app: Application, session: ITestSession) {
  return request(app)
    .post(`${CARDS_PATH}/add`)
    .set("Cookie", session.cookie)
    .set("Accept", "application/json");
}

export function postSetDefaultCard(
  app: Application,
  session: ITestSession,
  body: Record<string, unknown> = { paymentMethodId: PAYMENT_METHOD_ID },
) {
  return request(app)
    .post(`${CARDS_PATH}/default`)
    .set("Cookie", session.cookie)
    .set("Accept", "application/json")
    .send(body);
}

/** A Stripe card payment method, shaped as `paymentMethods.list` returns it. */
export function stripeCard(
  id: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    id,
    object: "payment_method",
    type: "card",
    card: {
      brand: "visa",
      last4: "4242",
      exp_month: 12,
      exp_year: 2034,
    },
    ...overrides,
  };
}

/** A Stripe customer carrying whichever default payment method is set. */
export function stripeCustomer(defaultPaymentMethod: string | null = null) {
  return {
    id: CUSTOMER_ID,
    object: "customer",
    invoice_settings: { default_payment_method: defaultPaymentMethod },
  };
}
