export enum STRIPE_ACCOUNT {
  EXPRESS = "express",
  APPLICATION = "application",
}

export enum TRANSFER_STATUS {
  PENDING = "pending",
  SUCCEEDED = "succeeded",
  FAILED = "failed",
  SKIPPED = "skipped",
}

export enum PLATFORM_FEE_PERCENTAGE {
  PERCENTAGE = 0.1, // 10%
}

export enum DURATION {
  MONTHLY = "monthly",
  YEARLY = "yearly",
  WEEKLY = "weekly",
}

export enum STRIPE_CONNECT_PAYMENT_STATUS {
  PENDING = "pending", // created payment intent but not paid yet
  PAID = "paid", // Payment done successfully
  REFUNDED = "refunded", // paid but refunded/cancelled the order
}
