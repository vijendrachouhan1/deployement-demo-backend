import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createApp } from "@/app";
import { RefreshToken } from "@/db/models/refreshToken";
import {
  refreshCookie,
  setCookies,
} from "@/modules/auth/__tests__/utils/auth-test.util";
import { generateAndSaveRefreshToken } from "@/modules/auth/helpers/token.helper";
import { createTestSession } from "@/tests/utils/auth";

/**
 * POST /api/auth/revoke-token
 *
 * Auth required : refresh-token cookie (optional — no-op without it)
 * Input         : refreshToken cookie
 *
 * Success  : 200 – deletes the session's refresh token and clears auth cookies
 *
 * Business rule under test: once revoked, the token can no longer be exchanged
 * for a new session via refresh-token.
 */

describe("POST /api/auth/revoke-token", () => {
  const app = createApp();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("success", () => {
    it("returns 200 and deletes the refresh token from the store", async () => {
      const { user } = await createTestSession();
      const token = await generateAndSaveRefreshToken(user._id);

      const res = await request(app)
        .post("/api/auth/revoke-token")
        .set("Cookie", refreshCookie(token))
        .set("Accept", "application/json");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const record = await RefreshToken.findOne({ token });
      expect(record).toBeNull();
    });

    it("clears the auth cookies on the response", async () => {
      const { user } = await createTestSession();
      const token = await generateAndSaveRefreshToken(user._id);

      const res = await request(app)
        .post("/api/auth/revoke-token")
        .set("Cookie", refreshCookie(token))
        .set("Accept", "application/json");

      const cookies = setCookies(res);
      expect(cookies).toBeDefined();
      // Cleared cookies are expired (empty value + past/epoch expiry).
      expect(cookies.some((c) => c.startsWith("token=;"))).toBe(true);
    });

    it("is a no-op that still returns 200 when no refresh cookie is present", async () => {
      const res = await request(app)
        .post("/api/auth/revoke-token")
        .set("Accept", "application/json");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe("business scenarios", () => {
    it("prevents a revoked token from being refreshed afterwards", async () => {
      const { user } = await createTestSession();
      const token = await generateAndSaveRefreshToken(user._id);

      await request(app)
        .post("/api/auth/revoke-token")
        .set("Cookie", refreshCookie(token))
        .set("Accept", "application/json");

      const refresh = await request(app)
        .post("/api/auth/refresh-token")
        .set("Cookie", refreshCookie(token))
        .set("Accept", "application/json");

      expect(refresh.status).toBe(401);
    });
  });
});
