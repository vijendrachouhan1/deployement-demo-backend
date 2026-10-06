import request from "supertest";
import { describe, expect, it } from "vitest";

import { createApp } from "@/app";
import { User } from "@/db/models/user";
import { COOKIE_NAME, USER_TYPE } from "@/enums";
import { ENROLLED_MFA } from "@/modules/auth/__tests__/utils/auth-test.constant";
import { buildPasswordLoginPayload } from "@/modules/auth/__tests__/utils/auth-test.payload";
import {
  hasCookie,
  legacyPendingMfaCookie,
  mockPasswordLogin,
  pendingMfaCookie,
  setCookies,
} from "@/modules/auth/__tests__/utils/auth-test.util";
import { PENDING_MFA_PURPOSE } from "@/modules/auth/utils/auth.enum";
import { createTestSession } from "@/tests/utils/auth";

/**
 * Which credential opens which /api/auth/mfa route.
 *
 * One middleware used to guard every route and accept any pending token, so the
 * token handed out mid-login — before the second factor had been produced —
 * could call setup/skip or disable and clear the very factor the login was
 * waiting on. A password alone was then enough to defeat MFA.
 *
 * These cases exist to keep that closed.
 */

const app = createApp();

type TRoute = { method: "post" | "put"; path: string; label: string };

const SETUP_ROUTES: TRoute[] = [
  {
    method: "post",
    path: "/api/auth/mfa/setup/initiate",
    label: "setup/initiate",
  },
  { method: "post", path: "/api/auth/mfa/setup/verify", label: "setup/verify" },
  { method: "post", path: "/api/auth/mfa/setup/skip", label: "setup/skip" },
];

const LOGIN_CHALLENGE_ROUTES: TRoute[] = [
  { method: "post", path: "/api/auth/mfa/verify", label: "verify" },
  { method: "post", path: "/api/auth/mfa/recovery", label: "recovery" },
];

const SESSION_ONLY_ROUTES: TRoute[] = [
  {
    method: "post",
    path: "/api/auth/mfa/reset/email/otp",
    label: "reset/email/otp",
  },
  {
    method: "post",
    path: "/api/auth/mfa/reset/identity/verify",
    label: "reset/identity/verify",
  },
  {
    method: "post",
    path: "/api/auth/mfa/recovery/reset",
    label: "recovery/reset",
  },
  { method: "put", path: "/api/auth/mfa/disable", label: "disable" },
];

const call = (route: TRoute, cookie: string) => {
  const agent = request(app);

  return agent[route.method](route.path)
    .set("Cookie", [cookie])
    .set("Accept", "application/json");
};

describe("MFA route authorization — /api/auth/mfa", () => {
  describe("a login pending token", () => {
    it.each(SETUP_ROUTES)(
      "cannot reach $label",
      async ({ method, path, label }) => {
        const { user } = await createTestSession(USER_TYPE.ADMIN, {
          mfa: ENROLLED_MFA,
        });

        const res = await call(
          { method, path, label },
          pendingMfaCookie(user._id.toString(), PENDING_MFA_PURPOSE.LOGIN),
        );

        expect(res.status).toBe(401);
      },
    );

    it.each(SESSION_ONLY_ROUTES)(
      "cannot reach $label",
      async ({ method, path, label }) => {
        const { user } = await createTestSession(USER_TYPE.ADMIN, {
          mfa: ENROLLED_MFA,
        });

        const res = await call(
          { method, path, label },
          pendingMfaCookie(user._id.toString(), PENDING_MFA_PURPOSE.LOGIN),
        );

        expect(res.status).toBe(401);
      },
    );

    it.each(LOGIN_CHALLENGE_ROUTES)(
      "is admitted to $label, where a real factor is still demanded",
      async ({ method, path, label }) => {
        const { user } = await createTestSession(USER_TYPE.ADMIN, {
          mfa: ENROLLED_MFA,
        });

        const res = await call(
          { method, path, label },
          pendingMfaCookie(user._id.toString(), PENDING_MFA_PURPOSE.LOGIN),
        );

        // Past the gate — refused on the code itself, not on the credential.
        expect(res.status).not.toBe(401);
      },
    );
  });

  describe("a signup pending token", () => {
    it.each(LOGIN_CHALLENGE_ROUTES)(
      "cannot reach $label",
      async ({ method, path, label }) => {
        const { user } = await createTestSession(USER_TYPE.ADMIN, {
          mfa: ENROLLED_MFA,
        });

        const res = await call(
          { method, path, label },
          pendingMfaCookie(user._id.toString(), PENDING_MFA_PURPOSE.SIGNUP),
        );

        expect(res.status).toBe(401);
      },
    );

    it.each(SESSION_ONLY_ROUTES)(
      "cannot reach $label",
      async ({ method, path, label }) => {
        const { user } = await createTestSession(USER_TYPE.ADMIN, {
          mfa: ENROLLED_MFA,
        });

        const res = await call(
          { method, path, label },
          pendingMfaCookie(user._id.toString(), PENDING_MFA_PURPOSE.SIGNUP),
        );

        expect(res.status).toBe(401);
      },
    );

    it("is admitted to setup/initiate, the flow it belongs to", async () => {
      const { user } = await createTestSession();

      const res = await call(
        SETUP_ROUTES[0],
        pendingMfaCookie(user._id.toString(), PENDING_MFA_PURPOSE.SIGNUP),
      );

      expect(res.status).toBe(200);
    });
  });

  describe("a token with no purpose claim", () => {
    it.each([
      ...SETUP_ROUTES,
      ...LOGIN_CHALLENGE_ROUTES,
      ...SESSION_ONLY_ROUTES,
    ])("cannot reach $label", async ({ method, path, label }) => {
      const { user } = await createTestSession(USER_TYPE.ADMIN, {
        mfa: ENROLLED_MFA,
      });

      const res = await call(
        { method, path, label },
        legacyPendingMfaCookie(user._id.toString()),
      );

      expect(res.status).toBe(401);
    });
  });

  describe("a full session", () => {
    it.each([...SETUP_ROUTES, ...SESSION_ONLY_ROUTES])(
      "still reaches $label",
      async ({ method, path, label }) => {
        const { cookie } = await createTestSession(USER_TYPE.ADMIN, {
          mfa: ENROLLED_MFA,
        });

        const res = await call({ method, path, label }, cookie);

        expect(res.status).not.toBe(401);
      },
    );
  });

  // =========================================================================
  // The bypass this all exists to prevent, driven end to end
  // =========================================================================

  describe("end to end", () => {
    it("cannot turn a password login into a session by skipping setup", async () => {
      const { user } = await createTestSession(USER_TYPE.ADMIN, {
        mfa: ENROLLED_MFA,
      });
      mockPasswordLogin(user);

      const loginRes = await request(app)
        .post("/api/auth/login")
        .send(buildPasswordLoginPayload({ email: user.email }))
        .set("Accept", "application/json");

      expect(loginRes.body.messageCode).toBe("MFA_REQUIRED");
      expect(hasCookie(loginRes, COOKIE_NAME.TOKEN)).toBe(false);

      const pending = setCookies(loginRes)
        .filter((c) => c.startsWith(`${COOKIE_NAME.PENDING_MFA_TOKEN}=`))
        .map((c) => c.split(";")[0]);

      const skipRes = await request(app)
        .post("/api/auth/mfa/setup/skip")
        .set("Cookie", pending)
        .set("Accept", "application/json");

      expect(skipRes.status).toBe(401);
      expect(hasCookie(skipRes, COOKIE_NAME.TOKEN)).toBe(false);

      // And the factor the login is waiting on is still standing.
      const after = await User.findById(user._id).lean();
      expect(after?.mfa.enrolled).toBe(true);
      expect(after?.mfa.factorId).toBe(ENROLLED_MFA.factorId);
    });

    it("cannot disable MFA with a login pending token", async () => {
      const { user } = await createTestSession(USER_TYPE.ADMIN, {
        mfa: ENROLLED_MFA,
      });
      mockPasswordLogin(user);

      const loginRes = await request(app)
        .post("/api/auth/login")
        .send(buildPasswordLoginPayload({ email: user.email }))
        .set("Accept", "application/json");

      const pending = setCookies(loginRes)
        .filter((c) => c.startsWith(`${COOKIE_NAME.PENDING_MFA_TOKEN}=`))
        .map((c) => c.split(";")[0]);

      const res = await request(app)
        .put("/api/auth/mfa/disable")
        .set("Cookie", pending)
        .set("Accept", "application/json");

      expect(res.status).toBe(401);

      const after = await User.findById(user._id).lean();
      expect(after?.mfa.enrolled).toBe(true);
      expect(after?.mfa.enabled).toBe(true);
    });
  });
});
