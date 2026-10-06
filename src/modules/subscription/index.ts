import { Middleware } from "@/middleware/auth";
import { SubscriptionAdminController } from "@/modules/subscription/subscription-admin.controller";
import { SubscriptionSuperAdminController } from "@/modules/subscription/subscription-super-admin.controller";
import { subscriptionValidators } from "@/modules/subscription/utils/subscription.validation";
import { Router } from "express";
import { authorize } from "@/middleware/authorize";
import { PERMISSIONS } from "@/enums";

const middleware = new Middleware();

export class AdminSubscriptionRouter {
  router: Router;

  constructor() {
    this.router = Router();
    this.router.use(middleware.authMiddleware);

    this.initializeRoutes();
  }

  private initializeRoutes() {
    const adminController = new SubscriptionAdminController();

    this.router.get(
      "/plans",
      authorize(PERMISSIONS.SUBSCRIPTION_VIEW),
      adminController.getAllStripeSubscriptionPlans,
    );
    this.router.get(
      "/",
      authorize(PERMISSIONS.SUBSCRIPTION_VIEW),
      adminController.getUserPlans,
    );

    this.router.post(
      "/customer/create",
      authorize(PERMISSIONS.SUBSCRIPTION_WRITE),
      adminController.createStripeCustomer,
    );
    this.router.post(
      "/",
      authorize(PERMISSIONS.SUBSCRIPTION_WRITE),
      subscriptionValidators.createSubscription,
      adminController.createSubscription,
    );
    this.router.put(
      "/cancel",
      authorize(PERMISSIONS.SUBSCRIPTION_MANAGE),
      subscriptionValidators.cancelSubscription,
      adminController.cancelSubscription,
    );
    this.router.post(
      "/plans",
      authorize(PERMISSIONS.SUBSCRIPTION_WRITE),
      subscriptionValidators.changeSubscription,
      adminController.changeSubscription,
    );
  }
}

export class SuperAdminSubscriptionRouter {
  router: Router;

  constructor() {
    this.router = Router();
    this.router.use(middleware.superAdminMiddleware);

    this.initializeRoutes();
  }

  private initializeRoutes() {
    const superAdminController = new SubscriptionSuperAdminController();

    this.router.get(
      "/",
      subscriptionValidators.getAllSubscribedUsers,
      superAdminController.getAllSubscribedUsers,
    );
  }
}
