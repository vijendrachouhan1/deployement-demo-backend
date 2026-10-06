import { createApp } from "@/app";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import mongoose from "mongoose";

import { User } from "@/db/models/user";
import { createTestSession } from "@/tests/utils/auth";

/**
 * PUT /api/auth/:id/unsubscribe
 *
 * Auth required : No (opened via an emailed link)
 * Input         : id (path param — user _id)
 *
 * Success  : 200 – flips subscribedToNewsletter to false
 * Failures : 500 malformed id
 */

describe("PUT /api/auth/:id/unsubscribe", () => {
  const app = createApp();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("success", () => {
    it("returns 200 and unsubscribes the user from the newsletter", async () => {
      const { user } = await createTestSession(undefined, {
        subscribedToNewsletter: true,
      });

      const res = await request(app)
        .put(`/api/auth/${user._id.toString()}/unsubscribe`)
        .set("Accept", "application/json");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const updated = await User.findById(user._id);
      expect(updated?.subscribedToNewsletter).toBe(false);
    });

    it("returns 200 for a well-formed id that matches no user", async () => {
      const res = await request(app)
        .put(
          `/api/auth/${new mongoose.Types.ObjectId().toString()}/unsubscribe`,
        )
        .set("Accept", "application/json");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe("server errors", () => {
    it("returns 500 when the id is not a valid ObjectId", async () => {
      const res = await request(app)
        .put("/api/auth/not-a-valid-id/unsubscribe")
        .set("Accept", "application/json");

      expect(res.status).toBe(500);
    });
  });
});
