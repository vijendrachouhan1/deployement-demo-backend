export enum STRIPE_WEBHOOK_EVENT {
  CHECKOUT_SESSION_COMPLETED = "checkout.session.completed",
  CHARGE_UPDATED = "charge.updated",
  CHARGE_SUCCEEDED = "charge.succeeded",
  CHARGE_REFUNDED = "charge.refunded",
  PAYMENT_INTENT_SUCCEEDED = "payment_intent.succeeded",
  CUSTOMER_SUBSCRIPTION_UPDATED = "customer.subscription.updated",
  CUSTOMER_SUBSCRIPTION_DELETED = "customer.subscription.deleted",
  INVOICE_PAYMENT_FAILED = "invoice.payment_failed",
}

export enum REFUND_STATUS {
  PENDING = "PENDING",
  COMPLETED = "COMPLETED",
  FAILED = "FAILED",
  FULLY_REFUNDED = "FULLY_REFUNDED",
  PARTIALLY_REFUNDED = "PARTIALLY_REFUNDED",
}
