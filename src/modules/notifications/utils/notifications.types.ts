import { notificationsValidators } from "@/modules/notifications/utils/notifications.validation";
import { NOTIFICATION_CHANNEL, NOTIFICATION_TYPE } from "@/enums";
import { TObjectId } from "@/types";

export type TNotification = {
  userId?: TObjectId;
  message?: string;
  isOpened?: boolean;
  companyRef?: TObjectId;
};

export interface ICreateNotificationOptions {
  enabled?: boolean;
  channels?: INotificationChannels;
  createNotificationInDb: boolean;
}

export interface INotificationChannels {
  [NOTIFICATION_CHANNEL.EMAIL]: boolean;
  [NOTIFICATION_CHANNEL.PUSH]: boolean;
  [NOTIFICATION_CHANNEL.IN_APP]: boolean;
}

export interface IUserNotificationPreference {
  userRef: TObjectId;
  preferences: Record<NOTIFICATION_TYPE, INotificationChannels>;
  createdAt?: Date;
  updatedAt?: Date;
}

export type TNotificationsController = typeof notificationsValidators;
