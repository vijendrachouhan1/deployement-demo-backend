import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createApp } from "@/app";
import { AuditLogModel } from "@/db/models/audit-logs/audit-log";
import { RefreshToken } from "@/db/models/refreshToken";
import { drainPendingEmits } from "@/modules/audit-logs/helpers/emit.helper";
import { setCookies } from "@/modules/auth/__tests__/utils/auth-test.util";
import { generateAndSaveRefreshToken } from "@/modules/auth/helpers/token.helper";
import { createTestSession } from "@/tests/utils/auth";

/**
 * POST /api/auth/logout
 *
 * Auth required : No (clears cookie regardless)
 * Body         : none, or { refreshToken } for mobile clients that hold no cookies
 *
 * Success  : 200 – revokes the presented refresh token and clears auth cookies
 * Failures : 500 server error
 */

describe("POST /api/auth/logout", () => {
  const app = createApp();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // =========================================================================
  // 1. Happy Path
  // =========================================================================

  describe("success", () => {
    it("returns 200 with a success message", async () => {
      const res = await request(app)
        .post("/api/auth/logout")
        .set("Accept", "application/json");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toBeDefined();
    });

    it("clears the auth cookie on logout", async () => {
      const res = await request(app)
        .post("/api/auth/logout")
        .set("Accept", "application/json");

      expect(res.status).toBe(200);

      // Assert the cookie is there before inspecting it — `setCookies` always
      // returns an array, so guarding on the find result would let this pass
      // against an endpoint that stopped clearing the cookie at all.
      const tokenCookie = setCookies(res).find((c: string) =>
        c.startsWith("token="),
      );
      expect(tokenCookie).toBeDefined();

      // Cleared cookies carry an empty value, Max-Age=0, or a past Expires
      expect(
        tokenCookie!.includes("Max-Age=0") ||
          tokenCookie!.includes("Expires=") ||
          tokenCookie!.startsWith("token=;"),
      ).toBe(true);
    });
  });

  // =========================================================================
  // 2. Refresh-token revocation — the token may arrive by cookie or by body
  // =========================================================================

  describe("refresh-token revocation", () => {
    it("revokes a refresh token presented as a cookie", async () => {
      const { user } = await createTestSession();
      const token = await generateAndSaveRefreshToken(user._id);

      const res = await request(app)
        .post("/api/auth/logout")
        .set("Cookie", [`refreshToken=${token}`])
        .set("Accept", "application/json");

      expect(res.status).toBe(200);
      expect(await RefreshToken.findOne({ token })).toBeNull();
    });

    it("revokes a refresh token presented in the request body", async () => {
      const { user } = await createTestSession();
      const token = await generateAndSaveRefreshToken(user._id);

      const res = await request(app)
        .post("/api/auth/logout")
        .send({ refreshToken: token })
        .set("Accept", "application/json");

      expect(res.status).toBe(200);
      expect(await RefreshToken.findOne({ token })).toBeNull();
    });

    it("leaves other sessions' refresh tokens alone", async () => {
      const { user } = await createTestSession();
      const mine = await generateAndSaveRefreshToken(user._id);
      const theirs = await generateAndSaveRefreshToken(user._id);

      await request(app)
        .post("/api/auth/logout")
        .send({ refreshToken: mine })
        .set("Accept", "application/json");

      expect(await RefreshToken.findOne({ token: theirs })).not.toBeNull();
    });

    it("succeeds without touching the store when no refresh token is presented", async () => {
      const { user } = await createTestSession();
      const token = await generateAndSaveRefreshToken(user._id);

      const res = await request(app)
        .post("/api/auth/logout")
        .set("Accept", "application/json");

      expect(res.status).toBe(200);
      expect(await RefreshToken.findOne({ token })).not.toBeNull();
    });
  });

  // =========================================================================
  // 3. Audit logging
  // =========================================================================

  describe("audit logging", () => {
    it("writes a user.logout entry attributed to the token's actor", async () => {
      const { user, cookie } = await createTestSession();

      await request(app)
        .post("/api/auth/logout")
        .set("Cookie", cookie)
        .set("Accept", "application/json");

      await drainPendingEmits();

      const row = await AuditLogModel.findOne({ action: "user.logout" }).lean();
      expect(row).toBeTruthy();
      expect(row?.actorId?.toString()).toBe(user._id.toString());
    });
  });
});
