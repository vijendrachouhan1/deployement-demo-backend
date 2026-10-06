import { Subscription } from "@/db/models/subscription";
import { StripePaymentCustomer } from "@/db/models/stripePayment/customer";
import { StripePaymentProducts } from "@/db/models/stripePayment/products";
import { StripePaymentTransactions } from "@/db/models/stripePayment/transactions";
import { StripeConnectCustomer } from "@/db/models/stripeConnect/customer";
import { StripeConnectProducts } from "@/db/models/stripeConnect/products";
import { StripeConnectTransactions } from "@/db/models/stripeConnect/transactions";
import { StripeConnectVendor } from "@/db/models/stripeConnect/vendor";
import { USER_TYPE } from "@/enums";
import { createTestSession, type ITestSession } from "@/tests/utils/auth";
import { faker } from "@faker-js/faker";
import mongoose from "mongoose";

/*
 * Mongo factories for the payment models. Kept out of auth.ts on purpose —
 * that file is imported by nearly every test, and pulling eight payment models
 * into it would drag the whole payment schema graph into unrelated suites.
 */

type TObjectId = mongoose.Types.ObjectId;
type TOverrides = Record<string, unknown>;

/** A full test session, or an explicit FK pair for tests that build their own. */
export type TOwner =
  ITestSession | { userRef: TObjectId; companyRef: TObjectId };

function refs(owner: TOwner): { userRef: TObjectId; companyRef: TObjectId } {
  if ("user" in owner) {
    return {
      userRef: owner.user._id,
      companyRef: owner.company._id,
    };
  }
  return owner;
}

// ---------------------------------------------------------------------------
// Subscription
// ---------------------------------------------------------------------------

export async function seedSubscription(
  owner: TOwner,
  overrides: TOverrides = {},
) {
  const { userRef, companyRef } = refs(owner);

  return Subscription.create({
    userRef,
    companyRef,
    planId: "price_test_pro_monthly",
    planName: "Pro",
    // Stripe sends plan.amount in CENTS and the webhook stores it verbatim.
    price: 2900,
    currentPeriodStarts: 1_700_000_000,
    currentPeriodEnds: 1_702_592_000,
    period: "month",
    stripeSubscriptionId: "sub_test_default",
    stripeCustomerId: "cus_test_default",
    productId: "prod_test_pro",
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// Stripe Payment
// ---------------------------------------------------------------------------

export async function seedStripePaymentCustomer(
  owner: TOwner,
  overrides: TOverrides = {},
) {
  const { userRef, companyRef } = refs(owner);

  return StripePaymentCustomer.create({
    userRef,
    companyRef,
    stripeCustomerId: "cus_test_default",
    ...overrides,
  });
}

export async function seedStripePaymentProduct(
  owner: TOwner,
  overrides: TOverrides = {},
) {
  const { userRef, companyRef } = refs(owner);

  return StripePaymentProducts.create({
    title: faker.commerce.productName(),
    // DOLLARS — the controller multiplies by 100 when building line_items.
    price: 50,
    userRef,
    companyRef,
    ...overrides,
  });
}

export async function seedStripePaymentTransaction(
  owner: TOwner,
  overrides: TOverrides = {},
) {
  const { userRef, companyRef } = refs(owner);

  return StripePaymentTransactions.create({
    userRef,
    companyRef,
    stripeCustomerId: "cus_test_default",
    stripeCheckoutSessionId: "cs_test_default",
    stripePaymentIntentId: "pi_test_default",
    stripeChargeId: "ch_test_default",
    // DOLLARS — the webhook writes amount_total / 100.
    amountPaid: 50,
    orderPlacedAt: new Date(),
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// Stripe Connect
// ---------------------------------------------------------------------------

export async function seedStripeConnectCustomer(
  owner: TOwner,
  overrides: TOverrides = {},
) {
  const { userRef, companyRef } = refs(owner);

  return StripeConnectCustomer.create({
    userRef,
    companyRef,
    stripeCustomerId: "cus_test_default",
    ...overrides,
  });
}

export async function seedStripeConnectProduct(
  owner: TOwner,
  overrides: TOverrides = {},
) {
  const { userRef, companyRef } = refs(owner);

  return StripeConnectProducts.create({
    title: faker.commerce.productName(),
    price: 50,
    userRef,
    companyRef,
    stripeAccountId: "acct_test_vendor",
    ...overrides,
  });
}

export async function seedStripeConnectTransaction(
  owner: TOwner,
  overrides: TOverrides = {},
) {
  const { companyRef } = refs(owner);

  return StripeConnectTransactions.create({
    companyRef,
    stripeAccountId: "acct_test_vendor",
    stripeCustomerId: "cus_test_default",
    stripePaymentIntentId: "pi_test_default",
    stripeChargeId: "ch_test_default",
    // DOLLARS. The payout job applies the platform fee to this value.
    amountPaid: 50,
    orderPlacedAt: new Date(),
    ...overrides,
  });
}

export async function seedVendor(owner: TOwner, overrides: TOverrides = {}) {
  const { userRef, companyRef } = refs(owner);

  return StripeConnectVendor.create({
    userRef,
    companyRef,
    stripeAccountId: "acct_test_vendor",
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// Composites
// ---------------------------------------------------------------------------

/**
 * A session whose user already has stripeCustomerId set — the precondition for
 * nearly every subscription/cards route, and for the subscription webhook's
 * User.findOne({ stripeCustomerId }) lookup.
 */
export async function createStripeCustomerSession(
  role: USER_TYPE = USER_TYPE.ADMIN,
  stripeCustomerId = "cus_test_default",
): Promise<ITestSession & { stripeCustomerId: string }> {
  const session = await createTestSession(role, { stripeCustomerId });
  return { ...session, stripeCustomerId };
}

/** Vendor + product + customer all wired to one stripeAccountId. */
export async function seedConnectMarketplace(
  owner: TOwner,
  overrides: {
    vendor?: TOverrides;
    product?: TOverrides;
    customer?: TOverrides;
  } = {},
) {
  const vendor = await seedVendor(owner, overrides.vendor);
  const product = await seedStripeConnectProduct(owner, overrides.product);
  const customer = await seedStripeConnectCustomer(owner, overrides.customer);

  return { vendor, product, customer };
}
