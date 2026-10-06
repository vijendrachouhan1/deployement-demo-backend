import envConfig from "@/config/env";
import { AppError } from "@/helpers/app-error";
import {
  CHAT_TYPE,
  CHAT_USER_ROLE_TYPES,
} from "@/modules/chat/utils/chat.enum";
import status from "http-status";
import { ChannelSortBase, DefaultGenerics, StreamChat } from "stream-chat";

import {
  IAddUserToGroupParams,
  ICreateDirectChatParams,
  ICreateGroupChatParams,
  IRemoveUserFromGroupParams,
  IUpdateMemberRoleParams,
  IUpsertUserParams,
} from "@/providers/stream-chat/utils/stream.types";

const DEFAULT_USER_NAME = "Default Name";

class StreamService {
  private stream: StreamChat;
  constructor() {
    this.stream = StreamChat.getInstance(
      envConfig.GET_STREAM_MESSAGING_KEY,
      envConfig.GET_STREAM_MESSAGING_SECRET,
    );
  }

  async generateToken(userId: string): Promise<string> {
    return this.stream.createToken(userId);
  }

  async upsertUser({ userId, userName, role }: IUpsertUserParams) {
    return this.stream.upsertUser({
      id: userId,
      name: userName,
      role: role,
    });
  }

  async upsertMultipleUsers(
    users: { id: string; name: string; role: string }[],
  ) {
    return this.stream.upsertUsers(
      users.map((user) => ({
        ...user,
      })),
    );
  }

  async createDirectChat({
    members,
    createdBy,
    channelName,
  }: ICreateDirectChatParams) {
    const sortedMembers = [...members].sort();
    const channelId = `dm_${sortedMembers.join("_")}`;

    const existingChannels = await this.stream.queryChannels({
      type: "messaging",
      id: channelId,
    });

    if (existingChannels.length > 0) {
      return existingChannels[0].id;
    }

    const channel = this.stream.channel("messaging", channelId, {
      members,
      name: channelName,
      created_by_id: createdBy,
      distinct: true,
    });

    await channel.create();
    return channel.id;
  }

  async createGroupChat({ members, createdBy, name }: ICreateGroupChatParams) {
    const channel = this.stream.channel("messaging", `group${Date.now()}`, {
      name: name || "New Group",
      members,
      created_by_id: createdBy,
      distinct: false,
    });
    await channel.create();
    return channel.id;
  }

  async removeUserFromGroup({ channelId, userId }: IRemoveUserFromGroupParams) {
    const channel = this.stream.channel("messaging", channelId);
    await channel.watch();

    const members = channel.state.members;

    const groupCreatorId = channel?.data?.created_by_id;

    if (userId === groupCreatorId) {
      throw new AppError(
        "The group creator cannot be removed from the group.",
        status.FORBIDDEN,
      );
    }

    if (!members[userId]) {
      throw new AppError(
        "User is not a member of this group.",
        status.BAD_REQUEST,
      );
    }

    return channel.removeMembers([userId]);
  }

  async addUserToGroup({ channelId, userId, userName }: IAddUserToGroupParams) {
    const channel = this.stream.channel("messaging", channelId);

    await channel.watch();

    if (channel.data?.distinct) {
      throw new AppError(
        "Cannot add members to a distinct channel. Create a new group chat instead.",
        status.BAD_REQUEST,
      );
    }
    const members = channel.state.members;

    if (members[userId]) {
      throw new AppError(
        "User is already a member of this group.",
        status.BAD_REQUEST,
      );
    }

    await this.upsertMultipleUsers([
      { id: userId, name: userName, role: CHAT_USER_ROLE_TYPES.ADMIN },
    ]);

    return channel.addMembers([
      { user_id: userId, role: CHAT_USER_ROLE_TYPES.USER },
    ]);
  }

  async updateMemberRole({ channelId, userId, role }: IUpdateMemberRoleParams) {
    const channel = this.stream.channel("messaging", channelId);
    await channel.watch();

    const members = channel.state.members;

    if (!members[userId]) {
      throw new AppError(
        "User is not a member of this group.",
        status.BAD_REQUEST,
      );
    }

    return this.stream.upsertUser({
      id: userId,
      role: role,
    });
  }

  async getChannelList(userId: string) {
    const filters = { type: "messaging", members: { $in: [userId] } };
    const sort: ChannelSortBase<DefaultGenerics> = { created_at: -1 };

    const channels = await this.stream.queryChannels(filters, sort, {
      watch: true,
      limit: 1000,
    });

    const data = channels.map((channel) => {
      const otherMember = Object.values(channel.state.members).find(
        (member) => member?.user?.id !== userId,
      );
      const isGroup =
        channel.type === CHAT_TYPE.MESSAGING &&
        channel?.state?.members &&
        Object.keys(channel.state.members).length > 2;

      return {
        channelName: isGroup
          ? channel.data?.name
          : (otherMember?.user?.name ?? DEFAULT_USER_NAME),
        channelId: channel.id,
      };
    });
    return data;
  }

  /**
   * Used only by local E2E test-account cleanup.
   * This is not the application's normal soft-delete flow.
   */
  async deleteUser(userId: string) {
    return this.stream.deleteUser(userId, {
      mark_messages_deleted: true,
      hard_delete: true,
    });
  }
}

export const streamService = new StreamService();
