import { Middleware } from "@/middleware/auth";
import { NotificationsController } from "@/modules/notifications/notifications.controller";
import { notificationsValidators } from "@/modules/notifications/utils/notifications.validation";
import { Router } from "express";

const middleware = new Middleware();

export class NotificationsRouter {
  router: Router;

  constructor() {
    this.router = Router();
    this.router.use(middleware.authMiddleware);

    this.initializeRoutes();
  }

  private initializeRoutes() {
    const controller = new NotificationsController();

    this.router.get(
      "/",
      notificationsValidators.getNotifications,
      controller.get,
    );
    this.router.post(
      "/",
      notificationsValidators.createNotification,
      controller.create,
    );

    this.router.get("/unread-count", controller.getUnreadCount);
    this.router.post("/mark-all-as-read", controller.markAllAsRead);
    this.router.post(
      "/mark-as-read/:id",
      notificationsValidators.paramId,
      controller.markAsRead,
    );
    this.router.put(
      "/preferences",
      notificationsValidators.updatePreference,
      controller.updatePreference,
    );
    this.router.get("/preferences", controller.getPreference);

    this.router.get("/:id", notificationsValidators.paramId, controller.getOne);
    this.router.put(
      "/:id",
      notificationsValidators.updateNotification,
      controller.update,
    );
    this.router.delete(
      "/:id",
      notificationsValidators.paramId,
      controller.delete,
    );
    this.router.delete("/clear-all", controller.clearAllNotifications);
  }
}
