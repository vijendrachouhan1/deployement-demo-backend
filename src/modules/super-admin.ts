import { Router } from "express";
import { Middleware } from "@/middleware/auth";
import { SuperAdminProductsRouter } from "@/modules/products";
import { SuperAdminCompanyRouter } from "@/modules/company";
import { SuperAdminUsersRouter } from "@/modules/users";
import { SuperAdminStripeConnectRouter } from "@/modules/stripe-connect";
import { SuperAdminSubscriptionRouter } from "@/modules/subscription";
import { SuperAdminReferralRouter } from "@/modules/referrals";
import { AuditLogsRouter } from "@/modules/audit-logs";

const middleware = new Middleware();

export class SuperAdminRouter {
  router: Router;
  constructor() {
    this.router = Router();
    this.router.use(middleware.superAdminMiddleware);
    this.router.use("/products", new SuperAdminProductsRouter().router);
    this.router.use("/subscription", new SuperAdminSubscriptionRouter().router);
    this.router.use("/user", new SuperAdminUsersRouter().router);
    this.router.use("/company", new SuperAdminCompanyRouter().router);
    this.router.use("/stripe", new SuperAdminStripeConnectRouter().router);
    this.router.use("/referrals", new SuperAdminReferralRouter().router);

    this.router.use("/audit-logs", new AuditLogsRouter().router);
  }
}
