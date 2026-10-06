import mongoose from "mongoose";

import { LOGIN_METHOD } from "@/modules/auth/utils/auth.enum";

const ObjectId = mongoose.Schema.Types.ObjectId;

export interface IRefreshToken {
  _id: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  token: string;
  expiresAt: Date;
  loginMethod?: LOGIN_METHOD;
}

export interface IRefreshTokenDocument extends IRefreshToken {
  createdAt: Date;
  updatedAt: Date;
}

const RefreshTokenSchema = new mongoose.Schema<IRefreshTokenDocument>(
  {
    userId: {
      type: ObjectId,
      ref: "User",
      required: true,
    },
    token: {
      type: String,
      required: true,
      unique: true,
    },
    expiresAt: {
      type: Date,
      required: true,
    },

    loginMethod: {
      type: String,
      enum: Object.values(LOGIN_METHOD),
      required: false,
    },
  },
  {
    timestamps: true,
  },
);

export const RefreshToken = mongoose.model<IRefreshTokenDocument>(
  "RefreshToken",
  RefreshTokenSchema,
);
