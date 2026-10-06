import { Router } from "express";
import { SubscriptionWebhook } from "@/webhooks/subscription/subscription.webhook";

export class StripeSubscriptionWebhookRouter {
  router: Router;
  constructor() {
    this.router = Router();

    this.initializeRoutes();
  }

  private initializeRoutes() {
    const subscriptionWebhook = new SubscriptionWebhook();

    this.router.post("/", subscriptionWebhook.handleWebhook);
  }
}
