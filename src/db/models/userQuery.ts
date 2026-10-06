import {
  USER_QUERY_STATUS,
  USER_QUERY_SUBJECT,
} from "@/modules/user-query/utils/user-query.enum";
import mongoose from "mongoose";

const ObjectId = mongoose.Schema.Types.ObjectId;

export interface IUserQuery {
  _id: mongoose.Types.ObjectId;
  name: {
    first: string;
    last: string;
  };
  email: string;
  subject: USER_QUERY_SUBJECT;
  message: string;
  userRef: mongoose.Types.ObjectId;
  companyRef?: mongoose.Types.ObjectId;
  status: USER_QUERY_STATUS;
}

export interface IUserQueryDocument extends IUserQuery {
  createdAt: Date;
  updatedAt: Date;
}

const UserQuerySchema = new mongoose.Schema<IUserQueryDocument>(
  {
    name: {
      first: {
        type: String,
        required: true,
      },
      last: {
        type: String,
        required: true,
      },
    },
    email: {
      type: String,
      required: true,
    },
    subject: {
      type: String,
      enum: Object.values(USER_QUERY_SUBJECT),
      required: true,
    },

    message: {
      type: String,
      required: true,
    },
    userRef: {
      type: ObjectId,
      ref: "User",
      required: true,
    },
    companyRef: {
      type: ObjectId,
      ref: "Company",
      required: false,
    },
    status: {
      type: String,
      enum: Object.values(USER_QUERY_STATUS),
      default: USER_QUERY_STATUS.PENDING,
      required: true,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

UserQuerySchema.index({ "name.first": 1 });
UserQuerySchema.index({ "name.last": 1 });
UserQuerySchema.index({ email: 1 });

UserQuerySchema.index({ userRef: 1, createdAt: -1 });
UserQuerySchema.index({ companyRef: 1, createdAt: -1 });
UserQuerySchema.index({ status: 1, createdAt: -1 });
UserQuerySchema.index({ subject: 1, createdAt: -1 });
UserQuerySchema.index({ createdAt: -1 });

UserQuerySchema.virtual("userName").get(function (): string {
  return `${this.name.first} ${this.name.last}`;
});

UserQuerySchema.virtual("company", {
  ref: "Company",
  localField: "companyRef",
  foreignField: "_id",
  justOne: true,
});

UserQuerySchema.virtual("user", {
  ref: "User",
  localField: "userRef",
  foreignField: "_id",
  justOne: true,
});

export const UserQuery = mongoose.model<IUserQueryDocument>(
  "UserQuery",
  UserQuerySchema,
);
