import { createApp } from "@/app";
import { postRefund } from "@/modules/stripe-payment/__tests__/helpers/stripe-payment-endpoint.helper";
import { stripeMock } from "@/tests/mocks/stripe.mock";
import { createAdminSession } from "@/tests/utils/auth";
import mongoose from "mongoose";
import { describe, expect, it } from "vitest";

/**
 * POST /api/stripe-payment/refund/:id — the id itself.
 *
 * The handler casts the param straight to an ObjectId, so anything that is not
 * hex used to throw a BSONError out of a route whose entire purpose is turning
 * knowable states into clean responses. Connect's twin was fixed with the
 * refund slice; this is the same guard on the payment surface.
 */

describe("POST /api/stripe-payment/refund/:id — id validation", () => {
  const app = createApp();

  it("400s rather than 500s for an id that is not an ObjectId", async () => {
    const session = await createAdminSession();

    const res = await postRefund(app, session, "not-an-objectid");

    expect(res.status).toBe(400);
  });

  it("never reaches Stripe on a malformed id", async () => {
    const session = await createAdminSession();

    await postRefund(app, session, "abc");

    expect(stripeMock.refunds.create).not.toHaveBeenCalled();
  });

  it("404s for a well-formed id that matches no order", async () => {
    const session = await createAdminSession();

    const res = await postRefund(
      app,
      session,
      new mongoose.Types.ObjectId().toString(),
    );

    expect(res.status).toBe(404);
    expect(stripeMock.refunds.create).not.toHaveBeenCalled();
  });
});
