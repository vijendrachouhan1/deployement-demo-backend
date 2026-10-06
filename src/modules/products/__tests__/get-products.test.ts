import { createApp } from "@/app";
import request from "supertest";
import { describe, expect, it } from "vitest";

import {
  createAdminSession,
  createSuperAdminSession,
  seedProduct,
} from "@/tests/utils/auth";
import mongoose from "mongoose";

describe("GET Products routes", () => {
  const app = createApp();

  // =========================================================================
  // GET /api/products  — requires auth (any role except SYSTEM)
  // =========================================================================

  describe("GET /api/products", () => {
    describe("success", () => {
      it("returns 200 with a paginated list when authenticated as admin", async () => {
        const session = await createAdminSession();

        // Seed two products for this company
        await seedProduct(session.company._id);
        await seedProduct(session.company._id);

        const res = await request(app)
          .get("/api/products")
          .set("Cookie", session.cookie)
          .set("Accept", "application/json");

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data).toHaveProperty("data");
        expect(Array.isArray(res.body.data.data)).toBe(true);
        expect(res.body.data.data.length).toBe(2);
      });

      it("returns 200 with an empty list when no products exist for the company", async () => {
        const session = await createAdminSession();

        const res = await request(app)
          .get("/api/products")
          .set("Cookie", session.cookie)
          .set("Accept", "application/json");

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.data).toHaveLength(0);
      });

      it("only returns products scoped to the authenticated user's company", async () => {
        const sessionA = await createAdminSession();
        const sessionB = await createAdminSession();

        // Seed products for both companies
        await seedProduct(sessionA.company._id, { title: "Company A Product" });
        await seedProduct(sessionB.company._id, { title: "Company B Product" });

        const res = await request(app)
          .get("/api/products")
          .set("Cookie", sessionA.cookie)
          .set("Accept", "application/json");

        expect(res.status).toBe(200);
        expect(res.body.data.data).toHaveLength(1);
        expect(res.body.data.data[0].title).toBe("Company A Product");
      });

      it("returns 200 for mobile clients using Bearer token auth", async () => {
        const session = await createAdminSession();
        await seedProduct(session.company._id);

        const res = await request(app)
          .get("/api/products")
          .set("Authorization", session.bearerHeader)
          .set("x-client-platform", "mobile")
          .set("Accept", "application/json");

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
      });

      it("respects pagination — returns correct page and pageSize", async () => {
        const session = await createAdminSession();

        // Seed 5 products
        await Promise.all(
          Array.from({ length: 5 }).map(() => seedProduct(session.company._id)),
        );

        const res = await request(app)
          .get("/api/products?page=1&pageSize=2")
          .set("Cookie", session.cookie)
          .set("Accept", "application/json");

        expect(res.status).toBe(200);
        expect(res.body.data.data.length).toBeLessThanOrEqual(2);
      });
    });

    describe("auth errors", () => {
      it("returns 401 when no token is provided", async () => {
        const res = await request(app)
          .get("/api/products")
          .set("Accept", "application/json");

        expect(res.status).toBe(401);
        expect(res.body.success).toBe(false);
      });

      it("returns 401 when an invalid/tampered token is provided", async () => {
        const res = await request(app)
          .get("/api/products")
          .set("Cookie", "token=completely.invalid.token")
          .set("Accept", "application/json");

        expect(res.status).toBe(401);
        expect(res.body.success).toBe(false);
      });
    });
  });

  // =========================================================================
  // GET /api/super-admin/products — requires SUPER_ADMIN role
  // =========================================================================

  describe("GET /api/super-admin/products", () => {
    describe("success", () => {
      it("returns 200 and can view all products regardless of company", async () => {
        const superAdminSession = await createSuperAdminSession();

        // Create some products for a random company
        const randomCompanyId = new mongoose.Types.ObjectId();
        await seedProduct(randomCompanyId);
        await seedProduct(randomCompanyId);

        const res = await request(app)
          .get("/api/super-admin/products")
          .set("Cookie", superAdminSession.cookie)
          .set("Accept", "application/json");

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data[0].items.length).toBeGreaterThanOrEqual(2);
      });

      it("respects pagination — returns correct page and pageSize", async () => {
        const superAdminSession = await createSuperAdminSession();
        const randomCompanyId = new mongoose.Types.ObjectId();

        await Promise.all(
          Array.from({ length: 5 }).map(() => seedProduct(randomCompanyId)),
        );

        const res = await request(app)
          .get("/api/super-admin/products?page=1&pageSize=2")
          .set("Cookie", superAdminSession.cookie)
          .set("Accept", "application/json");

        expect(res.status).toBe(200);
        expect(res.body.data[0].items.length).toBeLessThanOrEqual(2);
      });
    });

    describe("auth errors", () => {
      it("returns 401 when unauthenticated", async () => {
        const res = await request(app)
          .get("/api/super-admin/products")
          .set("Accept", "application/json");

        expect(res.status).toBe(401);
        expect(res.body.success).toBe(false);
      });

      it("returns 401 when called by an ADMIN role (not super admin)", async () => {
        const adminSession = await createAdminSession();

        const res = await request(app)
          .get("/api/super-admin/products")
          .set("Cookie", adminSession.cookie)
          .set("Accept", "application/json");

        expect(res.status).toBe(401);
        expect(res.body.success).toBe(false);
      });
    });
  });
});
