import mongoose from "mongoose";
import { STATUS } from "@/enums";
import { auditPlugin } from "@/db/plugins/audit/audit.plugin";

const ObjectId = mongoose.Schema.Types.ObjectId;

export interface IProducts {
  _id: mongoose.Types.ObjectId;
  title: string;
  productImages?: string[];
  description: string;
  price?: number;
  costPrice?: number;
  retailPrice?: number;
  salePrice?: number;
  userRef?: mongoose.Types.ObjectId;
  companyRef: mongoose.Types.ObjectId;
  status: STATUS;
}

export interface IProductsDocument extends IProducts, mongoose.Document {
  createdAt: Date;
  updatedAt: Date;
}

const ProductSchema = new mongoose.Schema<IProductsDocument>(
  {
    title: {
      type: String,
      required: true,
    },
    productImages: {
      type: [String],
      required: false,
    },
    description: {
      type: String,
      required: true,
    },
    price: {
      type: Number,
      required: false,
    },
    costPrice: {
      type: Number,
      required: false,
    },
    retailPrice: {
      type: Number,
      required: false,
    },
    salePrice: {
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
      required: true,
      ref: "Company",
    },
    status: {
      type: String,
      enum: Object.values(STATUS),
      default: STATUS.ACTIVE,
    },
  },
  { timestamps: true },
);

ProductSchema.index({ name: "text" });

ProductSchema.plugin(auditPlugin, {
  model: "product",
  labelField: "title",
});

export const Products = mongoose.model<IProductsDocument>(
  "Products",
  ProductSchema,
);
