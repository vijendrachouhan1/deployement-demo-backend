import * as OneSignal from "@onesignal/node-onesignal";
import envConfig from "@/config/env";
import {
  IPushNotificationProvider,
  ISendPushNotificationOptions,
  IPushNotificationResponse,
  IBatchPushNotificationResponse,
} from "@/providers/push-notification/utils/push-notification.types";
import { PromiseStatus } from "@/enums";

export class OneSignalProvider implements IPushNotificationProvider {
  private readonly client: OneSignal.DefaultApi;
  private readonly appId: string;
  private readonly MAX_BATCH_SIZE = 10000;

  constructor() {
    const configuration = OneSignal.createConfiguration({
      restApiKey: envConfig.ONE_SIGNAL_REST_API_KEY,
    });
    this.client = new OneSignal.DefaultApi(configuration);
    this.appId = envConfig.ONE_SIGNAL_APP_ID;
  }

  async sendNotification(
    options: ISendPushNotificationOptions,
  ): Promise<IPushNotificationResponse> {
    try {
      const userIds = Array.isArray(options.userId)
        ? options.userId
        : [options.userId];

      const notification = this.buildNotification(userIds, options);
      const response = await this.client.createNotification(notification);

      return {
        success: true,
        notificationId: response.id,
      };
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to send notification",
      };
    }
  }

  async sendBatchNotification(
    userIds: string[],
    options: Omit<ISendPushNotificationOptions, "userId">,
  ): Promise<IBatchPushNotificationResponse> {
    const chunks = this.chunkArray(userIds, this.MAX_BATCH_SIZE);

    const promises = chunks.map((chunk) => {
      const notification = this.buildNotification(chunk, options);
      return this.client.createNotification(notification);
    });

    const results = await Promise.allSettled(promises);

    let succeeded = 0;
    let failed = 0;

    results.forEach((res) => {
      if (res.status === PromiseStatus.FULFILLED) {
        if (res.value.errors && Object.keys(res.value.errors).length > 0) {
          failed++;
        } else {
          succeeded++;
        }
      } else {
        failed++;
      }
    });

    return {
      success: true,
      totalRecipients: userIds.length,
      batches: chunks.length,
      notificationsSucceeded: succeeded,
      notificationsFailed: failed,
    };
  }

  private buildNotification(
    userIds: string[],
    options: Omit<ISendPushNotificationOptions, "userId">,
  ): OneSignal.Notification {
    const notification = new OneSignal.Notification();
    notification.app_id = this.appId;
    notification.include_aliases = { external_id: userIds };
    notification.target_channel = "push";
    notification.contents = { en: options.message };
    notification.headings = { en: options.title || "Notification" };

    if (options.webUrl) {
      notification.web_url = options.webUrl;
    }

    if (options.sendAfter) {
      notification.send_after = options.sendAfter.toISOString();
    }

    if (options.data) {
      notification.data = options.data;
    }

    if (options.imageUrl) {
      notification.big_picture = options.imageUrl;
      notification.chrome_big_picture = options.imageUrl;
      notification.ios_attachments = { media: options.imageUrl };
    }

    if (options.videoUrl && options.videoThumbnailUrl) {
      notification.big_picture = options.videoThumbnailUrl;
      notification.chrome_big_picture = options.videoThumbnailUrl;
      notification.ios_attachments = { media: options.videoUrl };
    }

    return notification;
  }

  private chunkArray(arr: string[], size: number): string[][] {
    return arr.reduce((acc, _, i) => {
      if (i % size === 0) acc.push(arr.slice(i, i + size));
      return acc;
    }, [] as string[][]);
  }
}
