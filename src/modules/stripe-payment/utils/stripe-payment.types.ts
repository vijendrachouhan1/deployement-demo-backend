import { stripePaymentValidators } from "@/modules/stripe-payment/utils/stripe-payment.validation";
import { TObjectId } from "@/types/common.types";
import { PAYMENT_STATUS } from "@/providers/payment/stripe/stripe.types";

export type TStripePaymentController = typeof stripePaymentValidators;

// ==================== Helper Types ====================

export type TFindAllProductsParams = {
  companyRef: TObjectId;
  filters?: object;
  sorting?: Record<string, 1 | -1>;
  page?: number;
  pageSize?: number;
};

export type TUpdateCustomer = {
  userRef: TObjectId;
  update: {
    stripeCustomerId: string;
  };
};

export type TCreateTransaction = {
  userRef: TObjectId;
  stripeCustomerId: string;
  stripeCheckoutSessionId: string;
  stripePaymentIntentId?: string;
  productRef: TObjectId;
  amountPaid?: number;
  companyRef: TObjectId;
};

export type TUpdateTransaction = {
  id: TObjectId;
  update: {
    paymentStatus?: PAYMENT_STATUS;
    refunded?: boolean;
  };
};

export type TCreateCheckoutSession = {
  customer: string; // stripe customer id
  ui_mode: "embedded";
  mode: "payment";
  redirect_on_completion: "never";
  allow_promotion_codes: boolean;
  line_items: {
    price_data: {
      currency: string;
      unit_amount: number;
      product_data: {
        name: string;
      };
    };
    quantity: number;
  }[];
};

export type TGetAllOrdersOptions = {
  filters: object;
  sorting: Record<string, 1 | -1>;
  skips: number;
  page: number;
  pageSize: number;
  searchFilter: object;
};

export type TCreateProduct = {
  title: string;
  price: number;
  userRef: TObjectId;
  companyRef: TObjectId;
};

export type TGetTransactionsOptions = {
  filters?: Record<string, unknown>;
  sorting?: Record<string, 1 | -1>;
  skips: number;
  page: number;
  pageSize: number;
  searchFilter?: object;
  companyRef: string;
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

// ==================== Interfaces ====================

export interface ITransactionDetails {
  _id: string;
  userName: string;
  productName: string;
  amount: number;
  orderPlacedAt: Date;
  paymentStatus: PAYMENT_STATUS;
  refunded: boolean;
  createdAt: string;
}
