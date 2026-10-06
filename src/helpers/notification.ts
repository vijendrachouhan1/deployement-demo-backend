import { NOTIFICATION_CHANNEL, NOTIFICATION_TYPE } from "@/enums";
import {
  INotificationChannels,
  IUserNotificationPreference,
} from "@/modules/notifications/utils/notifications.types";

export const getNotificationChannels = (
  notificationPreferences: IUserNotificationPreference | null | undefined,
  type: NOTIFICATION_TYPE,
): INotificationChannels => {
  const defaultChannels = {
    [NOTIFICATION_CHANNEL.EMAIL]: true,
    [NOTIFICATION_CHANNEL.PUSH]: true,
    [NOTIFICATION_CHANNEL.IN_APP]: true,
  };

  if (!notificationPreferences) {
    return defaultChannels;
  }

  const { preferences } = notificationPreferences;

  const channels = preferences[type];

  return {
    [NOTIFICATION_CHANNEL.EMAIL]:
      channels?.[NOTIFICATION_CHANNEL.EMAIL] ?? true,
    [NOTIFICATION_CHANNEL.PUSH]: channels?.[NOTIFICATION_CHANNEL.PUSH] ?? true,
    [NOTIFICATION_CHANNEL.IN_APP]:
      channels?.[NOTIFICATION_CHANNEL.IN_APP] ?? true,
  };
};

export const generateDefaultNotificationPreferences = (): Record<
  NOTIFICATION_TYPE,
  INotificationChannels
> => {
  const channels = {
    [NOTIFICATION_CHANNEL.PUSH]: true,
    [NOTIFICATION_CHANNEL.EMAIL]: false,
    [NOTIFICATION_CHANNEL.IN_APP]: false,
  };

  const defaults = Object.values(NOTIFICATION_TYPE).reduce(
    (acc, type) => {
      acc[type] = { ...channels };
      return acc;
    },
    {} as Record<NOTIFICATION_TYPE, INotificationChannels>,
  );

  return defaults;
};
