import { Router } from "express";
import { Middleware } from "@/middleware/auth";
import { InviteUserController } from "@/modules/invite-user/invite-user.controller";
import { inviteUserValidators } from "@/modules/invite-user/utils/invite-user.validation";
import { authorize } from "@/middleware/authorize";
import { PERMISSIONS } from "@/enums";

const middleware = new Middleware();

export class AdminInviteUserRouter {
  router: Router;

  constructor() {
    this.router = Router();
    this.initializeRoutes();
  }

  private initializeRoutes() {
    const controller = new InviteUserController();

    this.router.post(
      "/users",
      authorize(PERMISSIONS.TEAMS_MANAGE),
      inviteUserValidators.inviteMultipleUsers,
      controller.inviteMultipleUsers,
    );
    this.router.get(
      "/",
      authorize(PERMISSIONS.TEAMS_VIEW),
      inviteUserValidators.getInvitedUsers,
      controller.getInvitedUsers,
    );
    this.router.get(
      "/users/",
      authorize(PERMISSIONS.TEAMS_VIEW),
      inviteUserValidators.getUsersWithAcceptedInvitation,
      controller.getUsersWithAcceptedInvitation,
    );
    this.router.get(
      "/users-count",
      authorize(PERMISSIONS.TEAMS_VIEW),
      inviteUserValidators.getUsersCount,
      controller.getUsersCount,
    );
    this.router.post(
      "/resend-invite",
      authorize(PERMISSIONS.TEAMS_WRITE),
      inviteUserValidators.resendInvites,
      controller.resendInvites,
    );
    this.router.post(
      "/cancel-invite/:id",
      authorize(PERMISSIONS.TEAMS_WRITE),
      inviteUserValidators.cancelInvite,
      controller.cancelInvite,
    );
    this.router.post(
      "/:id",
      authorize(PERMISSIONS.TEAMS_MANAGE),
      inviteUserValidators.softDeleteUsers,
      controller.softdeleteUsers,
    );
  }
}
