import mongoose from "mongoose";

const ObjectId = mongoose.Schema.Types.ObjectId;

export interface ICustomer {
  _id: mongoose.Types.ObjectId;
  userRef: mongoose.Types.ObjectId;
  stripeCustomerId: string;
  companyRef: mongoose.Types.ObjectId;
}

export interface ICustomerDocument extends ICustomer {
  createdAt: Date;
  updatedAt: Date;
}

// ---------------------------------------------
// This schema is part of `stripe payment` flow
// ---------------------------------------------
export const CustomerSchema = new mongoose.Schema<ICustomerDocument>(
  {
    userRef: {
      type: ObjectId,
      ref: "User",
      required: true,
      unique: true,
    },
    // Unique identifier for the customer on Stripe.
    // This ID represents the customer who made the purchase and can be used
    // for future transactions, refunds, or to access customer payment information.
    stripeCustomerId: {
      type: String,
      required: true,
    },
    companyRef: {
      type: ObjectId,
      required: true,
      ref: "Company",
    },
  },
  { timestamps: true },
);

export const StripePaymentCustomer = mongoose.model<ICustomerDocument>(
  "StripePaymentCustomer",
  CustomerSchema,
);
