import { STATUS } from "@/enums";
import {
  DEFAULT_PASSWORD_GRACE_DAYS,
  DEFAULT_PASSWORD_VALIDITY_DAYS,
} from "@/modules/auth/utils/auth.constant";
import { auditPlugin } from "@/db/plugins/audit/audit.plugin";
import mongoose from "mongoose";

const ObjectId = mongoose.Schema.Types.ObjectId;

export interface ICompany {
  _id: mongoose.Types.ObjectId;
  name: string;
  userRef?: mongoose.Types.ObjectId;
  website?: string;
  subscriptionRef?: mongoose.Types.ObjectId;
  companyStatus: STATUS;
  supportEmail?: string;
  externalId?: string; // For WorkOS integration

  // Password rotation policy configuration fields
  rotatePassword: boolean;
  passwordValidityDays: number;
  passwordGraceDays: number;
}

export interface ICompanyDocument extends ICompany, mongoose.Document {
  createdAt: Date;
  updatedAt: Date;
}

const CompanySchema = new mongoose.Schema<ICompanyDocument>(
  {
    name: {
      type: String,
      required: true,
      mockName: "name",
    },
    userRef: {
      type: ObjectId,
      ref: "User",
      required: false,
    },
    website: {
      type: String,
      required: false,
      mockName: "url",
    },
    subscriptionRef: {
      type: ObjectId,
      ref: "Subscription",
      required: false,
    },
    // Is company active or inactive
    companyStatus: {
      type: String,
      enum: Object.values(STATUS),
      default: STATUS.ACTIVE,
    },
    supportEmail: {
      type: String,
      required: false,
    },

    // Determines whether password rotation is enabled for the company
    rotatePassword: {
      type: Boolean,
      default: false,
    },
    // Password validity period in days
    passwordValidityDays: {
      type: Number,
      default: DEFAULT_PASSWORD_VALIDITY_DAYS,
      min: 1,
      max: 365,
    },
    // Grace period in days before password expires
    passwordGraceDays: {
      type: Number,
      default: DEFAULT_PASSWORD_GRACE_DAYS,
      min: 0,
      max: 30,
    },
    // External ID for WorkOS integration
    externalId: {
      type: String,
      required: false,
    },
  },
  { timestamps: true },
);

CompanySchema.index({ name: "text", website: "text" });

CompanySchema.plugin(auditPlugin, {
  model: "company",
  labelField: "name",
});

export const Company = mongoose.model<ICompanyDocument>(
  "Company",
  CompanySchema,
);
