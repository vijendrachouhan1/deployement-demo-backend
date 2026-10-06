import { createApp } from "@/app";
import { StripePaymentTransactions } from "@/db/models/stripePayment/transactions";
import { stripePaymentHelper } from "@/modules/stripe-payment/helpers/stripe-payment.helper";
import { postRefund } from "@/modules/stripe-payment/__tests__/helpers/stripe-payment-endpoint.helper";
import {
  daysAgo,
  CHARGE_ID,
} from "@/modules/stripe-payment/__tests__/utils/stripe-payment.constant";
import {
  REFUND_PERIOD,
  STRIPE_PAYMENT_MESSAGES,
} from "@/modules/stripe-payment/utils/stripe-payment.constant";
import { createAdminSession } from "@/tests/utils/auth";
import { seedStripePaymentTransaction } from "@/tests/utils/payment-factories";
import { stripeMock } from "@/tests/mocks/stripe.mock";
import { PAYMENT_STATUS } from "@/providers/payment/stripe/stripe.types";
import { describe, it, expect, vi } from "vitest";

describe("refund recovery", () => {
  const app = createApp();
  const expireClaim = (id: unknown) =>
    StripePaymentTransactions.updateOne(
      { _id: id },
      { $set: { refundClaimExpiresAt: new Date(Date.now() - 1) } },
    );

  it("keeps an in-flight order unrefunded and blocks concurrent claims", async () => {
    const session = await createAdminSession();
    const order = await seedStripePaymentTransaction(session);
    let finish!: (value: { id: string }) => void;
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    stripeMock.refunds.create.mockImplementationOnce(() => {
      entered();
      return new Promise((resolve) => {
        finish = resolve;
      });
    });
    const first = postRefund(app, session, String(order._id)).then(
      (res) => res,
    );
    await started;
    try {
      expect(
        (await StripePaymentTransactions.findById(order._id))?.refunded,
      ).toBe(false);
      const second = await postRefund(app, session, String(order._id));
      expect(second.status).toBe(409);
      expect(second.body.message).toBe(
        STRIPE_PAYMENT_MESSAGES.REFUND_IN_PROGRESS,
      );
      expect(stripeMock.refunds.create).toHaveBeenCalledTimes(1);
    } finally {
      finish({ id: "re_success" });
    }
    expect((await first).status).toBe(200);
    const row = await StripePaymentTransactions.findById(order._id);
    expect(row?.refunded).toBe(true);
    expect(row?.refundClaimId).toBeUndefined();
  });

  it("recovers an abandoned claim after the original eligibility window closes", async () => {
    const session = await createAdminSession();
    const order = await seedStripePaymentTransaction(session, {
      orderPlacedAt: daysAgo(11),
      refundRequestedAt: daysAgo(1),
      refundClaimId: "dead-process",
      refundClaimExpiresAt: new Date(
        Date.now() - REFUND_PERIOD.CLAIM_DURATION_MS,
      ),
    });
    stripeMock.charges.retrieve.mockResolvedValueOnce({ refunded: false });
    stripeMock.refunds.create.mockResolvedValueOnce({ id: "re_success" });
    expect((await postRefund(app, session, String(order._id))).status).toBe(
      200,
    );
    expect(stripeMock.charges.retrieve).toHaveBeenCalledExactlyOnceWith(
      CHARGE_ID,
    );
    expect(stripeMock.refunds.create).toHaveBeenCalledWith(
      { charge: CHARGE_ID },
      { idempotencyKey: `refund_${CHARGE_ID}` },
    );
    expect(
      (await StripePaymentTransactions.findById(order._id))?.refunded,
    ).toBe(true);
  });

  it("recovers after both Stripe and claim release fail", async () => {
    const session = await createAdminSession();
    const order = await seedStripePaymentTransaction(session);
    stripeMock.refunds.create.mockRejectedValueOnce(
      new Error("Stripe unavailable"),
    );
    vi.spyOn(
      stripePaymentHelper,
      "releaseOrderRefundClaim",
    ).mockRejectedValueOnce(new Error("DB unavailable"));
    expect((await postRefund(app, session, String(order._id))).status).toBe(
      500,
    );
    expect(
      (await StripePaymentTransactions.findById(order._id))?.refunded,
    ).toBe(false);
    expect((await postRefund(app, session, String(order._id))).status).toBe(
      409,
    );
    await expireClaim(order._id);
    stripeMock.charges.retrieve.mockResolvedValueOnce({ refunded: false });
    stripeMock.refunds.create.mockResolvedValueOnce({ id: "re_success" });
    expect((await postRefund(app, session, String(order._id))).status).toBe(
      200,
    );
  });

  it("reconciles Stripe success after the final database write fails without issuing another refund", async () => {
    const session = await createAdminSession();
    const order = await seedStripePaymentTransaction(session);
    stripeMock.refunds.create.mockResolvedValueOnce({ id: "re_success" });
    vi.spyOn(stripePaymentHelper, "completeOrderRefund").mockRejectedValueOnce(
      new Error("DB unavailable"),
    );
    expect((await postRefund(app, session, String(order._id))).status).toBe(
      500,
    );
    stripeMock.charges.retrieve.mockResolvedValueOnce({ refunded: true });
    expect((await postRefund(app, session, String(order._id))).status).toBe(
      200,
    );
    expect(stripeMock.refunds.create).toHaveBeenCalledTimes(1);
    const row = await StripePaymentTransactions.findById(order._id);
    expect(row?.refunded).toBe(true);
    expect(row?.paymentStatus).toBe(PAYMENT_STATUS.REFUNDED);
  });

  it("does not issue a refund if recovery cannot determine Stripe's charge status", async () => {
    const session = await createAdminSession();
    const order = await seedStripePaymentTransaction(session, {
      refundRequestedAt: new Date(),
    });
    stripeMock.charges.retrieve.mockRejectedValueOnce(
      new Error("Stripe unavailable"),
    );
    expect((await postRefund(app, session, String(order._id))).status).toBe(
      500,
    );
    expect(stripeMock.refunds.create).not.toHaveBeenCalled();
    const row = await StripePaymentTransactions.findById(order._id);
    expect(row?.refunded).toBe(false);
    expect(row?.refundClaimId).toBeUndefined();
  });

  it("prevents an expired owner from clearing or completing a replacement claim", async () => {
    const session = await createAdminSession();
    const order = await seedStripePaymentTransaction(session);
    const first = await stripePaymentHelper.claimOrderForRefund(
      order._id,
      new Date(),
    );
    await expireClaim(order._id);
    const second = await stripePaymentHelper.claimOrderForRefund(
      order._id,
      first!.refundRequestedAt!,
    );
    expect(second?.refundClaimId).not.toBe(first?.refundClaimId);
    await stripePaymentHelper.releaseOrderRefundClaim(
      order._id,
      first!.refundClaimId!,
    );
    expect(
      (
        await stripePaymentHelper.completeOrderRefund(
          order._id,
          first!.refundClaimId!,
        )
      ).matchedCount,
    ).toBe(0);
    const row = await StripePaymentTransactions.findById(order._id);
    expect(row?.refundClaimId).toBe(second?.refundClaimId);
    expect(row?.refunded).toBe(false);
  });
});
