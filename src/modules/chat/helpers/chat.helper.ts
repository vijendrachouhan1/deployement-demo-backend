import { User } from "@/db/models/user";
import { STATUS } from "@/enums";
import {
  buildNameSearchMatchStage,
  createFacetPipeline,
} from "@/helpers/query";
import {
  IGetUsersParams,
  IGetChatAuthTokenParams,
  IFileUploadParams,
  IFileDeleteParams,
} from "@/modules/chat/utils/chat.types";
import { streamService } from "@/providers/stream-chat";
import { CHAT_USER_ROLE_TYPES } from "@/modules/chat/utils/chat.enum";
import { fileStorageService } from "@/providers/file-storage";

/**
 * ChatHelper class for handling chat-related database operations
 */
export class ChatHelper {
  /**
   * Get users for chat with pagination and search
   */
  async getUsers(query: IGetUsersParams) {
    const page = query.page;
    const pageSize = query.pageSize;
    const searchValue = query.searchValue;
    const skips = (page - 1) * pageSize;

    const facetPipeline = createFacetPipeline(page, skips, pageSize);
    const matchStage = buildNameSearchMatchStage(searchValue);

    return User.aggregate([
      {
        $match: {
          status: STATUS.ACTIVE,
          _id: { $ne: query.currUser },
          ...(matchStage && matchStage.$match),
        },
      },
      ...(matchStage ? [matchStage] : []),
      {
        $addFields: {
          userType: "$roles",
        },
      },
      {
        $unionWith: {
          coll: "children",
          pipeline: [
            {
              $match: {
                _id: { $ne: query.currUser },
                status: STATUS.ACTIVE,
              },
            },
            ...(matchStage ? [matchStage] : []),
            {
              $addFields: {
                userType: "$type",
              },
            },
          ],
        },
      },
      {
        $sort: {
          "name.first": 1,
        },
      },
      {
        $project: {
          name: 1,
          userType: 1,
          lastActivity: 1,
          status: 1,
        },
      },
      ...facetPipeline,
    ]);
  }

  /**
   * Get chat authentication token for a user
   */
  async getChatAuthToken({ userId, userName }: IGetChatAuthTokenParams) {
    await streamService.upsertUser({
      userId,
      userName,
      role: CHAT_USER_ROLE_TYPES.ADMIN,
    });

    return streamService.generateToken(userId);
  }

  /**
   * Get pre-signed URL for file access
   */
  async getFileUrl(pathName: string) {
    return fileStorageService.getPreSignedUrl?.(pathName, "", {
      operation: "get",
    });
  }

  /**
   * Get pre-signed URL for file upload
   */
  async getUploadUrl(params: IFileUploadParams) {
    return fileStorageService.getPreSignedUrl?.(params.name, params.mimeType, {
      operation: "put",
    });
  }

  /**
   * Delete a file
   */
  async deleteFile(params: IFileDeleteParams) {
    return fileStorageService.delete(params.name);
  }
}

export const chatHelper = new ChatHelper();
