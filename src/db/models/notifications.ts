import mongoose from "mongoose";
const ObjectId = mongoose.Schema.Types.ObjectId;

export interface INotifications {
  _id: mongoose.Types.ObjectId;
  userRef: mongoose.Types.ObjectId;
  message: string;
  title: string;
  isOpened: boolean;
  companyRef?: mongoose.Types.ObjectId;
  redirectUrl?: string;
}

export interface INotificationsDocument
  extends INotifications, mongoose.Document {
  createdAt: Date;
  updatedAt: Date;
}

const NotificationSchema = new mongoose.Schema<INotificationsDocument>(
  {
    userRef: {
      type: ObjectId,
      ref: "User",
      required: true,
    },
    message: {
      type: String,
      required: true,
    },
    isOpened: {
      type: Boolean,
      default: false,
      required: true,
    },
    companyRef: {
      type: ObjectId,
      ref: "Company",
      required: false,
    },

    title: {
      type: String,
      required: true,
    },
    redirectUrl: {
      type: String,
      required: false,
    },
  },
  { timestamps: true },
);

export const Notification = mongoose.model<INotificationsDocument>(
  "Notification",
  NotificationSchema,
);
