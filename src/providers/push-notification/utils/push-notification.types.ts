export interface ISendPushNotificationOptions {
  userId: string | string[];
  message: string;
  title?: string;
  webUrl?: string;
  sendAfter?: Date;
  data?: Record<string, any>;
  imageUrl?: string;
  videoUrl?: string;
  videoThumbnailUrl?: string;
}

export interface IPushNotificationResponse {
  success: boolean;
  notificationId?: string;
  error?: string;
  errors?: Record<string, any>;
}

export interface IBatchPushNotificationResponse {
  success: boolean;
  totalRecipients: number;
  batches: number;
  notificationsSucceeded: number;
  notificationsFailed: number;
}

export interface IPushNotificationProvider {
  /**
   * Send a push notification to one or more users
   * @param options - Notification options including userId(s), message, title, etc.
   * @returns Promise with notification response
   */
  sendNotification(
    options: ISendPushNotificationOptions,
  ): Promise<IPushNotificationResponse>;

  /**
   * Send a push notification to multiple users in batches
   * @param userIds - Array of user IDs to send notification to
   * @param options - Notification options (excluding userId)
   * @returns Promise with batch notification response
   */
  sendBatchNotification(
    userIds: string[],
    options: Omit<ISendPushNotificationOptions, "userId">,
  ): Promise<IBatchPushNotificationResponse>;
}
