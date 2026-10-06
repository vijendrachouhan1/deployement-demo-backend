import { createApp } from "@/app";
import {
  createCardHolderSession,
  createCustomerlessSession,
  postSetDefaultCard,
} from "@/modules/cards/__tests__/helpers/card-endpoint.helper";
import {
  CARDS_PATH,
  CUSTOMER_ID,
  PAYMENT_METHOD_ID,
} from "@/modules/cards/__tests__/utils/card.constant";
import { stripeMock } from "@/tests/mocks/stripe.mock";
import request from "supertest";
import { describe, expect, it } from "vitest";

/**
 * POST /api/admin/cards/default
 *
 * One endpoint doing two jobs: set a default, or clear it. Clearing is the
 * interesting half, and it was broken twice over. `CardList` sends
 * `paymentMethodId: null` when the switch is toggled off, which the body
 * schema rejected outright; and had it got through, the helper passed
 * `undefined` to Stripe, which the SDK drops from the request body — leaving
 * the old default in place under a "removed successfully" message.
 *
 * Stripe clears the field only for an explicit empty string, so that is what
 * these tests assert reaches the SDK.
 */

describe("POST /api/admin/cards/default", () => {
  const app = createApp();

  describe("setting a default", () => {
    it("updates the customer's default payment method", async () => {
      const session = await createCardHolderSession();
      stripeMock.customers.update.mockResolvedValueOnce({ id: CUSTOMER_ID });

      const res = await postSetDefaultCard(app, session, {
        paymentMethodId: PAYMENT_METHOD_ID,
      });

      expect(res.status).toBe(200);
      expect(stripeMock.customers.update).toHaveBeenCalledWith(CUSTOMER_ID, {
        invoice_settings: { default_payment_method: PAYMENT_METHOD_ID },
      });
    });

    it("updates only the caller's own Stripe customer", async () => {
      const session = await createCardHolderSession("cus_caller_own");
      stripeMock.customers.update.mockResolvedValueOnce({});

      await postSetDefaultCard(app, session, {
        paymentMethodId: PAYMENT_METHOD_ID,
      });

      expect(stripeMock.customers.update).toHaveBeenCalledWith(
        "cus_caller_own",
        expect.anything(),
      );
    });
  });

  describe("clearing the default", () => {
    it("accepts the null the client actually sends", async () => {
      const session = await createCardHolderSession();
      stripeMock.customers.update.mockResolvedValueOnce({});

      const res = await postSetDefaultCard(app, session, {
        paymentMethodId: null,
      });

      expect(res.status).toBe(200);
    });

    it("sends Stripe the empty string that actually unsets the field", async () => {
      const session = await createCardHolderSession();
      stripeMock.customers.update.mockResolvedValueOnce({});

      await postSetDefaultCard(app, session, { paymentMethodId: null });

      expect(stripeMock.customers.update).toHaveBeenCalledWith(CUSTOMER_ID, {
        invoice_settings: { default_payment_method: "" },
      });
    });

    it("never sends undefined, which the SDK would drop", async () => {
      const session = await createCardHolderSession();
      stripeMock.customers.update.mockResolvedValueOnce({});

      await postSetDefaultCard(app, session, { paymentMethodId: null });

      const [, payload] = stripeMock.customers.update.mock.calls[0];
      expect(
        payload.invoice_settings.default_payment_method,
      ).not.toBeUndefined();
    });

    it("clears the default when the field is omitted entirely", async () => {
      const session = await createCardHolderSession();
      stripeMock.customers.update.mockResolvedValueOnce({});

      const res = await postSetDefaultCard(app, session, {});

      expect(res.status).toBe(200);
      expect(stripeMock.customers.update).toHaveBeenCalledWith(CUSTOMER_ID, {
        invoice_settings: { default_payment_method: "" },
      });
    });
  });

  describe("validation errors", () => {
    it("returns 400 for a non-string payment method id", async () => {
      const session = await createCardHolderSession();

      const res = await postSetDefaultCard(app, session, {
        paymentMethodId: 42,
      });

      expect(res.status).toBe(400);
      expect(stripeMock.customers.update).not.toHaveBeenCalled();
    });

    // The controller reads any falsy id as a clear, so "" from an empty form
    // field would wipe the card and report success.
    it("refuses an empty payment method id rather than clearing the default", async () => {
      const session = await createCardHolderSession();

      const res = await postSetDefaultCard(app, session, {
        paymentMethodId: "",
      });

      expect(res.status).toBe(400);
      expect(stripeMock.customers.update).not.toHaveBeenCalled();
    });
  });

  describe("business scenarios", () => {
    it("returns 400 when the caller has no Stripe customer yet", async () => {
      const session = await createCustomerlessSession();

      const res = await postSetDefaultCard(app, session);

      expect(res.status).toBe(400);
      expect(stripeMock.customers.update).not.toHaveBeenCalled();
    });
  });

  describe("server errors", () => {
    it("does not report success when Stripe rejects the update", async () => {
      const session = await createCardHolderSession();
      stripeMock.customers.update.mockRejectedValueOnce(
        new Error("No such payment method"),
      );

      const res = await postSetDefaultCard(app, session);

      expect(res.status).toBeGreaterThanOrEqual(400);
    });
  });

  describe("auth errors", () => {
    it("returns 401 when unauthenticated", async () => {
      const res = await request(app)
        .post(`${CARDS_PATH}/default`)
        .set("Accept", "application/json")
        .send({ paymentMethodId: PAYMENT_METHOD_ID });

      expect(res.status).toBe(401);
    });
  });
});
