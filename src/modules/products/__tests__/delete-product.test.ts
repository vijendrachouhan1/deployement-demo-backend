import { Products } from "@/db/models/products";
import { createApp } from "@/app";
import request from "supertest";
import { describe, expect, it } from "vitest";

import {
  createAdminSession,
  createSuperAdminSession,
  seedProduct,
} from "@/tests/utils/auth";
import mongoose from "mongoose";

describe("DELETE Product routes", () => {
  const app = createApp();

  // =========================================================================
  // DELETE /api/admin/products/:id  — requires ADMIN role
  // =========================================================================

  describe("DELETE /api/admin/products/:id", () => {
    describe("success", () => {
      it("soft deletes the product and returns 200", async () => {
        const session = await createAdminSession();
        const product = await seedProduct(session.company._id);

        const res = await request(app)
          .delete(`/api/admin/products/${product._id}`)
          .set("Cookie", session.cookie)
          .set("Accept", "application/json");

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);

        // Verify it was actually soft deleted
        const dbProduct = await Products.findById(product._id);
        expect(dbProduct).not.toBeNull();
        expect(dbProduct?.status).toBe("DELETED");
      });
    });

    describe("auth errors", () => {
      it("returns 401 when unauthenticated", async () => {
        const session = await createAdminSession();
        const product = await seedProduct(session.company._id);

        const res = await request(app)
          .delete(`/api/admin/products/${product._id}`)
          .set("Accept", "application/json");

        expect(res.status).toBe(401);
      });
    });

    describe("business scenarios", () => {
      it("returns 400 when attempting to delete a product belonging to another company", async () => {
        const sessionA = await createAdminSession();
        const sessionB = await createAdminSession();

        const productB = await seedProduct(sessionB.company._id);

        const res = await request(app)
          .delete(`/api/admin/products/${productB._id}`)
          .set("Cookie", sessionA.cookie)
          .set("Accept", "application/json");

        expect(res.status).toBe(400); // AdminController returns 400 Bad Request
        expect(res.body.success).toBe(false);
      });
    });
  });

  // =========================================================================
  // DELETE /api/super-admin/products/:id — requires SUPER_ADMIN role
  // =========================================================================

  describe("DELETE /api/super-admin/products/:id", () => {
    describe("success", () => {
      it("soft deletes any product regardless of company and returns 200", async () => {
        const superAdminSession = await createSuperAdminSession();
        const randomCompanyId = new mongoose.Types.ObjectId();
        const product = await seedProduct(randomCompanyId);

        const res = await request(app)
          .delete(`/api/super-admin/products/${product._id}`)
          .set("Cookie", superAdminSession.cookie)
          .set("Accept", "application/json");

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
      });
    });

    describe("auth errors", () => {
      it("returns 401 when called by an ADMIN role", async () => {
        const adminSession = await createAdminSession();
        const randomCompanyId = new mongoose.Types.ObjectId();
        const product = await seedProduct(randomCompanyId);

        const res = await request(app)
          .delete(`/api/super-admin/products/${product._id}`)
          .set("Cookie", adminSession.cookie)
          .set("Accept", "application/json");

        expect(res.status).toBe(401);
      });
    });
  });
});
