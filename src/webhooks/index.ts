import { json, raw, Router } from "express";
import { StripeSubscriptionWebhookRouter } from "@/webhooks/subscription";
import { GetStreamWebhookRouter } from "@/webhooks/getstream";
import { StripePaymentWebhookRouter } from "@/webhooks/stripe-payment";
import { StripeConnectWebhookRouter } from "@/webhooks/stripe-connect";
import { OnesignalWebhookRouter } from "@/webhooks/onesignal";
import { AuthkitWebhookRouter } from "@/webhooks/authkit";

export class WebhookRouter {
  router: Router;

  constructor() {
    this.router = Router();

    this.initializeRoutes();
  }

  private initializeRoutes() {
    /**
     * Raw webhook routes for webhooks that need to be processed as raw JSON (Stripe)
     */
    this.router.use(
      "/subscription",
      raw({ type: "application/json" }),
      new StripeSubscriptionWebhookRouter().router,
    );

    this.router.use(
      "/stripe-payment",
      raw({ type: "application/json" }),
      new StripePaymentWebhookRouter().router,
    );

    this.router.use(
      "/stripe-connect",
      raw({ type: "application/json" }),
      new StripeConnectWebhookRouter().router,
    );

    /**
     * Parsed webhook routes for webhooks that need to be processed as parsed JSON
     */
    this.router.use("/getstream", json(), new GetStreamWebhookRouter().router);

    this.router.use("/onesignal", json(), new OnesignalWebhookRouter().router);

    this.router.use("/authkit", json(), new AuthkitWebhookRouter().router);
  }
}
