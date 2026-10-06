export const STRIPE_PAYMENT_PATH = "/api/stripe-payment";

export const CUSTOMER_ID = "cus_test_default";
export const CHECKOUT_SESSION_ID = "cs_test_default";
export const CHARGE_ID = "ch_test_default";
export const PAYMENT_INTENT_ID = "pi_test_default";

/** Product price in DOLLARS, as seedStripePaymentProduct writes it. */
export const PRODUCT_PRICE = 50;

/** What the controller must send Stripe for PRODUCT_PRICE — cents. */
export const PRODUCT_PRICE_IN_CENTS = 5000;

const DAY_IN_MS = 24 * 60 * 60 * 1000;

export const daysAgo = (days: number) =>
  new Date(Date.now() - days * DAY_IN_MS);
