import { createApp } from "@/app";
import { faker } from "@faker-js/faker";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { jwtHelper } from "@/helpers/jwt";

/**
 * POST /api/auth/invite/:token
 *
 * Auth required : No
 * Input         : token (path param — a signed invite JWT carrying { email })
 *
 * Success  : 200 – returns the email encoded in the token
 * Failures : 409 – token invalid / tampered / expired
 *
 * (No 400 case: the token is a path segment, so an empty token changes the
 * route rather than failing validation.)
 */

describe("POST /api/auth/invite/:token", () => {
  const app = createApp();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("success", () => {
    it("returns 200 with the email encoded in a valid token", async () => {
      const email = faker.internet.email().toLowerCase();
      const token = jwtHelper.generateToken({ email });

      const res = await request(app)
        .post(`/api/auth/invite/${token}`)
        .set("Accept", "application/json");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toBe(email);
    });
  });

  describe("business scenarios", () => {
    it("returns 409 for a malformed / non-JWT token", async () => {
      const res = await request(app)
        .post("/api/auth/invite/not-a-real-jwt")
        .set("Accept", "application/json");

      expect(res.status).toBe(409);
      expect(res.body.success).toBe(false);
    });

    it("returns 409 for a token signed with the wrong secret", async () => {
      const email = faker.internet.email().toLowerCase();
      const token = jwtHelper.generateToken(
        { email },
        undefined,
        "wrong-secret",
      );

      const res = await request(app)
        .post(`/api/auth/invite/${token}`)
        .set("Accept", "application/json");

      expect(res.status).toBe(409);
      expect(res.body.success).toBe(false);
    });

    it("returns 409 for an expired token", async () => {
      const email = faker.internet.email().toLowerCase();
      const token = jwtHelper.generateToken({ email }, "-1s");

      const res = await request(app)
        .post(`/api/auth/invite/${token}`)
        .set("Accept", "application/json");

      expect(res.status).toBe(409);
      expect(res.body.success).toBe(false);
    });
  });
});
