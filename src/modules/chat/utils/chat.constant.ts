export const DEFAULT_USER_NAME = "Default Name";

// Chat lives at a single frontend route for all non-super-admin roles, so the notification deep-link must not be derived from the user's role.
export const CHAT_ROUTE_PATH = "/client/chat";

export const CHAT_NOTIFICATION_MESSAGES = {
  NEW_DM: "New DM",
  TOKEN_GENERATED: "Token generated successfully.",
  USER_FETCHED: "User fetched successfully.",
  DM_CREATED: "DM created successfully.",
  GROUP_CREATED: "Group created successfully.",
  MEMBER_ADDED: "Member added to group successfully.",
  MEMBER_REMOVED: "Member removed from group successfully.",
  ROLE_CHANGED: "Role of member successfully changed",
  CHANNELS_FETCHED: "Channels fetched successfully.",
  NOTIFICATION_SENT: "Notification sent successfully.",
  FILE_UPLOADED: "File uploaded successfully.",
  FILE_DELETED: "File deleted successfully.",
  UNAUTHORIZED: "Unauthorized",
} as const;
