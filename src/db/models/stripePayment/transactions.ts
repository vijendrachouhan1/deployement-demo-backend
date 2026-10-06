import mongoose from "mongoose";
import { PAYMENT_STATUS } from "@/providers/payment/stripe/stripe.types";

const ObjectId = mongoose.Schema.Types.ObjectId;

export interface ITransactions {
  _id: mongoose.Types.ObjectId;
  userRef: mongoose.Types.ObjectId;
  stripeCustomerId: string;
  stripePaymentIntentId?: string;
  stripeChargeId?: string;
  stripeCheckoutSessionId: string;
  productRef?: mongoose.Types.ObjectId;
  companyRef: mongoose.Types.ObjectId;
  amountPaid?: number;
  paymentStatus: PAYMENT_STATUS;
  orderPlacedAt?: Date;
  refunded?: boolean;
  refundRequestedAt?: Date;
  refundClaimId?: string;
  refundClaimExpiresAt?: Date;
}

export interface ITransactionsDocument extends ITransactions {
  createdAt: Date;
  updatedAt: Date;
}

// ---------------------------------------------
// This schema is part of `stripe payment` flow
// ---------------------------------------------
export const TransactionSchema = new mongoose.Schema<ITransactionsDocument>(
  {
    userRef: {
      type: ObjectId,
      ref: "User",
      required: true,
    },
    // Unique identifier for the customer on Stripe.
    // This ID represents the customer who made the purchase and can be used
    // for future transactions, refunds, or to access customer payment information.
    stripeCustomerId: {
      type: String,
      required: true,
    },
    // Unique identifier for a specific payment intent on Stripe.
    // A PaymentIntent represents intent to collect payment from a customer.
    // It helps in tracking the lifecycle of the payment process.
    stripePaymentIntentId: {
      type: String,
    },
    // Unique identifier for a successful charge on Stripe.
    // A Charge represents a successful payment and is created when a PaymentIntent succeeds.
    // This field may be empty if the payment hasn't been processed yet.
    stripeChargeId: {
      type: String,
    },
    // Unique identifier for a specific checkout session on Stripe.
    // A Checkout Session represents the entire checkout process.
    // It includes information about the items being purchased, the customer, and the payment details.
    stripeCheckoutSessionId: {
      type: String,
      required: true,
    },
    productRef: {
      type: ObjectId,
      ref: "Products",
      required: false,
    },
    companyRef: {
      type: ObjectId,
      ref: "Company",
      required: true,
    },
    // If the discount is applied, then the amountPaid contains the discounted amount.
    // This basically represents the final amount paid by the customer.
    amountPaid: {
      type: Number,
    },
    // Tracks the status of the payment made by customer.
    paymentStatus: {
      type: String,
      enum: Object.values(PAYMENT_STATUS),
      default: PAYMENT_STATUS.PENDING,
    },
    orderPlacedAt: {
      type: Date,
    },
    refunded: {
      type: Boolean,
      default: false,
    },
    // Retries retain eligibility from the original refund request.
    refundRequestedAt: Date,
    refundClaimId: String,
    refundClaimExpiresAt: Date,
  },
  { timestamps: true },
);

export const StripePaymentTransactions = mongoose.model<ITransactionsDocument>(
  "StripePaymentTransactions",
  TransactionSchema,
);
