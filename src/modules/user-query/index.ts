import { Router } from "express";
import { Middleware } from "@/middleware/auth";
import { UserQueryController } from "@/modules/user-query/user-query.controller";
import { userQueryValidators } from "@/modules/user-query/utils/user-query.validation";
import { UserQueryAdminController } from "./user-query-admin.controller";
import { authorize } from "@/middleware/authorize";
import { PERMISSIONS } from "@/enums";

const middleware = new Middleware();

export class UserQueryRouter {
  router: Router;

  constructor() {
    this.router = Router();
    this.router.use(middleware.authMiddleware);

    this.initializeRoutes();
  }

  private initializeRoutes() {
    const controller = new UserQueryController();

    this.router.get(
      "/:id",
      authorize(PERMISSIONS.USER_QUERY_VIEW),
      userQueryValidators.getUserQueryById,
      controller.getById,
    );
    this.router.get(
      "/",
      authorize(PERMISSIONS.USER_QUERY_VIEW),
      userQueryValidators.getAllUserQueries,
      controller.getAllUserQueries,
    );
    this.router.post(
      "/",
      authorize(PERMISSIONS.USER_QUERY_WRITE),
      userQueryValidators.createUserQuery,
      controller.create,
    );
  }
}

export class AdminUserQueryRouter {
  router: Router;

  constructor() {
    this.router = Router();
    this.router.use(middleware.authMiddleware);

    this.initializeRoutes();
  }

  private initializeRoutes() {
    const adminController = new UserQueryAdminController();

    this.router.post(
      "/email/:queryId",
      authorize(PERMISSIONS.USER_QUERY_MANAGE),
      userQueryValidators.sendEmail,
      adminController.sendEmail,
    );

    this.router.put(
      "/:id",
      authorize(PERMISSIONS.USER_QUERY_MANAGE),
      userQueryValidators.update,
      adminController.update,
    );

    this.router.delete(
      "/:id",
      authorize(PERMISSIONS.USER_QUERY_MANAGE),
      userQueryValidators.delete,
      adminController.delete,
    );
  }
}
