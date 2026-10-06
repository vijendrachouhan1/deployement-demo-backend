import { Products } from "@/db/models/products";
import { createApp } from "@/app";
import { faker } from "@faker-js/faker";
import request from "supertest";
import { describe, expect, it } from "vitest";

import {
  createAdminSession,
  createSuperAdminSession,
  createUserSession,
} from "@/tests/utils/auth";
import mongoose from "mongoose";

describe("POST Create Product routes", () => {
  const app = createApp();

  function buildProductPayload(overrides: Record<string, unknown> = {}) {
    return {
      title: faker.commerce.productName(),
      description: faker.commerce.productDescription(),
      price: parseFloat(faker.commerce.price({ min: 1, max: 999 })),
      ...overrides,
    };
  }

  // =========================================================================
  // POST /api/admin/products  — requires ADMIN role
  // =========================================================================

  describe("POST /api/admin/products", () => {
    describe("success", () => {
      it("creates a product and returns 200 for an ADMIN user", async () => {
        const session = await createAdminSession();
        const payload = buildProductPayload();

        const res = await request(app)
          .post("/api/admin/products")
          .set("Cookie", session.cookie)
          .set("Accept", "application/json")
          .send(payload);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data).toHaveProperty("title", payload.title);
      });

      it("automatically scopes the product to the authenticated user's company", async () => {
        const session = await createAdminSession();
        const payload = buildProductPayload();

        const res = await request(app)
          .post("/api/admin/products")
          .set("Cookie", session.cookie)
          .set("Accept", "application/json")
          .send(payload);

        expect(res.status).toBe(200);

        const dbProduct = await Products.findById(res.body.data._id);
        expect(dbProduct?.companyRef.toString()).toBe(
          session.company._id.toString(),
        );
      });
    });

    describe("auth errors", () => {
      it("returns 401 when unauthenticated", async () => {
        const res = await request(app)
          .post("/api/admin/products")
          .set("Accept", "application/json")
          .send(buildProductPayload());

        expect(res.status).toBe(401);
        expect(res.body.success).toBe(false);
      });

      it("returns 403 when called by a USER role (authenticated but lacks permission)", async () => {
        const session = await createUserSession();

        const res = await request(app)
          .post("/api/admin/products")
          .set("Cookie", session.cookie)
          .set("Accept", "application/json")
          .send(buildProductPayload());

        expect(res.status).toBe(403);
        expect(res.body.success).toBe(false);
      });
    });

    describe("validation errors", () => {
      it("returns 400 when title is missing", async () => {
        const session = await createAdminSession();
        const { title: _t, ...payload } = buildProductPayload() as any;

        const res = await request(app)
          .post("/api/admin/products")
          .set("Cookie", session.cookie)
          .set("Accept", "application/json")
          .send(payload);

        expect(res.status).toBe(400);
      });

      it("returns 400 when price is negative", async () => {
        const session = await createAdminSession();
        const payload = buildProductPayload({ price: -5 });

        const res = await request(app)
          .post("/api/admin/products")
          .set("Cookie", session.cookie)
          .set("Accept", "application/json")
          .send(payload);

        expect(res.status).toBe(400);
      });
    });
  });

  // =========================================================================
  // POST /api/super-admin/products — requires SUPER_ADMIN role
  // =========================================================================

  describe("POST /api/super-admin/products", () => {
    describe("success", () => {
      it("creates a product for the specified companyRef and returns 200", async () => {
        const superAdminSession = await createSuperAdminSession();
        const companyRef = new mongoose.Types.ObjectId().toString();
        const payload = buildProductPayload({ companyRef });

        const res = await request(app)
          .post("/api/super-admin/products")
          .set("Cookie", superAdminSession.cookie)
          .set("Accept", "application/json")
          .send(payload);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data).toHaveProperty("title", payload.title);
        expect(res.body.data).toHaveProperty("companyRef", companyRef);

        const dbProduct = await Products.findById(res.body.data._id);
        expect(dbProduct?.companyRef.toString()).toBe(companyRef);
      });
    });

    describe("auth errors", () => {
      it("returns 401 when unauthenticated", async () => {
        const payload = buildProductPayload({
          companyRef: new mongoose.Types.ObjectId().toString(),
        });
        const res = await request(app)
          .post("/api/super-admin/products")
          .set("Accept", "application/json")
          .send(payload);

        expect(res.status).toBe(401);
      });

      it("returns 401 when called by ADMIN role", async () => {
        const session = await createAdminSession();
        const payload = buildProductPayload({
          companyRef: new mongoose.Types.ObjectId().toString(),
        });

        const res = await request(app)
          .post("/api/super-admin/products")
          .set("Cookie", session.cookie)
          .set("Accept", "application/json")
          .send(payload);

        expect(res.status).toBe(401);
      });
    });

    describe("validation errors", () => {
      it("returns 500/error when companyRef is missing in payload", async () => {
        const superAdminSession = await createSuperAdminSession();
        const payload = buildProductPayload(); // no companyRef

        const res = await request(app)
          .post("/api/super-admin/products")
          .set("Cookie", superAdminSession.cookie)
          .set("Accept", "application/json")
          .send(payload);

        // ProductSuperAdminController throws "Company Ref is required" which gets bubbled to 500 error handler
        expect(res.status).toBe(500);
      });
    });
  });
});
