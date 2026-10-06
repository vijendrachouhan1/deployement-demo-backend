import mongoose from "mongoose";

const ObjectId = mongoose.Schema.Types.ObjectId;

export interface ICustomer {
  _id: mongoose.Types.ObjectId;
  userRef: mongoose.Types.ObjectId;
  companyRef: mongoose.Types.ObjectId;
  stripeCustomerId: string;
}

export interface ICusomerDocument extends ICustomer, mongoose.Document {
  createdAt: Date;
  updatedAt: Date;
}

// ---------------------------------------------
// This schema is part of `stripe connect` flow
// ---------------------------------------------
export const CustomerSchema = new mongoose.Schema<ICusomerDocument>(
  {
    userRef: {
      type: ObjectId,
      ref: "User",
      required: true,
      unique: true,
    },
    companyRef: {
      type: ObjectId,
      required: true,
      ref: "Company",
    },
    /** 
     Unique identifier for the customer on Stripe.
     This ID represents the customer who made the purchase and can be used or future transactions, refunds, or to access customer payment information.
    */
    stripeCustomerId: {
      type: String,
      required: true,
    },
  },
  { timestamps: true },
);

export const StripeConnectCustomer = mongoose.model<ICusomerDocument>(
  "StripeConnectCustomer",
  CustomerSchema,
);
