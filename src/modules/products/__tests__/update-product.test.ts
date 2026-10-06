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

describe("PUT Update Product routes", () => {
  const app = createApp();

  // =========================================================================
  // PUT /api/admin/products/:id  — requires ADMIN role
  // =========================================================================

  describe("PUT /api/admin/products/:id", () => {
    describe("success", () => {
      it("updates the product and returns 200", async () => {
        const session = await createAdminSession();
        const product = await seedProduct(session.company._id, {
          title: "Old Title",
        });

        const res = await request(app)
          .put(`/api/admin/products/${product._id}`)
          .set("Cookie", session.cookie)
          .set("Accept", "application/json")
          .send({ title: "New Title" });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.title).toBe("New Title");

        const dbProduct = await Products.findById(product._id);
        expect(dbProduct?.title).toBe("New Title");
      });
    });

    describe("auth errors", () => {
      it("returns 401 when unauthenticated", async () => {
        const session = await createAdminSession();
        const product = await seedProduct(session.company._id);

        const res = await request(app)
          .put(`/api/admin/products/${product._id}`)
          .set("Accept", "application/json")
          .send({ title: "New Title" });

        expect(res.status).toBe(401);
      });
    });

    describe("business scenarios", () => {
      it("returns 400 when attempting to update a product belonging to another company", async () => {
        const sessionA = await createAdminSession();
        const sessionB = await createAdminSession();
        const productB = await seedProduct(sessionB.company._id);

        const res = await request(app)
          .put(`/api/admin/products/${productB._id}`)
          .set("Cookie", sessionA.cookie)
          .set("Accept", "application/json")
          .send({ title: "Hacked Title" });

        expect(res.status).toBe(400); // AdminController returns 400 Bad Request on findAndUpdate miss
        expect(res.body.success).toBe(false);
      });
    });
  });

  // =========================================================================
  // PUT /api/super-admin/products/:id — requires SUPER_ADMIN role
  // =========================================================================

  describe("PUT /api/super-admin/products/:id", () => {
    describe("success", () => {
      it("updates any product regardless of company and returns 200", async () => {
        const superAdminSession = await createSuperAdminSession();
        const randomCompanyId = new mongoose.Types.ObjectId();
        const product = await seedProduct(randomCompanyId, {
          title: "Original Super Title",
        });

        const res = await request(app)
          .put(`/api/super-admin/products/${product._id}`)
          .set("Cookie", superAdminSession.cookie)
          .set("Accept", "application/json")
          .send({ title: "Updated Super Title" });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.title).toBe("Updated Super Title");
      });

      it("allows updating the companyRef of the product", async () => {
        const superAdminSession = await createSuperAdminSession();
        const initialCompanyId = new mongoose.Types.ObjectId();
        const product = await seedProduct(initialCompanyId);

        const newCompanyId = new mongoose.Types.ObjectId().toString();

        const res = await request(app)
          .put(`/api/super-admin/products/${product._id}`)
          .set("Cookie", superAdminSession.cookie)
          .set("Accept", "application/json")
          .send({ companyRef: newCompanyId });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.companyRef).toBe(newCompanyId);

        const dbProduct = await Products.findById(product._id);
        expect(dbProduct?.companyRef.toString()).toBe(newCompanyId);
      });
    });

    describe("auth errors", () => {
      it("returns 401 when called by an ADMIN role", async () => {
        const adminSession = await createAdminSession();
        const randomCompanyId = new mongoose.Types.ObjectId();
        const product = await seedProduct(randomCompanyId);

        const res = await request(app)
          .put(`/api/super-admin/products/${product._id}`)
          .set("Cookie", adminSession.cookie)
          .set("Accept", "application/json")
          .send({ title: "Doesn't matter" });

        expect(res.status).toBe(401);
      });
    });
  });
});
