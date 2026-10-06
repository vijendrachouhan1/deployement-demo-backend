import request from "supertest";

import { createApp } from "@/app";
import { buildPasswordLoginPayload } from "@/modules/auth/__tests__/utils/auth-test.payload";
import { mockPasswordLogin } from "@/modules/auth/__tests__/utils/auth-test.util";
import { createTestSession } from "@/tests/utils/auth";

/**
 * Shared harness for the POST /api/auth/login suites, split by concern across:
 *
 * - login.test.ts                — request handling (password, OTP, validation)
 * - login-account-status.test.ts — who is allowed to log in at all
 * - login-session.test.ts        — what a successful login issues
 */

const app = createApp();

/** POSTs the login endpoint with the JSON Accept header every case sets. */
export const login = (
  payload: Record<string, unknown>,
  headers: Record<string, string> = {},
) => {
  const req = request(app)
    .post("/api/auth/login")
    .set("Accept", "application/json");
  for (const [name, value] of Object.entries(headers)) req.set(name, value);
  return req.send(payload);
};

/** Shorthand for the common case: a password login for a seeded user. */
export const loginAs = (
  user: { email: string },
  headers?: Record<string, string>,
) => login(buildPasswordLoginPayload({ email: user.email }), headers);

/**
 * Seeds a user and stubs the provider to authenticate their password login.
 * Tests that must reach the endpoint with the provider *unstubbed* (to prove a
 * refusal happens first) call `createTestSession` directly instead.
 */
export const seedPasswordUser = async (
  ...args: Parameters<typeof createTestSession>
) => {
  const session = await createTestSession(...args);
  mockPasswordLogin(session.user);
  return session;
};
