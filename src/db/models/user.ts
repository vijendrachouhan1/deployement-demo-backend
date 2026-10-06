import { STATUS, USER_TYPE } from "@/enums";
import { SOCIAL_OAUTH_METHOD } from "@/enums/auth.enum";
import { generateReferralCode } from "@/helpers/common";
import { auditPlugin } from "@/db/plugins/audit/audit.plugin";
import mongoose from "mongoose";

const ObjectId = mongoose.Schema.Types.ObjectId;

export interface IUser {
  _id: mongoose.Types.ObjectId;
  email: string;
  password: string;
  name: {
    first: string;
    last: string;
  };
  get: (path: string) => any;
  set: (path: string, value: any) => any;
  profile: any;
  firstName: string;
  roles: USER_TYPE;
  oauth: SOCIAL_OAUTH_METHOD;
  token: string;
  qrCode: string;
  phone?: string;
  subscribedToNewsletter: boolean;
  hasPassword: boolean;
  twoFaSecret?: string;
  isTwoFaEnabled: boolean;
  images?: string[];
  profileImage?: string;
  stripeCustomerId?: string;
  defaultCardToken?: string;
  cardTokens: string[];
  referralCode: string;
  referredBy?: mongoose.Types.ObjectId;
  companyRef?: mongoose.Types.ObjectId;
  status: STATUS;
  // tracking the user last activity time
  lastActivity?: number;
  externalUserId?: string;
  // Password rotation policy field
  passwordExpiresAt?: Date;
  forcePasswordChange?: boolean;
  permissions?: string[];
  organizationMembershipId?: string;

  fullName: string;
  isSuperAdmin: boolean;
  isAdmin: boolean;

  // MFA fields
  mfa: {
    enrolled: boolean; //  Mfa is successfully set up or not
    enabled: boolean; // Stores whether user has chosen and enabled mfa or not for their account
    factorIds?: string[]; // stores all mfa factor ids which are initiated by the user
    factorId?: string; // stores the active mfa factor id
  };
}

export interface IUserDocument extends IUser {
  createdAt: Date;
  updatedAt: Date;
}

const isEmailRequired = function (this: IUserDocument): boolean {
  return !this.phone;
};
const isPhoneRequired = function (this: IUserDocument): boolean {
  return !this.email;
};

const UserSchema = new mongoose.Schema<IUserDocument>(
  {
    email: {
      type: String,
      required: isEmailRequired,
      lowercase: true,
      trim: true,
    },
    name: {
      first: {
        type: String,
        required: function () {
          return !this.phone;
        },
      },
      last: {
        type: String,
        required: function () {
          return !this.phone;
        },
      },
    },
    phone: {
      type: String,
      required: isPhoneRequired,
    },

    subscribedToNewsletter: {
      type: Boolean,
      default: true,
    },
    // Used to store userId provided by auth services like supabase, workos authkit
    externalUserId: {
      type: String,
      unique: true,
      sparse: true,
      required: false,
    },
    organizationMembershipId: {
      type: String,
      unique: true,
      sparse: true,
      required: false,
    },
    // Password rotation policy field
    passwordExpiresAt: {
      type: Date,
      required: false,
    },
    // field to force password change for a user
    forcePasswordChange: {
      type: Boolean,
      default: false,
    },
    hasPassword: {
      type: Boolean,
      default: false,
    },

    oauth: {
      type: String,
      enum: Object.values(SOCIAL_OAUTH_METHOD),
      required: false,
    },
    roles: {
      type: String,
      enum: Object.values(USER_TYPE),
      default: USER_TYPE.ADMIN,
    },
    images: {
      type: [String],
      required: false,
    },
    profileImage: {
      type: String,
      required: false,
    },
    stripeCustomerId: {
      type: String,
    },
    defaultCardToken: {
      type: String,
    },
    cardTokens: [String],
    referralCode: {
      type: String,
      unique: true,
    },
    referredBy: {
      type: ObjectId,
      ref: "User",
      required: false,
    },
    companyRef: {
      type: ObjectId,
      ref: "Company",
      required: false,
    },
    status: {
      type: String,
      enum: Object.values(STATUS),
      default: STATUS.ACTIVE,
    },

    mfa: {
      enrolled: {
        type: Boolean,
        default: false,
      },
      enabled: {
        type: Boolean,
        default: false,
      },
      factorIds: {
        type: [String],
        required: false,
      },

      factorId: {
        type: String,
        required: false,
      },
    },

    // tracking the user last activity time
    lastActivity: {
      type: Number,
    },
  },
  {
    timestamps: true,
    toObject: {
      virtuals: true,
    },
    toJSON: {
      virtuals: true,
    },
  },
);

UserSchema.pre<IUser>("save", function (next: any): void {
  const email = this.get("profile.email");
  if (email) {
    this.profile.email = this.profile.email.toLowerCase();
  }

  const firstName = this.firstName;
  if (firstName) {
    this.set("profile.name.first", firstName.trim());
  }

  const lastName = this.get("profile.name.last");
  if (lastName) {
    this.set("profile.name.last", lastName.trim());
  }

  if (!this.roles || this.roles.length === 0) {
    this.roles = USER_TYPE.USER;
  }

  next();
});

UserSchema.virtual("fullName").get(function (): string {
  return `${this.name.first} ${this.name.last}`;
});

UserSchema.virtual("isSuperAdmin").get(function (): boolean {
  return this.roles.includes(USER_TYPE.SUPER_ADMIN);
});

UserSchema.virtual("isAdmin").get(function (): boolean {
  return this.roles.includes(USER_TYPE.ADMIN);
});

UserSchema.index({
  email: "text",
  "name.first": "text",
  "name.last": "text",
});
// Generate a referral code for a new user

UserSchema.pre<any>("save", async function (next: any): Promise<void> {
  if (!this.referralCode) {
    // Generate a unique referral code
    this.referralCode = await generateReferralCode();
  }
  next();
});

UserSchema.plugin(auditPlugin, {
  model: "user",
  exclude: [
    "password",
    "token",
    "twoFaSecret",
    "qrCode",
    "cardTokens",
    "defaultCardToken",
    "mfa",
    "lastActivity",
  ],
  labelField: "email",
});

export const User = mongoose.model<IUserDocument>("User", UserSchema);
