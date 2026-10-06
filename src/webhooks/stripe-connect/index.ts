import { Router } from "express";
import { StripeConnectWebhook } from "@/webhooks/stripe-connect/stripe-connect.webhook";

export class StripeConnectWebhookRouter {
  router: Router;
  constructor() {
    this.router = Router();

    this.initializeRoutes();
  }

  private initializeRoutes() {
    const stripeConnectWebhook = new StripeConnectWebhook();

    this.router.post("/", stripeConnectWebhook.handleWebhook);
  }
}
