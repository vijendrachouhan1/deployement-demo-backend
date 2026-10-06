import type { Application } from "express";
import request from "supertest";

import { USER_TYPE } from "@/enums";
import { CUSTOMER_ID } from "@/modules/subscription/__tests__/utils/subscription.constant";
import { ADMIN_SUBSCRIPTION_PATH } from "@/modules/subscription/__tests__/utils/subscription.constant";
import {
  createCompanylessSession,
  createTestSession,
  ITestSession,
} from "@/tests/utils/auth";

// Only the cookie is ever read, so companyless sessions work here too.
type TCallerSession = Pick<ITestSession, "cookie">;

/**
 * An admin who already has a Stripe customer. Without stripeCustomerId the
 * controller's first step calls Stripe to create one, which drags an unrelated
 * stub into every subscription test.
 */
export function createBillingAdminSession(
  stripeCustomerId: string = CUSTOMER_ID,
) {
  return createTestSession(USER_TYPE.ADMIN, { stripeCustomerId });
}

/** The same billing admin, but belonging to no company at all. */
export function createCompanylessBillingSession(
  stripeCustomerId: string = CUSTOMER_ID,
) {
  return createCompanylessSession(USER_TYPE.ADMIN, { stripeCustomerId });
}

export function getUserPlans(app: Application, session: TCallerSession) {
  return request(app)
    .get(ADMIN_SUBSCRIPTION_PATH)
    .set("Cookie", session.cookie)
    .set("Accept", "application/json");
}

export function postCreateSubscription(
  app: Application,
  session: TCallerSession,
  body: Record<string, unknown>,
) {
  return request(app)
    .post(ADMIN_SUBSCRIPTION_PATH)
    .set("Cookie", session.cookie)
    .set("Accept", "application/json")
    .send(body);
}

export function putCancelSubscription(
  app: Application,
  session: TCallerSession,
  body: Record<string, unknown>,
) {
  return request(app)
    .put(`${ADMIN_SUBSCRIPTION_PATH}/cancel`)
    .set("Cookie", session.cookie)
    .set("Accept", "application/json")
    .send(body);
}

export function postChangeSubscription(
  app: Application,
  session: TCallerSession,
  body: Record<string, unknown>,
) {
  return request(app)
    .post(`${ADMIN_SUBSCRIPTION_PATH}/plans`)
    .set("Cookie", session.cookie)
    .set("Accept", "application/json")
    .send(body);
}
