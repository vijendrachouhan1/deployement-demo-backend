import { OneSignalProvider } from "@/providers/push-notification/onesignal.provider";
import { FCMProvider } from "@/providers/push-notification/fcm.provider";
import {
  IPushNotificationProvider,
  ISendPushNotificationOptions,
} from "@/providers/push-notification/utils/push-notification.types";
import { PUSH_NOTIFICATION_PROVIDER } from "@/enums/push-notification.enum";

/**
 * PushNotificationService - Business logic layer for push notification operations
 *
 * This service acts as a facade over the push notification provider layer,
 * allowing easy switching between different providers (OneSignal, FCM)
 * without changing the business logic.
 *
 */
export class PushNotificationService {
  private provider: IPushNotificationProvider;

  constructor() {
    this.provider = createPushNotificationProvider(
      PUSH_NOTIFICATION_PROVIDER.ONESIGNAL,
    );
  }

  /**
   * Send a push notification to one or more users
   */
  async sendNotification(options: ISendPushNotificationOptions) {
    return this.provider.sendNotification(options);
  }

  /**
   * Send a push notification to multiple users in batches
   * Useful for sending notifications to large groups of users
   */
  async sendBatchNotification(
    userIds: string[],
    options: Omit<ISendPushNotificationOptions, "userId">,
  ) {
    return this.provider.sendBatchNotification(userIds, options);
  }
}

function createPushNotificationProvider(
  provider: PUSH_NOTIFICATION_PROVIDER,
): IPushNotificationProvider {
  switch (provider) {
    case PUSH_NOTIFICATION_PROVIDER.FCM:
      return new FCMProvider();
    case PUSH_NOTIFICATION_PROVIDER.ONESIGNAL:
    default:
      return new OneSignalProvider();
  }
}

export const pushNotificationService = new PushNotificationService();
