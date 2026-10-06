import { Router } from "express";
import { GetStreamWebhook } from "@/webhooks/getstream/getstream.webhook";

export class GetStreamWebhookRouter {
  router: Router;
  constructor() {
    this.router = Router();

    this.initializeRoutes();
  }

  private initializeRoutes() {
    const getStreamWebhook = new GetStreamWebhook();

    this.router.post("/", getStreamWebhook.handleWebhook);
  }
}
