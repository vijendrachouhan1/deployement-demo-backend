import { createApp } from "@/app";
import { postCreateCheckoutSession } from "@/modules/stripe-payment/__tests__/helpers/stripe-payment-endpoint.helper";
import {
  CHECKOUT_SESSION_ID,
  CUSTOMER_ID,
  PRODUCT_PRICE,
  PRODUCT_PRICE_IN_CENTS,
} from "@/modules/stripe-payment/__tests__/utils/stripe-payment.constant";
import { stripeMock } from "@/tests/mocks/stripe.mock";
import { createAdminSession } from "@/tests/utils/auth";
import {
  seedStripePaymentCustomer,
  seedStripePaymentProduct,
} from "@/tests/utils/payment-factories";
import { describe, expect, it } from "vitest";

/**
 * How much a checkout asks Stripe for.
 *
 * Prices are stored in dollars and Stripe wants integer cents, so the whole of
 * this conversion is one multiplication — and a float multiplication does not
 * always land on an integer. Stripe rejects a fractional amount outright.
 */

const stripeSession = {
  id: CHECKOUT_SESSION_ID,
  client_secret: "cs_test_default_secret_abc",
};

async function checkoutAt(price: number) {
  const session = await createAdminSession();
  const product = await seedStripePaymentProduct(session, { price });
  await seedStripePaymentCustomer(session);
  stripeMock.checkout.sessions.create.mockResolvedValueOnce(stripeSession);

  await postCreateCheckoutSession(app, session, {
    productId: product._id.toString(),
  });

  const [params] = stripeMock.checkout.sessions.create.mock.calls[0];
  return {
    product,
    unitAmount: params.line_items[0].price_data.unit_amount,
    params,
  };
}

const app = createApp();

describe("POST /api/stripe-payment/create-checkout-session — amounts", () => {
  it("sends the price to Stripe in cents", async () => {
    const { product, params } = await checkoutAt(PRODUCT_PRICE);

    expect(params).toEqual(
      expect.objectContaining({
        customer: CUSTOMER_ID,
        line_items: [
          expect.objectContaining({
            price_data: expect.objectContaining({
              currency: "usd",
              unit_amount: PRODUCT_PRICE_IN_CENTS,
              product_data: { name: product.title },
            }),
            quantity: 1,
          }),
        ],
      }),
    );
  });

  /*
   * 19.99 * 100 is 1998.9999999999998 — Stripe refuses a non-integer amount,
   * so this price could not be bought at all.
   */
  it("sends whole cents for a price a float cannot hold exactly", async () => {
    const { unitAmount } = await checkoutAt(19.99);

    expect(unitAmount).toBe(1999);
    expect(Number.isInteger(unitAmount)).toBe(true);
  });

  it("rounds the half-cent case rather than truncating it", async () => {
    const { unitAmount } = await checkoutAt(0.615);

    expect(unitAmount).toBe(62);
  });
});
