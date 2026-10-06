import { Middleware } from "@/middleware/auth";
import { UserAdminController } from "@/modules/users/admin.controller";
import { UserController } from "@/modules/users/users.controller";
import { userValidators } from "@/modules/users/utils/users.validation";
import { Router } from "express";
import { SuperAdminUsersController } from "./super-admin.controller";
import { authorize } from "@/middleware/authorize";
import { PERMISSIONS } from "@/enums";

const middleware = new Middleware();

export class UserRouter {
  router: Router;

  constructor() {
    this.router = Router();
    this.router.use(middleware.authMiddleware);

    this.initializeRoutes();
  }

  private initializeRoutes() {
    const controller = new UserController();

    this.router.get("/me", userValidators.me, controller.me);

    this.router.put(
      "/profile",
      userValidators.updateProfile,
      controller.updateProfile,
    );

    this.router.post(
      "/change-password",
      userValidators.changePassword,
      controller.changePassword,
    );
  }
}

export class AdminUsersRouter {
  router: Router;

  constructor() {
    this.router = Router();

    this.initializeRoutes();
  }

  private initializeRoutes() {
    const controller = new UserAdminController();

    this.router.get(
      "/",
      authorize(PERMISSIONS.USERS_VIEW),
      userValidators.getUsers,
      controller.get,
    );
    this.router.get(
      "/dashboard-metrics",
      authorize(PERMISSIONS.USERS_VIEW),
      controller.getDashboardMetrics,
    );
    this.router.get(
      "/user-analytics",
      authorize(PERMISSIONS.USERS_VIEW),
      userValidators.userAnalytics,
      controller.getUserAnalytics,
    );
    this.router.get(
      "/:id",
      authorize(PERMISSIONS.USERS_VIEW, PERMISSIONS.TEAMS_VIEW),
      userValidators.getOne,
      controller.getOne,
    );
    this.router.put(
      "/status/:id",
      authorize(PERMISSIONS.USERS_WRITE),
      userValidators.updateStatus,
      controller.updateStatus,
    );
    this.router.put(
      "/user-role/:id",
      authorize(PERMISSIONS.USERS_WRITE),
      userValidators.changeUserRole,
      controller.changeUserRole,
    );
    this.router.put(
      "/force-password-change/:id",
      authorize(PERMISSIONS.USERS_WRITE),
      userValidators.forcePasswordChange,
      controller.forcePasswordChange,
    );
    this.router.put(
      "/force-password-change/company/:id",
      authorize(PERMISSIONS.USERS_WRITE),
      userValidators.forcePasswordChangeByCompany,
      controller.forcePasswordChangeByCompany,
    );
  }
}

export class SuperAdminUsersRouter {
  router: Router;

  constructor() {
    this.router = Router();
    this.router.use(middleware.superAdminMiddleware);

    this.initializeRoutes();
  }

  private initializeRoutes() {
    const controller = new SuperAdminUsersController();

    this.router.put(
      "/user-profile/:id",
      userValidators.updateUserProfile,
      controller.updateUserProfile,
    );
    this.router.post(
      "/change-password/:id",
      userValidators.changeUserPassword,
      controller.changeUserPassword,
    );
  }
}
