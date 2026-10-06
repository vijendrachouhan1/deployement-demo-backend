export const STRIPE_CONNECT_MESSAGES = {
  SUCCESS: "Success",
  PRODUCT_NOT_FOUND: "Product not found",
  CUSTOMER_ALREADY_EXISTS: "Customer already exists",
  CANT_BE_REFUNDED: "Cant be refunded",
  COMPLETE_ONBOARDING: "Complete the onboarding process to access details.",
  STRIPE_ACCOUNT_NOT_CREATED: "Stripe Account not yet created",
  PRODUCT_UPDATED: "Product updated.",
  PRODUCT_DELETED: "Product deleted.",
  UNAUTHORIZED_REQUEST: "You are not authorized for this request.",
  ORDER_NOT_FOUND: "Order not found.",
  NO_COMPANY: "No company is associated with this account.",
  ORDER_ALREADY_REFUNDED: "This order has already been refunded.",
  REFUND_WINDOW_EXPIRED: "The refund window for this order has passed.",
  CHARGE_NOT_SETTLED: "This payment has not settled yet. Try again shortly.",
} as const;

/** Shown where an order outlived the product it was for. */
export const DELETED_PRODUCT_NAME = "Product no longer available";

export const REFUND_ELIGIBILITY_DAYS = 10;
