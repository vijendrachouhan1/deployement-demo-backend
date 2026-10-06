import { TObjectId } from "@/types/common.types";
import { chatValidators } from "@/modules/chat/utils/chat.validation";

export interface IGetUsersParams {
  currUser: TObjectId;
  searchValue: string;
  page: number;
  pageSize: number;
}

export interface IGetChatAuthTokenParams {
  userId: string;
  userName: string;
}

export interface IChatMember {
  userId: string;
  userName: string;
}

export interface IFileUploadParams {
  name: string;
  mimeType: string;
}

export interface IFileDeleteParams {
  name: string;
}

export type TChatController = typeof chatValidators;
