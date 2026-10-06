import { pushNotificationService } from "@/providers/push-notification";
import { ATTACHMENT_TYPE } from "@/enums/push-notification.enum";
import { Member, Message } from "@/types/getstream.types";

export async function handleMessage(
  message: Message,
  members: Member[],
  channel_id: string,
) {
  const recipientIds = members
    .map((m: any) => m.user_id)
    .filter((id: string) => id !== message.user.id);

  if (!recipientIds.length) {
    return { success: false, reason: "No valid recipients found" };
  }

  let messageText = `${message.user.name}: ${message.text || ""}`;
  let imageUrl: string | undefined;
  let videoUrl: string | undefined;
  let videoThumbnailUrl: string | undefined;

  if (message.attachments && message.attachments.length > 0) {
    const firstAttachment = message.attachments[0];

    switch (firstAttachment.type) {
      case ATTACHMENT_TYPE.IMAGE:
        messageText = `${message.user.name} sent an image.`;
        imageUrl = firstAttachment.image_url;
        break;

      case ATTACHMENT_TYPE.VIDEO:
        messageText = `${message.user.name} sent a video.`;
        videoUrl = firstAttachment.asset_url;
        videoThumbnailUrl = firstAttachment.thumb_url;
        break;

      default:
        messageText = `${message.user.name} sent an attachment.`;
        break;
    }
  }

  return pushNotificationService.sendBatchNotification(recipientIds, {
    message: messageText,
    title: "New Message",
    data: {
      streamMessageId: message.id,
      channelId: channel_id,
    },
    imageUrl,
    videoUrl,
    videoThumbnailUrl,
  });
}
