// ------
// types
// ------

export type TCreatePaymentIntent = {
  amount: number;
  currency: string;
  customerId: string;
};

export type TBalanceTransactions = {
  limit?: number;
  starting_after?: string;
  ending_before?: string;
};

export type TCreateCoupon = {
  name: string;
  duration: "forever" | "once" | "repeating";
  duration_in_months?: number;
  amount_off?: number;
  currency?: string;
  max_redemptions?: number;
  percent_off?: number;
  redeem_by?: number;
};

export type TListCoupons = {
  limit?: number;
  starting_after?: string;
  ending_before?: string;
};

export type TCreatePromotionCode = {
  coupon: string;
  code: string;
  expires_at?: number;
  max_redemptions?: number;
  active?: boolean;
};

export type TListPromotionCodes = {
  coupon?: string;
  limit?: number;
  starting_after?: string;
  ending_before?: string;
};

type TCreateSubscriptionSuccess = {
  success: true;
  subscriptionId: string;
  clientSecret: string;
};

type TCreateSubscriptionError = {
  success: false;
  error: string;
};

export type TCreateSubscriptionResult =
  TCreateSubscriptionSuccess | TCreateSubscriptionError;

type TUpdateSuccess = {
  success: true;
  subscriptionId: string;
  status: string;
};

type TUpdateSuccessWithClientSecret = {
  success: true;
  subscriptionId: string;
  status: string;
  clientSecret: string;
};

type TUpdateError = {
  success: false;
  error: string;
};

export type TUpdateSubscriptionResult =
  TUpdateSuccess | TUpdateSuccessWithClientSecret | TUpdateError;

// ------
// ENUMS
// ------

export enum PAYMENT_STATUS {
  PENDING = "pending",
  PAID = "paid",
  REFUNDED = "refunded",
}

export enum CURRENCY {
  USD = "usd",
}
