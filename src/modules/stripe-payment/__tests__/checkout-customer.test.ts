import { createApp } from "@/app";
import { StripePaymentCustomer } from "@/db/models/stripePayment/customer";
import { stripePaymentHelper } from "@/modules/stripe-payment/helpers/stripe-payment.helper";
import {
  createCompanylessCheckoutSession,
  postCreateCheckoutSession,
} from "@/modules/stripe-payment/__tests__/helpers/stripe-payment-endpoint.helper";
import { CHECKOUT_SESSION_ID } from "@/modules/stripe-payment/__tests__/utils/stripe-payment.constant";
import { stripeMock } from "@/tests/mocks/stripe.mock";
import { createAdminSession } from "@/tests/utils/auth";
import {
  seedStripePaymentCustomer,
  seedStripePaymentProduct,
} from "@/tests/utils/payment-factories";
import { describe, expect, it, vi } from "vitest";

/** Which Stripe customer a checkout is opened against. */

describe("create-checkout-session — the Stripe customer", () => {
  const app = createApp();

  const stripeSession = {
    id: CHECKOUT_SESSION_ID,
    client_secret: "cs_test_default_secret_abc",
  };

  it("creates a Stripe customer for a first-time buyer", async () => {
    const session = await createAdminSession();
    const product = await seedStripePaymentProduct(session);
    stripeMock.customers.create.mockResolvedValueOnce({ id: "cus_test_new" });
    stripeMock.checkout.sessions.create.mockResolvedValueOnce(stripeSession);

    const res = await postCreateCheckoutSession(app, session, {
      productId: product._id.toString(),
    });

    expect(res.status).toBe(200);
    expect(stripeMock.customers.create).toHaveBeenCalledWith({
      name: `${session.user.name.first} ${session.user.name.last}`,
      email: session.user.email,
    });

    const customer = await StripePaymentCustomer.findOne({
      userRef: session.user._id,
    });
    expect(customer?.stripeCustomerId).toBe("cus_test_new");
  });

  it("reuses an existing Stripe customer", async () => {
    const session = await createAdminSession();
    const product = await seedStripePaymentProduct(session);
    await seedStripePaymentCustomer(session);
    stripeMock.checkout.sessions.create.mockResolvedValueOnce(stripeSession);

    await postCreateCheckoutSession(app, session, {
      productId: product._id.toString(),
    });

    expect(stripeMock.customers.create).not.toHaveBeenCalled();
    expect(await StripePaymentCustomer.countDocuments()).toBe(1);
  });

  // Both requests must read "no customer" before either writes one, so the
  // interleaving is forced rather than left to chance.
  it("settles two concurrent checkouts on a single customer", async () => {
    const session = await createAdminSession();
    const product = await seedStripePaymentProduct(session);
    stripeMock.customers.create
      .mockResolvedValueOnce({ id: "cus_race_a" })
      .mockResolvedValueOnce({ id: "cus_race_b" });
    stripeMock.checkout.sessions.create.mockResolvedValue(stripeSession);

    let bothHaveRead: () => void;
    const bothRead = new Promise<void>((resolve) => {
      bothHaveRead = resolve;
    });
    let reads = 0;
    const readCustomer =
      stripePaymentHelper.getCustomer.bind(stripePaymentHelper);
    vi.spyOn(stripePaymentHelper, "getCustomer").mockImplementation(
      async (userRef) => {
        const existing = await readCustomer(userRef);
        if ((reads += 1) === 2) bothHaveRead();
        await bothRead;
        return existing;
      },
    );

    await Promise.all([
      postCreateCheckoutSession(app, session, {
        productId: product._id.toString(),
      }),
      postCreateCheckoutSession(app, session, {
        productId: product._id.toString(),
      }),
    ]);

    const rows = await StripePaymentCustomer.find({
      userRef: session.user._id,
    });
    expect(rows).toHaveLength(1);

    // The loser adopts the surviving id rather than opening a checkout against
    // the customer it created — that order would be absent from its own
    // buyer's history and unrefundable once the window closed.
    const calls = stripeMock.checkout.sessions.create.mock.calls;
    expect(calls).toHaveLength(2);
    for (const [checkoutData] of calls) {
      expect(checkoutData.customer).toBe(rows[0].stripeCustomerId);
    }
  });

  it("keeps userRef unique, which is what makes the upsert serialize", async () => {
    const indexes = await StripePaymentCustomer.collection.indexes();

    expect(
      indexes.some((index) => index.unique === true && index.key.userRef === 1),
    ).toBe(true);
  });

  it("refuses a companyless caller before creating anything at Stripe", async () => {
    const owner = await createAdminSession();
    const product = await seedStripePaymentProduct(owner);
    const session = await createCompanylessCheckoutSession();

    const res = await postCreateCheckoutSession(app, session, {
      productId: product._id.toString(),
    });

    expect(res.status).toBe(403);
    expect(stripeMock.customers.create).not.toHaveBeenCalled();
    // companyRef is required on the row but the upsert runs no validators, so
    // without the guard this wrote a row every later read expects to be whole.
    expect(await StripePaymentCustomer.countDocuments()).toBe(0);
  });
});
