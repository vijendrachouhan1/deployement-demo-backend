import envConfig from "@/config/env";
import { User } from "@/db/models/user";
import { NOTIFICATION_TYPE } from "@/enums";
import { ErrorResponse, SuccessResponse } from "@/helpers/api-response";
import { chatHelper } from "@/modules/chat/helpers/chat.helper";
import { streamService } from "@/providers/stream-chat";
import {
  CHAT_NOTIFICATION_MESSAGES,
  CHAT_ROUTE_PATH,
  DEFAULT_USER_NAME,
} from "@/modules/chat/utils/chat.constant";
import { CHAT_USER_ROLE_TYPES } from "@/modules/chat/utils/chat.enum";
import { IChatMember, TChatController } from "@/modules/chat/utils/chat.types";
import { notificationsHelper } from "@/modules/notifications/helpers/notifications.helper";
import { ObjectId } from "@/helpers/common";
import { getNotificationChannels } from "@/helpers/notification";
import httpStatus from "http-status";

/**
 * ChatController class for handling chat-related HTTP requests
 */
export class ChatController {
  /**
   * Generate authentication token for chat
   */
  generateToken: TChatController["generateToken"] = async (req, res, next) => {
    try {
      const { user } = req;

      if (!user) {
        return ErrorResponse(res, httpStatus.UNAUTHORIZED, {
          message: CHAT_NOTIFICATION_MESSAGES.UNAUTHORIZED,
        });
      }

      const token = await chatHelper.getChatAuthToken({
        userId: user._id?.toString(),
        userName: `${user.name?.first} ${user.name?.last}`,
      });

      return SuccessResponse(res, 200, {
        message: CHAT_NOTIFICATION_MESSAGES.TOKEN_GENERATED,
        data: token,
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * Get users for chat with pagination and search
   */
  getUsers: TChatController["getUsers"] = async (req, res, next) => {
    if (!req.user)
      return ErrorResponse(res, httpStatus.UNAUTHORIZED, {
        message: CHAT_NOTIFICATION_MESSAGES.UNAUTHORIZED,
      });
    try {
      const { searchQuery, page, limit } = req.query;
      const currUser = req.user._id;

      const data = await chatHelper.getUsers({
        currUser,
        searchValue: String(searchQuery ?? ""),
        page: Number(page),
        pageSize: Number(limit),
      });

      return SuccessResponse(res, httpStatus.OK, {
        message: CHAT_NOTIFICATION_MESSAGES.USER_FETCHED,
        data: data[0],
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * Create a direct chat between two users
   */
  createDirectChat: TChatController["createDirectChat"] = async (
    req,
    res,
    next,
  ) => {
    try {
      const user = req.user;

      if (!user) {
        return ErrorResponse(res, httpStatus.UNAUTHORIZED, {
          message: CHAT_NOTIFICATION_MESSAGES.UNAUTHORIZED,
        });
      }

      const { recipientUserId, recipientUserName } = req.body;

      const creatorUserId = user._id.toString();

      await streamService.upsertMultipleUsers([
        {
          id: creatorUserId,
          name: `${user.name.first} ${user.name.last}`,
          role: CHAT_USER_ROLE_TYPES.ADMIN,
        },
        {
          id: recipientUserId,
          name: recipientUserName ?? DEFAULT_USER_NAME,
          role: CHAT_USER_ROLE_TYPES.ADMIN,
        },
      ]);

      const channelId = await streamService.createDirectChat({
        members: [creatorUserId, recipientUserId],
        channelName: `${user.name.first} ${user.name.last}_and_${recipientUserName}`,
        createdBy: creatorUserId,
      });

      const companyRef = user.companyRef!;
      const message = `You have a new DM with ${user.name.first} ${user.name.last}`;

      const preferences = await notificationsHelper.getPreferences(user._id);

      notificationsHelper.create(
        {
          userRef: ObjectId(recipientUserId),
          companyRef: ObjectId(companyRef),
          message,
          title: CHAT_NOTIFICATION_MESSAGES.NEW_DM,
          redirectUrl: `${envConfig.FRONTEND_HOST}${CHAT_ROUTE_PATH}?channel_id=${channelId}`,
        },
        {
          createNotificationInDb: true,
          channels: getNotificationChannels(
            preferences,
            NOTIFICATION_TYPE.CHAT_MESSAGE,
          ),
        },
      );

      return SuccessResponse(res, httpStatus.OK, {
        message: CHAT_NOTIFICATION_MESSAGES.DM_CREATED,
        data: {
          channelId,
        },
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * Create a group chat
   */
  createGroupChat: TChatController["createGroupChat"] = async (
    req,
    res,
    next,
  ) => {
    const user = req.user;

    if (!user) {
      return ErrorResponse(res, httpStatus.UNAUTHORIZED, {
        message: CHAT_NOTIFICATION_MESSAGES.UNAUTHORIZED,
      });
    }
    try {
      const { members, groupName, avatar } = req.body;

      members.push({
        userId: user._id.toString(),
        userName: `${user.name.first} ${user.name.last}`,
      });

      const userId = user._id.toString();

      const memberIds = members.map((member: IChatMember) => member?.userId);
      const memberNames = members.map(
        (member: IChatMember) => member?.userName,
      );

      await streamService.upsertMultipleUsers(
        memberIds.map((id: string, index: number) => ({
          id,
          name: memberNames[index],
          role: CHAT_USER_ROLE_TYPES.ADMIN,
        })),
      );
      const channelId = await streamService.createGroupChat({
        members: [...memberIds],
        createdBy: userId,
        name: groupName,
        ...(avatar && { avatar }),
      });

      return SuccessResponse(res, httpStatus.OK, {
        message: CHAT_NOTIFICATION_MESSAGES.GROUP_CREATED,
        data: { channelId },
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * Add a member to a group chat
   */
  addMemberInGroup: TChatController["addMemberInGroup"] = async (
    req,
    res,
    next,
  ) => {
    try {
      const { channelId, userId, userName } = req.body;

      await streamService.addUserToGroup({ channelId, userId, userName });

      return SuccessResponse(res, httpStatus.OK, {
        message: CHAT_NOTIFICATION_MESSAGES.MEMBER_ADDED,
        data: null,
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * Remove a member from a group chat
   */
  removeMemberFromGroup: TChatController["removeMemberFromGroup"] = async (
    req,
    res,
    next,
  ) => {
    try {
      const { channelId, userId } = req.body;

      await streamService.removeUserFromGroup({ channelId, userId });
      return SuccessResponse(res, httpStatus.OK, {
        message: CHAT_NOTIFICATION_MESSAGES.MEMBER_REMOVED,
        data: null,
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * Update the role of a group member
   */
  updateRoleOfGroupMember: TChatController["updateRoleOfGroupMember"] = async (
    req,
    res,
    next,
  ) => {
    try {
      const { channelId, userId, role } = req.body;

      await streamService.updateMemberRole({ channelId, userId, role });

      return SuccessResponse(res, httpStatus.OK, {
        message: CHAT_NOTIFICATION_MESSAGES.ROLE_CHANGED,
        data: null,
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * Get list of channels for a user
   */
  getChannelList: TChatController["getChannelList"] = async (
    req,
    res,
    next,
  ) => {
    const user = req.user;
    if (!user)
      return ErrorResponse(res, httpStatus.UNAUTHORIZED, {
        message: CHAT_NOTIFICATION_MESSAGES.UNAUTHORIZED,
      });

    try {
      const userId = user._id.toString();

      const channels = await streamService.getChannelList(userId);

      return SuccessResponse(res, httpStatus.OK, {
        message: CHAT_NOTIFICATION_MESSAGES.CHANNELS_FETCHED,
        data: channels,
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * Send notification to chat members
   */
  sendNotification: TChatController["sendNotification"] = async (
    req,
    res,
    next,
  ) => {
    try {
      const { channelId, message, memberIds, isGroup, channelName } = req.body;

      const userId = req.user!._id.toString();

      const receivers = memberIds.filter(
        (memberId: string) => memberId !== userId,
      );
      const users = await User.find({
        _id: {
          $in: receivers,
        },
      })
        .select("_id roles")
        .lean();

      const notificationPreferences =
        await notificationsHelper.getMultiplePreferences(
          users.map((user) => user._id),
        );

      users.forEach(async (user) => {
        const preference = notificationPreferences.find(
          (p) => p.userRef.toString() === user._id.toString(),
        );

        notificationsHelper.create(
          {
            userRef: user._id,
            title: `New message ${isGroup ? "in" : "from"} ${channelName}`,
            message,
            redirectUrl: `${envConfig.FRONTEND_HOST}${CHAT_ROUTE_PATH}?channel_id=${channelId}`,
          },
          {
            createNotificationInDb: false,
            channels: getNotificationChannels(
              preference,
              NOTIFICATION_TYPE.CHAT_MESSAGE,
            ),
          },
        );
      });

      return SuccessResponse(res, httpStatus.OK, {
        message: CHAT_NOTIFICATION_MESSAGES.NOTIFICATION_SENT,
        data: null,
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * Upload a file to chat
   */
  uploadFile: TChatController["uploadFile"] = async (req, res, next) => {
    const { user } = req;

    if (!user) {
      return ErrorResponse(res, httpStatus.UNAUTHORIZED, {
        message: CHAT_NOTIFICATION_MESSAGES.UNAUTHORIZED,
      });
    }

    try {
      const { name, mimetype } = req.query;

      const fileName = `${user._id}-${Date.now()}-${name}`;

      const data = await chatHelper.getUploadUrl({
        name: fileName,
        mimeType: mimetype,
      });
      return SuccessResponse(res, httpStatus.OK, {
        message: CHAT_NOTIFICATION_MESSAGES.FILE_UPLOADED,
        data: data.url,
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * Delete a file from chat
   */
  deleteFile: TChatController["deleteFile"] = async (req, res, next) => {
    try {
      const { url } = req.query;
      const fileName = url.split("/").slice(1).join("/");

      await chatHelper.deleteFile({ name: fileName });
      return SuccessResponse(res, httpStatus.OK, {
        message: CHAT_NOTIFICATION_MESSAGES.FILE_DELETED,
        data: null,
      });
    } catch (error) {
      next(error);
    }
  };
}
