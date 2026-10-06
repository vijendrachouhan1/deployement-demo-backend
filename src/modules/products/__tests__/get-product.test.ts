import { createApp } from "@/app";
import request from "supertest";
import { describe, expect, it } from "vitest";

import {
  createAdminSession,
  createSuperAdminSession,
  seedProduct,
} from "@/tests/utils/auth";
import mongoose from "mongoose";

describe("GET Product By ID routes", () => {
  const app = createApp();

  // =========================================================================
  // GET /api/products/:id  — requires auth
  // =========================================================================

  describe("GET /api/products/:id", () => {
    describe("success", () => {
      it("returns 200 with the product when it belongs to the user's company", async () => {
        const session = await createAdminSession();
        const product = await seedProduct(session.company._id);

        const res = await request(app)
          .get(`/api/products/${product._id}`)
          .set("Cookie", session.cookie)
          .set("Accept", "application/json");

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data).toHaveProperty("_id", product._id.toString());
        expect(res.body.data).toHaveProperty("title", product.title);
      });
    });

    describe("auth errors", () => {
      it("returns 401 when unauthenticated", async () => {
        const session = await createAdminSession();
        const product = await seedProduct(session.company._id);

        const res = await request(app)
          .get(`/api/products/${product._id}`)
          .set("Accept", "application/json");

        expect(res.status).toBe(401);
      });
    });

    describe("business scenarios", () => {
      it("returns null data when the product belongs to a different company", async () => {
        const sessionA = await createAdminSession();
        const sessionB = await createAdminSession();

        // Company B's product
        const productB = await seedProduct(sessionB.company._id);

        // Company A should not see Company B's product
        const res = await request(app)
          .get(`/api/products/${productB._id}`)
          .set("Cookie", sessionA.cookie)
          .set("Accept", "application/json");

        // Controller returns 200 with null data (findOne returns null)
        expect(res.status).toBe(200);
        expect(res.body.data).toBeNull();
      });

      it("returns null data when an invalid ObjectId is provided", async () => {
        const session = await createAdminSession();

        const res = await request(app)
          .get(`/api/products/${new mongoose.Types.ObjectId()}`)
          .set("Cookie", session.cookie)
          .set("Accept", "application/json");

        expect(res.status).toBe(200);
        expect(res.body.data).toBeNull();
      });
    });
  });

  // =========================================================================
  // GET /api/super-admin/products/:id — requires SUPER_ADMIN role
  // =========================================================================

  describe("GET /api/super-admin/products/:id", () => {
    describe("success", () => {
      it("returns 200 and fetches the product regardless of company", async () => {
        const superAdminSession = await createSuperAdminSession();

        const randomCompanyId = new mongoose.Types.ObjectId();
        const product = await seedProduct(randomCompanyId);

        const res = await request(app)
          .get(`/api/super-admin/products/${product._id}`)
          .set("Cookie", superAdminSession.cookie)
          .set("Accept", "application/json");

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data).toHaveProperty("_id", product._id.toString());
        expect(res.body.data).toHaveProperty("title", product.title);
      });
    });

    describe("auth errors", () => {
      it("returns 401 when unauthenticated", async () => {
        const randomCompanyId = new mongoose.Types.ObjectId();
        const product = await seedProduct(randomCompanyId);

        const res = await request(app)
          .get(`/api/super-admin/products/${product._id}`)
          .set("Accept", "application/json");

        expect(res.status).toBe(401);
      });

      it("returns 401 when called by an ADMIN role (not super admin)", async () => {
        const adminSession = await createAdminSession();
        const product = await seedProduct(adminSession.company._id);

        const res = await request(app)
          .get(`/api/super-admin/products/${product._id}`)
          .set("Cookie", adminSession.cookie)
          .set("Accept", "application/json");

        expect(res.status).toBe(401);
      });
    });

    describe("business scenarios", () => {
      it("returns null data when an invalid ObjectId is provided", async () => {
        const superAdminSession = await createSuperAdminSession();

        const res = await request(app)
          .get(`/api/super-admin/products/${new mongoose.Types.ObjectId()}`)
          .set("Cookie", superAdminSession.cookie)
          .set("Accept", "application/json");

        expect(res.status).toBe(200);
        expect(res.body.data).toBeNull();
      });
    });
  });
});
