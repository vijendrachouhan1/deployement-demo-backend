import mongoose from "mongoose";

const ObjectId = mongoose.Schema.Types.ObjectId;

export interface IProducts {
  _id: mongoose.Types.ObjectId;
  title: string;
  price?: number;
  userRef?: mongoose.Types.ObjectId;
  companyRef?: mongoose.Types.ObjectId;
}

export interface IProductsDocument extends IProducts {
  createdAt: Date;
  updatedAt: Date;
}

// ---------------------------------------------
// This schema is part of `stripe payment` flow
// ---------------------------------------------
export const ProductSchema = new mongoose.Schema<IProductsDocument>(
  {
    title: {
      type: String,
      required: true,
    },
    price: {
      type: Number,
      required: false,
    },
    userRef: {
      type: ObjectId,
      required: false,
      ref: "User",
    },
    companyRef: {
      type: ObjectId,
      required: false,
      ref: "Company",
    },
  },
  { timestamps: true },
);

ProductSchema.index({ title: "text" });

export const StripePaymentProducts = mongoose.model<IProductsDocument>(
  "StripePaymentProducts",
  ProductSchema,
);
