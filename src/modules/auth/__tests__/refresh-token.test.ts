import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createApp } from "@/app";
import { RefreshToken } from "@/db/models/refreshToken";
import { STATUS, USER_TYPE } from "@/enums";
import {
  refreshCookie,
  setCookies,
} from "@/modules/auth/__tests__/utils/auth-test.util";
import { generateAndSaveRefreshToken } from "@/modules/auth/helpers/token.helper";
import { createTestSession } from "@/tests/utils/auth";

/**
 * POST /api/auth/refresh-token
 *
 * Auth required : refresh-token cookie
 * Input         : refreshToken cookie
 *
 * Success  : 200 – rotates the token pair, sets fresh auth cookies
 * Failures : 401 missing / invalid / expired / consumed token | disabled account
 *
 * Business rule under test: refresh tokens are single-use. A successful refresh
 * consumes the presented token and issues a new one; presenting the old token
 * again must be rejected (reuse-after-rotation).
 */

describe("POST /api/auth/refresh-token", () => {
  const app = createApp();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // =========================================================================
  // 1. Happy path
  // =========================================================================

  describe("success", () => {
    it("returns 200 and rotates the token pair for a valid refresh token", async () => {
      const { user } = await createTestSession();
      const token = await generateAndSaveRefreshToken(user._id);

      const res = await request(app)
        .post("/api/auth/refresh-token")
        .set("Cookie", refreshCookie(token))
        .set("Accept", "application/json");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it("sets fresh auth cookies on success", async () => {
      const { user } = await createTestSession();
      const token = await generateAndSaveRefreshToken(user._id);

      const res = await request(app)
        .post("/api/auth/refresh-token")
        .set("Cookie", refreshCookie(token))
        .set("Accept", "application/json");

      const cookies = setCookies(res);
      expect(cookies).toBeDefined();
      expect(cookies.some((c) => c.startsWith("token="))).toBe(true);
      expect(cookies.some((c) => c.startsWith("refreshToken="))).toBe(true);
    });

    it("consumes the presented refresh token and stores a new one", async () => {
      const { user } = await createTestSession();
      const token = await generateAndSaveRefreshToken(user._id);

      await request(app)
        .post("/api/auth/refresh-token")
        .set("Cookie", refreshCookie(token))
        .set("Accept", "application/json");

      // Old token gone, exactly one fresh token persisted for the user.
      const old = await RefreshToken.findOne({ token });
      expect(old).toBeNull();
      const remaining = await RefreshToken.countDocuments({ userId: user._id });
      expect(remaining).toBe(1);
    });
  });

  // =========================================================================
  // 2. Auth errors
  // =========================================================================

  describe("auth errors", () => {
    it("returns 401 when no refresh-token cookie is present", async () => {
      const res = await request(app)
        .post("/api/auth/refresh-token")
        .set("Accept", "application/json");

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it("returns 401 when the refresh token does not exist in the store", async () => {
      const res = await request(app)
        .post("/api/auth/refresh-token")
        .set("Cookie", refreshCookie("does-not-exist"))
        .set("Accept", "application/json");

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });
  });

  // =========================================================================
  // 3. Business scenarios
  // =========================================================================

  describe("business scenarios", () => {
    it("rejects a token that has already been used (reuse-after-rotation)", async () => {
      const { user } = await createTestSession();
      const token = await generateAndSaveRefreshToken(user._id);

      const first = await request(app)
        .post("/api/auth/refresh-token")
        .set("Cookie", refreshCookie(token))
        .set("Accept", "application/json");
      expect(first.status).toBe(200);

      const second = await request(app)
        .post("/api/auth/refresh-token")
        .set("Cookie", refreshCookie(token))
        .set("Accept", "application/json");

      expect(second.status).toBe(401);
      expect(second.body.success).toBe(false);
    });

    it("returns 401 and deletes the record when the token is expired", async () => {
      const { user } = await createTestSession();
      const token = "expired-refresh-token";
      await RefreshToken.create({
        userId: user._id,
        token,
        expiresAt: new Date(Date.now() - 60_000),
      });

      const res = await request(app)
        .post("/api/auth/refresh-token")
        .set("Cookie", refreshCookie(token))
        .set("Accept", "application/json");

      expect(res.status).toBe(401);
      const record = await RefreshToken.findOne({ token });
      expect(record).toBeNull();
    });

    it("returns 401 when the owning account is inactive", async () => {
      const { user } = await createTestSession(USER_TYPE.ADMIN, {
        status: STATUS.INACTIVE,
      });
      const token = await generateAndSaveRefreshToken(user._id);

      const res = await request(app)
        .post("/api/auth/refresh-token")
        .set("Cookie", refreshCookie(token))
        .set("Accept", "application/json");

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });
  });
});
