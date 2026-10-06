import { Notification } from "@/db/models/notifications";
import { socketService } from "@/providers/socket";
import { ONE_SIGNAL_NOTIFICATION_EVENT } from "@/enums";
import { Request, Response } from "express";

export class OnesignalWebhook {
  async pushNotification(req: Request, res: Response) {
    const { event, additionalData } = req.body;

    try {
      if (
        additionalData?.notificationId &&
        (event === ONE_SIGNAL_NOTIFICATION_EVENT.CLICKED ||
          event === ONE_SIGNAL_NOTIFICATION_EVENT.DISMISSED)
      ) {
        await Notification.updateOne(
          { _id: additionalData.notificationId },
          { $set: { isOpened: true } },
        );
      }
      socketService.emit("update-notifications-count");
      res.status(200).json({});
    } catch (error) {
      console.error("Error parsing JSON:", error);
      res.status(500).json({ error: "Error parsing JSON" });
    }
  }
}
