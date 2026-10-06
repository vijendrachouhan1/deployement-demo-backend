import { Middleware } from "@/middleware/auth";
import { ChatController } from "@/modules/chat/chat.controller";
import { chatValidators } from "@/modules/chat/utils/chat.validation";
import { Router } from "express";
import { authorize } from "@/middleware/authorize";
import { PERMISSIONS } from "@/enums";

const middleware = new Middleware();

export class ChatRouter {
  router: Router;

  constructor() {
    this.router = Router();
    this.router.use(middleware.authMiddleware);

    this.initializeRoutes();
  }

  private initializeRoutes() {
    const controller = new ChatController();

    this.router.get(
      "/users",
      authorize(PERMISSIONS.CHAT_VIEW),
      chatValidators.getUsers,
      controller.getUsers,
    );
    this.router.get(
      "/channels",
      authorize(PERMISSIONS.CHAT_VIEW),
      chatValidators.getChannelList,
      controller.getChannelList,
    );

    this.router.post(
      "/auth",
      authorize(PERMISSIONS.CHAT_VIEW),
      chatValidators.generateToken,
      controller.generateToken,
    );
    this.router.post(
      "/direct",
      authorize(PERMISSIONS.CHAT_VIEW),
      chatValidators.createDirectChat,
      controller.createDirectChat,
    );
    this.router.post(
      "/group",
      authorize(PERMISSIONS.CHAT_VIEW),
      chatValidators.createGroupChat,
      controller.createGroupChat,
    );
    this.router.post(
      "/group/add-member",
      authorize(PERMISSIONS.CHAT_VIEW),
      chatValidators.addMemberInGroup,
      controller.addMemberInGroup,
    );
    this.router.post(
      "/group/remove-member",
      authorize(PERMISSIONS.CHAT_VIEW),
      chatValidators.removeMemberFromGroup,
      controller.removeMemberFromGroup,
    );
    this.router.post(
      "/upload",
      authorize(PERMISSIONS.CHAT_VIEW),
      chatValidators.uploadFile,
      controller.uploadFile,
    );
    this.router.post(
      "/notify",
      authorize(PERMISSIONS.CHAT_VIEW),
      chatValidators.sendNotification,
      controller.sendNotification,
    );

    this.router.put(
      "/group/change-role",
      authorize(PERMISSIONS.CHAT_VIEW),
      chatValidators.updateRoleOfGroupMember,
      controller.updateRoleOfGroupMember,
    );

    this.router.delete(
      "/file",
      authorize(PERMISSIONS.CHAT_VIEW),
      chatValidators.deleteFile,
      controller.deleteFile,
    );
  }
}
