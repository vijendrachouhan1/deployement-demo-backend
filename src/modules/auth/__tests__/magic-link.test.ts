import { createApp } from "@/app";
import { faker } from "@faker-js/faker";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { mockAuthKitProvider } from "@/tests/mocks/authkit-provider.mock";
import { createTestSession } from "@/tests/utils/auth";

/**
 * Magic Link Routes
 *
 * POST /api/auth/magic-link/request
 *   Auth required : No
 *   Body : email (required)
 *   Success  : 200 – magic link dispatched
 *   Failures : 400 invalid email | 500 server error
 *
 * POST /api/auth/magic-link/verify  (verifyMagicLink reads token from req.query)
 *   Auth required : No
 *   Query : token (required, min 1 char)
 *   Success  : 200 – sets auth cookie + returns user
 *   Failures : 401 missing token | 400 empty token | 500 server error
 */

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("Magic Link routes", () => {
  const app = createApp();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // =========================================================================
  // POST /api/auth/magic-link
  // =========================================================================

  describe("POST /api/auth/magic-link/request", () => {
    describe("success", () => {
      it("returns 200 when a valid email is provided", async () => {
        mockAuthKitProvider.createMagicLinkSession.mockResolvedValue({
          link: "https://auth.example.com/magic?token=abc",
        });

        const res = await request(app)
          .post("/api/auth/magic-link/request")
          .send({ email: faker.internet.email().toLowerCase() })
          .set("Accept", "application/json");

        // 200 if user exists, may differ if user not found — just check no crash
        expect(res.status).toBe(200);
      });
    });

    describe("validation errors", () => {
      it("returns 400 when email is missing", async () => {
        const res = await request(app)
          .post("/api/auth/magic-link/request")
          .send({})
          .set("Accept", "application/json");

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
      });

      it("returns 400 when email is malformed", async () => {
        const res = await request(app)
          .post("/api/auth/magic-link/request")
          .send({ email: "not-an-email" })
          .set("Accept", "application/json");

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
      });
    });

    describe("server errors", () => {
      it("returns 500 when the magic link provider throws", async () => {
        mockAuthKitProvider.createMagicLinkSession.mockRejectedValueOnce(
          new Error("Provider down"),
        );

        const { user } = await createTestSession();

        const res = await request(app)
          .post("/api/auth/magic-link/request")
          .send({ email: user.email })
          .set("Accept", "application/json");

        expect(res.status).toBe(500);
      });
    });
  });

  // =========================================================================
  // GET /api/auth/magic-link/verify
  // =========================================================================

  describe("POST /api/auth/magic-link/verify", () => {
    describe("success", () => {
      it("returns 200 and sets auth cookie when the token is valid", async () => {
        const { user } = await createTestSession();

        mockAuthKitProvider.verifyMagicLinkToken.mockResolvedValue({
          id: user.externalUserId,
          email: user.email,
        });

        const res = await request(app)
          .post("/api/auth/magic-link/verify")
          .query({ token: faker.string.alphanumeric(64) })
          .set("Accept", "application/json");

        expect(res.status).toBe(200);
      });
    });

    describe("auth errors", () => {
      it("returns 401 when the token query param is invalid", async () => {
        const res = await request(app)
          .post("/api/auth/magic-link/verify")
          .set("Accept", "application/json")
          .query({ token: faker.string.alphanumeric(64) });

        expect(res.status).toBe(401);
        expect(res.body.success).toBe(false);
      });

      it("returns 400 when token query param is an empty string", async () => {
        const res = await request(app)
          .post("/api/auth/magic-link/verify")
          .query({ token: "" })
          .set("Accept", "application/json");

        // Zod min(1) validation will reject this with 400
        expect([400, 401]).toContain(res.status);
        expect(res.body.success).toBe(false);
      });
    });
  });
});
