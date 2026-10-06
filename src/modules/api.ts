import { Router } from "express";
import { AdminRouter } from "@/modules/admin";
import { AuthRouter } from "@/modules/auth";
import { Middleware } from "@/middleware/auth";
import { UserRouter } from "@/modules/users";
import { SuperAdminRouter } from "@/modules/super-admin";
import { ProductsRouter } from "@/modules/products";
import { ReferralRouter } from "@/modules/referrals";
import { NotificationsRouter } from "@/modules/notifications";
import { StripeConnectRouter } from "@/modules/stripe-connect";
import { StripePaymentRouter } from "@/modules/stripe-payment";
import { SystemRouter } from "@/modules/system";
import { ChatRouter } from "@/modules/chat";
import { UserQueryRouter } from "@/modules/user-query";
import { FileUploadRouter } from "@/modules/file-upload";
import { E2eSupportRouter } from "@/modules/e2e-support";
import { isDevEnvironment } from "@/helpers/common";

const middleware = new Middleware();

export const api = Router();
api.use(middleware.jwtDecoder);

api.use("/admin", new AdminRouter().router);
api.use("/super-admin", new SuperAdminRouter().router);
api.use("/system", new SystemRouter().router);
api.use("/auth", new AuthRouter().router);
api.use("/user", new UserRouter().router);
api.use("/aws", new FileUploadRouter().router);
api.use("/products", new ProductsRouter().router);
api.use("/referrals", new ReferralRouter().router);
api.use("/notification", new NotificationsRouter().router);
api.use("/stripe-connect", new StripeConnectRouter().router);
api.use("/stripe-payment", new StripePaymentRouter().router);
api.use("/chat", new ChatRouter().router);
api.use("/help", new UserQueryRouter().router);

if (isDevEnvironment()) {
  api.use("/e2e", new E2eSupportRouter().router);
}
