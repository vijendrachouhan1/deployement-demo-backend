import mongoose from "mongoose";
import { INVITED_USER_STATUS, USER_TYPE } from "@/enums";
import { auditPlugin } from "@/db/plugins/audit/audit.plugin";

const ObjectId = mongoose.Schema.Types.ObjectId;

export interface IPermissions {
  collectionName: string;
  access?: boolean;
  permission?: string;
}

export interface IInvitedUsers {
  _id: mongoose.Types.ObjectId;
  invitedEmail: string;
  companyRef?: mongoose.Types.ObjectId;
  userRef: mongoose.Types.ObjectId;
  status: INVITED_USER_STATUS;
  role: USER_TYPE;
  expiry: number;
  errorMessages: string;
  name: {
    first: string;
    last: string;
  };
  permissions: IPermissions[];
}

export interface IInvitedUsersDocument
  extends IInvitedUsers, mongoose.Document {
  createdAt: Date;
  updatedAt: Date;
}

const InvitedUserSchema = new mongoose.Schema<IInvitedUsersDocument>(
  {
    invitedEmail: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },
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
    companyRef: {
      type: ObjectId,
      ref: "Company",
      required: false,
    },
    userRef: {
      type: ObjectId,
      ref: "User",
      required: true,
    },
    status: {
      type: String,
      enum: Object.values(INVITED_USER_STATUS),
      default: INVITED_USER_STATUS.PENDING,
    },
    role: {
      type: String,
      enum: Object.values(USER_TYPE),
      default: USER_TYPE.USER,
    },
    expiry: {
      type: Number,
      default: Date.now() + 60 * 60 * 168 * 1000, // expire in 7 days
    },
    errorMessages: {
      type: String,
      required: false,
    },
    permissions: [
      {
        collectionName: {
          type: String,
          required: true,
        },
        access: {
          type: Boolean,
          default: false,
        },
        permission: {
          type: String,
        },
      },
    ],
  },
  { timestamps: true },
);

InvitedUserSchema.index({ invitedEmail: 1 });

InvitedUserSchema.plugin(auditPlugin, {
  model: "invitedUser",
  labelField: "invitedEmail",
});

export const InvitedUsers = mongoose.model<IInvitedUsersDocument>(
  "InvitedUsers",
  InvitedUserSchema,
);
