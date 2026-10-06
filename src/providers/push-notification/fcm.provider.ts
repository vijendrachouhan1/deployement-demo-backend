import {
  IPushNotificationProvider,
  ISendPushNotificationOptions,
  IPushNotificationResponse,
  IBatchPushNotificationResponse,
} from "@/providers/push-notification/utils/push-notification.types";

export class FCMProvider implements IPushNotificationProvider {
  async sendNotification(
    _options: ISendPushNotificationOptions,
  ): Promise<IPushNotificationResponse> {
    throw new Error("FCMProvider.sendNotification() not implemented");
  }

  async sendBatchNotification(
    _userIds: string[],
    _options: Omit<ISendPushNotificationOptions, "userId">,
  ): Promise<IBatchPushNotificationResponse> {
    throw new Error("FCMProvider.sendBatchNotification() not implemented");
  }
}
