import { validationErrorHandler } from "@/helpers/validation-error";
import z from "zod";
import { validate } from "zod-express-validator";

// ==================== Schemas ====================

const CreateDirectChatBodySchema = z.object({
  recipientUserId: z.string().min(1, "Recipient User ID is required"),
  recipientUserName: z.string().min(1, "Recipient User Name is required"),
});

const CreateGroupChatBodySchema = z.object({
  members: z
    .array(
      z.object({
        userId: z.string().min(1, "User ID is required"),
        userName: z.string().min(1, "User Name is required"),
      }),
    )
    .min(1, "At least one member is required"),
  groupName: z.string().min(1, "Group Name is required"),
  avatar: z.string().optional(),
});

const AddMemberInGroupBodySchema = z.object({
  channelId: z.string().min(1, "Channel ID is required"),
  userId: z.string().min(1, "User ID is required"),
  userName: z.string().min(1, "User Name is required"),
});

const RemoveMemberFromGroupBodySchema = z.object({
  channelId: z.string().min(1, "Channel ID is required"),
  userId: z.string().min(1, "User ID is required"),
});

const UpdateRoleOfGroupMemberBodySchema = z.object({
  channelId: z.string().min(1, "Channel ID is required"),
  userId: z.string().min(1, "User ID is required"),
  role: z.string().min(1, "Role is required"),
});

const SendNotificationBodySchema = z.object({
  channelId: z.string().min(1, "Channel ID is required"),
  message: z.string().min(1, "Message is required"),
  memberIds: z.array(z.string()).min(1, "Member IDs are required"),
  channelName: z.string().min(1, "Channel Name is required"),
  isGroup: z.boolean().optional(),
});

const GetUsersQuerySchema = z.object({
  searchQuery: z.string().optional(),
  page: z.string().optional(),
  limit: z.string().optional(),
});

const UploadFileQuerySchema = z.object({
  name: z.string().min(1, "File name is required"),
  mimetype: z.string().min(1, "Mimetype is required"),
});

const DeleteFileQuerySchema = z.object({
  url: z.string().min(1, "URL is required"),
});

// ==================== Validation Schemas ====================

const CreateDirectChatValidationSchema = {
  body: CreateDirectChatBodySchema,
} as const;

const CreateGroupChatValidationSchema = {
  body: CreateGroupChatBodySchema,
} as const;

const AddMemberInGroupValidationSchema = {
  body: AddMemberInGroupBodySchema,
} as const;

const RemoveMemberFromGroupValidationSchema = {
  body: RemoveMemberFromGroupBodySchema,
} as const;

const UpdateRoleOfGroupMemberValidationSchema = {
  body: UpdateRoleOfGroupMemberBodySchema,
} as const;

const SendNotificationValidationSchema = {
  body: SendNotificationBodySchema,
} as const;

const GetUsersValidationSchema = {
  query: GetUsersQuerySchema,
} as const;

const UploadFileValidationSchema = {
  query: UploadFileQuerySchema,
} as const;

const DeleteFileValidationSchema = {
  query: DeleteFileQuerySchema,
} as const;

const GenerateTokenValidationSchema = {} as const;
const GetChannelListValidationSchema = {} as const;

// ==================== Validators ====================

// ==================== Validators ====================

const createDirectChatValidator = validate(
  CreateDirectChatValidationSchema,
  validationErrorHandler,
);

const createGroupChatValidator = validate(
  CreateGroupChatValidationSchema,
  validationErrorHandler,
);

const addMemberInGroupValidator = validate(
  AddMemberInGroupValidationSchema,
  validationErrorHandler,
);

const removeMemberFromGroupValidator = validate(
  RemoveMemberFromGroupValidationSchema,
  validationErrorHandler,
);

const updateRoleOfGroupMemberValidator = validate(
  UpdateRoleOfGroupMemberValidationSchema,
  validationErrorHandler,
);

const sendNotificationValidator = validate(
  SendNotificationValidationSchema,
  validationErrorHandler,
);

const getUsersValidator = validate(
  GetUsersValidationSchema,
  validationErrorHandler,
);

const uploadFileValidator = validate(
  UploadFileValidationSchema,
  validationErrorHandler,
);

const deleteFileValidator = validate(
  DeleteFileValidationSchema,
  validationErrorHandler,
);

const generateTokenValidator = validate(
  GenerateTokenValidationSchema,
  validationErrorHandler,
);

const getChannelListValidator = validate(
  GetChannelListValidationSchema,
  validationErrorHandler,
);

export const chatValidators = {
  createDirectChat: createDirectChatValidator,
  createGroupChat: createGroupChatValidator,
  addMemberInGroup: addMemberInGroupValidator,
  removeMemberFromGroup: removeMemberFromGroupValidator,
  updateRoleOfGroupMember: updateRoleOfGroupMemberValidator,
  sendNotification: sendNotificationValidator,
  getUsers: getUsersValidator,
  uploadFile: uploadFileValidator,
  deleteFile: deleteFileValidator,
  generateToken: generateTokenValidator,
  getChannelList: getChannelListValidator,
};
