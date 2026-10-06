// Endpoint paths
export const STRIPE_CONNECT_PATH = "/api/stripe-connect";

export const CONNECT_CUSTOMER_ID = "cus_test_default";
export const OTHER_CONNECT_CUSTOMER_ID = "cus_test_someone_else";
export const CHARGE_ID = "ch_test_default";
export const VENDOR_ACCOUNT_ID = "acct_test_vendor";

/** Matches REFUND_ELIGIBILITY_DAYS; the window is inclusive of day 10. */
export const REFUND_WINDOW_DAYS = 10;

export function daysAgo(days: number) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}
