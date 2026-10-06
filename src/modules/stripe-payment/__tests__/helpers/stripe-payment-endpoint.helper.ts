import type { Application } from "express";
import request from "supertest";

import { PERMISSIONS, USER_TYPE } from "@/enums";
import { STRIPE_PAYMENT_PATH } from "@/modules/stripe-payment/__tests__/utils/stripe-payment.constant";
import {
  createCompanylessSession,
  createTestSession,
  ITestSession,
} from "@/tests/utils/auth";

/** Only the cookie is needed to call an endpoint; a companyless caller has no company. */
type TCallerSession = Pick<ITestSession, "cookie">;

/** A principal from a different company, for ownership scoping tests. */
export const createShopperSession = () => createTestSession(USER_TYPE.ADMIN);

/** Holds products:view but not my-orders:view, and vice versa. */
export const createProductsOnlySession = () =>
  createTestSession(USER_TYPE.ADMIN, {}, [
    PERMISSIONS.STRIPE_PAYMENT_PRODUCTS_VIEW,
  ]);

export const createOrdersOnlySession = () =>
  createTestSession(USER_TYPE.ADMIN, {}, [
    PERMISSIONS.STRIPE_PAYMENT_ORDERS_VIEW,
  ]);

export function postRefund(
  app: Application,
  session: ITestSession,
  orderId: string,
) {
  return request(app)
    .post(`${STRIPE_PAYMENT_PATH}/refund/${orderId}`)
    .set("Cookie", session.cookie)
    .set("Accept", "application/json")
    .send();
}

export function getSessionStatus(
  app: Application,
  session: ITestSession,
  query: Record<string, string>,
) {
  return request(app)
    .get(`${STRIPE_PAYMENT_PATH}/session-status`)
    .set("Cookie", session.cookie)
    .set("Accept", "application/json")
    .query(query);
}

/** An admin with no companyRef — the shape phone-OTP login creates. */
export function createCompanylessCheckoutSession() {
  return createCompanylessSession(USER_TYPE.ADMIN);
}

export function postCreateCheckoutSession(
  app: Application,
  session: TCallerSession,
  body: Record<string, unknown>,
) {
  return request(app)
    .post(`${STRIPE_PAYMENT_PATH}/create-checkout-session`)
    .set("Cookie", session.cookie)
    .set("Accept", "application/json")
    .send(body);
}

export function getPastOrders(
  app: Application,
  session: TCallerSession,
  query: Record<string, string> = {},
) {
  return request(app)
    .get(`${STRIPE_PAYMENT_PATH}/orders`)
    .set("Cookie", session.cookie)
    .set("Accept", "application/json")
    .query(query);
}

export function getPastOrdersCount(app: Application, session: TCallerSession) {
  return request(app)
    .get(`${STRIPE_PAYMENT_PATH}/orders/count`)
    .set("Cookie", session.cookie)
    .set("Accept", "application/json");
}
