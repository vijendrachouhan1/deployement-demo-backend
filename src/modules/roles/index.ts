import { Router } from "express";

import { PERMISSIONS } from "@/enums";
import { Middleware } from "@/middleware/auth";
import { authorize } from "@/middleware/authorize";
import { RolesAdminController } from "@/modules/roles/roles.controller";
import { rolesValidators } from "@/modules/roles/utils/roles.validation";

export class AdminRolesRouter {
  router: Router;

  constructor() {
    this.router = Router();

    this.initializeRoutes();
  }

  private initializeRoutes() {
    const controller = new RolesAdminController();

    this.router.get("/", authorize(PERMISSIONS.TEAMS_MANAGE), controller.list);

    this.router.post(
      "/",
      authorize(PERMISSIONS.TEAMS_MANAGE),
      rolesValidators.create,
      controller.create,
    );

    this.router.put(
      "/:slug",
      authorize(PERMISSIONS.TEAMS_MANAGE),
      rolesValidators.update,
      controller.update,
    );

    this.router.delete(
      "/:slug",
      authorize(PERMISSIONS.TEAMS_MANAGE),
      rolesValidators.delete,
      controller.delete,
    );

    this.router.get(
      "/permissions",
      authorize(PERMISSIONS.TEAMS_MANAGE),
      controller.listPermissions,
    );
  }
}
