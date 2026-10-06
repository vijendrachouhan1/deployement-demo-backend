import type { Application } from "express";
import request from "supertest";

import { PERMISSIONS, USER_TYPE } from "@/enums";
import {
  CONNECT_CUSTOMER_ID,
  STRIPE_CONNECT_PATH,
} from "@/modules/stripe-connect/__tests__/utils/stripe-connect.constant";
import {
  createCompanylessSession,
  createTestSession,
  ITestSession,
} from "@/tests/utils/auth";
import {
  seedStripeConnectCustomer,
  seedStripeConnectProduct,
  seedStripeConnectTransaction,
} from "@/tests/utils/payment-factories";

/** Only the cookie is needed to call an endpoint; a companyless caller has no company. */
type TCallerSession = Pick<ITestSession, "cookie">;

/*
 * ORDERS_MANAGE gates the purchase and refund routes; the /customer routes are
 * gated on ONBOARDING instead, so a buyer who can create their own customer
 * record holds both.
 */
const BUYER_PERMISSIONS = [
  PERMISSIONS.STRIPE_CONNECT_ORDERS_MANAGE,
  PERMISSIONS.STRIPE_CONNECT_ONBOARDING,
];

/** A buyer: ORDERS_MANAGE plus the Connect customer row ownership keys on. */
export async function createBuyerSession(
  stripeCustomerId: string = CONNECT_CUSTOMER_ID,
) {
  const session = await createTestSession(
    USER_TYPE.USER,
    undefined,
    BUYER_PERMISSIONS,
  );
  await seedStripeConnectCustomer(session, { stripeCustomerId });

  return session;
}

/** The same principal, before they have ever bought anything. */
export function createCustomerlessBuyerSession() {
  return createTestSession(USER_TYPE.USER, undefined, BUYER_PERMISSIONS);
}

/** A buyer with no companyRef — the shape phone-OTP login creates. */
export function createCompanylessBuyerSession() {
  return createCompanylessSession(USER_TYPE.USER, undefined, BUYER_PERMISSIONS);
}

/** A product on some vendor's account, priced in dollars. */
export function seedProductFor(
  session: ITestSession,
  overrides: Record<string, unknown> = {},
) {
  return seedStripeConnectProduct(session, overrides);
}

/** An order belonging to whoever holds `stripeCustomerId`. */
export function seedOrderFor(
  session: ITestSession,
  stripeCustomerId: string = CONNECT_CUSTOMER_ID,
  overrides: Record<string, unknown> = {},
) {
  return seedStripeConnectTransaction(session, {
    stripeCustomerId,
    ...overrides,
  });
}

export function postRefund(
  app: Application,
  session: TCallerSession,
  orderId: string,
) {
  return request(app)
    .post(`${STRIPE_CONNECT_PATH}/refund/${orderId}`)
    .set("Cookie", session.cookie)
    .set("Accept", "application/json");
}

export function postPaymentIntent(
  app: Application,
  session: TCallerSession,
  body: Record<string, unknown>,
) {
  return request(app)
    .post(`${STRIPE_CONNECT_PATH}/create-payment-intent`)
    .set("Cookie", session.cookie)
    .set("Accept", "application/json")
    .send(body);
}

export function postConnectCustomer(app: Application, session: TCallerSession) {
  return request(app)
    .post(`${STRIPE_CONNECT_PATH}/customer`)
    .set("Cookie", session.cookie)
    .set("Accept", "application/json");
}

export function getConnectCustomer(app: Application, session: TCallerSession) {
  return request(app)
    .get(`${STRIPE_CONNECT_PATH}/customer`)
    .set("Cookie", session.cookie)
    .set("Accept", "application/json");
}

export function getPastOrders(
  app: Application,
  session: TCallerSession,
  query: Record<string, string> = {},
) {
  return request(app)
    .get(`${STRIPE_CONNECT_PATH}/past-orders`)
    .query(query)
    .set("Cookie", session.cookie)
    .set("Accept", "application/json");
}

export function getPastOrdersCount(app: Application, session: TCallerSession) {
  return request(app)
    .get(`${STRIPE_CONNECT_PATH}/past-orders/count`)
    .set("Cookie", session.cookie)
    .set("Accept", "application/json");
}
