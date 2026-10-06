import { Router } from "express";
import { StripePaymentWebhook } from "@/webhooks/stripe-payment/stripe-payment.webhook";

export class StripePaymentWebhookRouter {
  router: Router;
  constructor() {
    this.router = Router();

    this.initializeRoutes();
  }

  private initializeRoutes() {
    const stripePaymentWebhook = new StripePaymentWebhook();

    this.router.post("/", stripePaymentWebhook.handleWebhook);
  }
}
