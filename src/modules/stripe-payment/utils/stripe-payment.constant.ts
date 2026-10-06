export const STRIPE_PAYMENT_MESSAGES = {
  SUCCESS: "Success",
  PRODUCT_NOT_FOUND: "Product not found",
  ORDER_NOT_FOUND: "Order not found",
  ORDER_ALREADY_REFUNDED: "Order is already refunded",
  REFUND_IN_PROGRESS: "A refund is being processed. Please retry shortly.",
  CUSTOMER_ALREADY_EXISTS: "Customer already exists",
  CANT_BE_REFUNDED: "Can't be refunded",
  REFUND_WINDOW_EXPIRED: "The refund window for this order has closed",
  CHARGE_NOT_SETTLED: "The charge for this order has not settled yet",
  SESSION_EXPIRED: "Session has expired",
  NO_COMPANY: "No company is associated with this account.",
} as const;

export const REFUND_PERIOD = {
  ELIGIBILITY_DAYS: 10,
  CLAIM_DURATION_MS: 15 * 60 * 1000,
} as const;

export const DELETED_PRODUCT_NAME = "Product no longer available";
