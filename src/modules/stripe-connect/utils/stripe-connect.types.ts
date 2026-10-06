import * as stripeConnectValidation from "@/modules/stripe-connect/utils/stripe-connect.validation";
import { TObjectId } from "@/types/common.types";
import { PAYMENT_STATUS } from "@/providers/payment/stripe/stripe.types";
import { TRANSFER_STATUS } from "@/modules/stripe-connect/utils/stripe-connect.enum";

export type TStripeConnectController =
  typeof stripeConnectValidation.stripeConnectValidators;

// ==================== Helper Types ====================

export type TFindAllProductsParams = {
  companyRef: TObjectId;
  filters?: object;
  sorting?: Record<string, 1 | -1>;
  page?: number;
  pageSize?: number;
};

export type TCreateCustomer = {
  userRef: TObjectId;
  companyRef: TObjectId;
  stripeCustomerId: string;
};

export type TUpdateCustomer = {
  userRef: TObjectId;
  update: {
    stripeCustomerId: string;
  };
};

export type TUpdateTransaction = {
  id: TObjectId;
  update: {
    isRefundable?: boolean;
    paymentStatus?: PAYMENT_STATUS;
    refunded?: boolean;
    transferStatus?: TRANSFER_STATUS;
  };
};

export type TCreateTransaction = {
  stripeAccountId: string;
  stripeCustomerId: string;
  stripePaymentIntentId: string;
  productRef: TObjectId;
  companyRef: TObjectId;
  amountPaid: number;
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
  stripeAccountId: string;
};

export type TCreateVendor = {
  userRef: TObjectId;
  companyRef: TObjectId;
  stripeAccountId: string;
};

export type TGetAllTransactions = {
  stripeAccountId: string;
  page?: number;
  pageSize?: number;
};

export type TGetTransactionDetails = {
  filters?: object;
  sorting?: Record<string, 1 | -1>;
  skips?: number;
  page?: number;
  pageSize?: number;
  searchFilter?: object;
  stripeAccountId: string;
  companyRef: string;
};

// ==================== Interfaces ====================

export interface ITransactionDetails {
  _id: TObjectId;
  paymentStatus: string;
  refunded: boolean;
  createdAt: Date;
  buyerName: {
    first: string;
    last: string;
  };
  purchaseDate?: Date;
  productName: string;
  price: number;
}

export interface ITransaction {
  _id: string;
  paymentStatus: PAYMENT_STATUS;
  refunded: boolean;
  transferStatus: TRANSFER_STATUS;
  createdAt: string;
  purchaseDate: string | undefined;
  vendor: {
    email: string;
    name: string;
  };
  user: {
    email: string;
    name: string;
  };
  product: {
    name: string;
    vendorId: string;
    price: number;
  };
  amount: number;
}

export type TBalanceTransactions = {
  limit?: number;
  starting_after?: string;
  ending_before?: string;
};

export type TCreateTransfer = {
  amount: number;
  currency: string;
  destination: string;
  description: string;
  source_transaction: string;
};
