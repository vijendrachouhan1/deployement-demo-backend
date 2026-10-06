import { Router } from "express";
import { OnesignalWebhook } from "@/webhooks/onesignal/onesignal.webhook";

export class OnesignalWebhookRouter {
  router: Router;
  constructor() {
    this.router = Router();

    this.initializeRoutes();
  }

  private initializeRoutes() {
    const onesignalWebhook = new OnesignalWebhook();

    this.router.post("/push", onesignalWebhook.pushNotification);
  }
}
