import { Router } from "express";
import { AdminSubscriptionRouter } from "@/modules/subscription";
import { AdminInviteUserRouter } from "@/modules/invite-user";
import { AdminStripeConnectRouter } from "@/modules/stripe-connect";
import { AdminStripePaymentRouter } from "@/modules/stripe-payment";
import { AdminCompanyRouter } from "@/modules/company";
import { CardRouter } from "@/modules/cards";
import { AdminUsersRouter } from "@/modules/users";
import { AdminProductsRouter } from "@/modules/products";
import { AdminUserQueryRouter } from "@/modules/user-query";
import { AdminRolesRouter } from "@/modules/roles";
import { AdminAuditLogsRouter } from "@/modules/audit-logs";

export class AdminRouter {
  router: Router;
  constructor() {
    this.router = Router();
    this.router.use("/user", new AdminUsersRouter().router);
    this.router.use("/products", new AdminProductsRouter().router);
    this.router.use("/invite-users", new AdminInviteUserRouter().router);
    this.router.use("/subscription", new AdminSubscriptionRouter().router);
    this.router.use("/stripe-connect", new AdminStripeConnectRouter().router);
    this.router.use("/stripe-payment", new AdminStripePaymentRouter().router);
    this.router.use("/help", new AdminUserQueryRouter().router);
    this.router.use("/company", new AdminCompanyRouter().router);
    this.router.use("/cards", new CardRouter().router);
    this.router.use("/roles", new AdminRolesRouter().router);
    this.router.use("/audit-logs", new AdminAuditLogsRouter().router);
  }
}
