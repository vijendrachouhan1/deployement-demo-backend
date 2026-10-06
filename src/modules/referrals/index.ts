import { Middleware } from "@/middleware/auth";
import { PERMISSIONS } from "@/enums";
import { authorize } from "@/middleware/authorize";
import { ReferralsController } from "@/modules/referrals/referrals.controller";
import { referralValidators } from "@/modules/referrals/utils/referrals.validation";
import { Router } from "express";
import { SuperAdminReferralController } from "@/modules/referrals/referrals-super-admin.controller";

const middleware = new Middleware();

export class ReferralRouter {
  router: Router;

  constructor() {
    this.router = Router();
    this.router.use(middleware.authMiddleware);

    this.initializeRoutes();
  }

  private initializeRoutes() {
    const controller = new ReferralsController();

    this.router.get(
      "/",
      authorize(PERMISSIONS.REFERRALS_VIEW),
      referralValidators.getAllReferrals,
      controller.getAllReferrals,
    );
    this.router.post(
      "/apply",
      authorize(PERMISSIONS.REFERRALS_WRITE),
      referralValidators.applyReferral,
      controller.applyReferral,
    );
    this.router.post(
      "/redeem/:id",
      authorize(PERMISSIONS.REFERRALS_WRITE),
      referralValidators.redeemReferral,
      controller.redeemReferral,
    );
    this.router.post(
      "/invite",
      authorize(PERMISSIONS.REFERRALS_WRITE),
      referralValidators.sendReferralInvite,
      controller.sendReferralInvite,
    );
  }
}

export class SuperAdminReferralRouter {
  router: Router;

  constructor() {
    this.router = Router();
    this.router.use(middleware.superAdminMiddleware);

    this.initializeRoutes();
  }

  private initializeRoutes() {
    const superAdminController = new SuperAdminReferralController();

    this.router.get(
      "/metrics",
      referralValidators.getReferralMetrics,
      superAdminController.getReferralMetrics,
    );
    this.router.get(
      "/activity",
      referralValidators.getActivityChart,
      superAdminController.getActivityChart,
    );
    this.router.get(
      "/rewards",
      referralValidators.getRewardsIssuedChart,
      superAdminController.getRewardsIssuedChart,
    );
  }
}
