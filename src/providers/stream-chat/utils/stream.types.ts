export interface IUpsertUserParams {
  userId: string;
  userName: string;
  role: string;
}

export interface IUpdateMemberRoleParams {
  channelId: string;
  userId: string;
  role: string;
}

export interface IRemoveUserFromGroupParams {
  channelId: string;
  userId: string;
}

export interface ICreateGroupChatParams {
  members: string[];
  createdBy: string;
  name: string;
  avatar?: string;
}

export interface ICreateDirectChatParams {
  members: string[];
  channelName: string;
  createdBy: string;
}

export interface IAddUserToGroupParams {
  channelId: string;
  userId: string;
  userName: string;
}
