import { Router } from "express";
import { AuthkitWebhook } from "@/webhooks/authkit/authkit.webhook";

export class AuthkitWebhookRouter {
  router: Router;

  constructor() {
    this.router = Router();
    this.initializeRoutes();
  }

  private initializeRoutes() {
    const authkitWebhook = new AuthkitWebhook();
    this.router.post("/", authkitWebhook.handleWebhook);
  }
}
