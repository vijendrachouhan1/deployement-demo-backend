export type TStripeObject = Record<string, unknown>;

export type DeepPartial<T> = T extends (infer U)[]
  ? DeepPartial<U>[]
  : T extends object
    ? { [K in keyof T]?: DeepPartial<T[K]> }
    : T;

/**
 * The four payment states updateExistingSubscription branches on
 * (stripe-subscription.provider.ts:83-131).
 */
export type TSubscriptionPaymentState =
  /** latest_invoice.status === "paid"                   -> success, no clientSecret */
  | "invoice_paid"
  /** payment_intent.status === "succeeded"              -> success, no clientSecret */
  | "pi_succeeded"
  /** payment_intent.status === "requires_action"        -> success + clientSecret (3DS) */
  | "pi_requires_action"
  /** payment_intent.status === "requires_payment_method"-> failure */
  | "pi_requires_payment_method";

export interface IStripeEvent<T = TStripeObject> {
  id: string;
  object: "event";
  api_version: string;
  created: number;
  livemode: boolean;
  pending_webhooks: number;
  request: { id: string; idempotency_key: string | null };
  type: string;
  data: { object: T; previous_attributes: TStripeObject | null };
}

export interface IChargeEventOptions {
  chargeId?: string;
  paymentIntentId?: string;
  customer?: string;
  amount?: number;
}
