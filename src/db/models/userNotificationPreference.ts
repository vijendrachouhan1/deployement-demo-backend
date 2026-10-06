import mongoose from "mongoose";
import type { IUserNotificationPreference } from "@/modules/notifications/utils/notifications.types";

const ObjectId = mongoose.Schema.Types.ObjectId;

const ChannelPreferenceSchema = new mongoose.Schema(
  {
    email: { type: Boolean, default: true },
    push: { type: Boolean, default: true },
    inApp: { type: Boolean, default: true },
  },
  { _id: false },
);

const UserNotificationPreferenceSchema =
  new mongoose.Schema<IUserNotificationPreference>(
    {
      userRef: {
        type: ObjectId,
        ref: "User",
        required: true,
        index: true,
      },
      preferences: {
        type: Map,
        of: ChannelPreferenceSchema,
        default: {},
      },
    },
    { timestamps: true },
  );

export const UserNotificationPreference =
  mongoose.model<IUserNotificationPreference>(
    "UserNotificationPreference",
    UserNotificationPreferenceSchema,
  );
