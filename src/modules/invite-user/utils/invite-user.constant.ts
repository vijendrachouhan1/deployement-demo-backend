// ==================== Batch Processing Constants ====================

export const INVITE_BATCH_SIZE = 50;

// ==================== Error Messages ====================

export const INVITE_USER_ERROR_MESSAGES = {
  COMPANY_REF_NOT_FOUND: "Company ref not found",
  INVITATION_CANCELLED: "Invitation cancelled successfully",
  INVALID_INVITE: "Invalid invite",
  USER_ALREADY_ACCEPTED: "has already accepted the invitation",
  EMAIL_NOT_INVITED: "is not invited",
  UNKNOWN_ERROR: "Unknown error",
} as const;

// ==================== Success Messages ====================

export const INVITE_USER_SUCCESS_MESSAGES = {
  INVITE_RESENT: "Invite resent successfully.",
  INVITE_SENT: "Invited mail sent successfully!",
  INVITATION_RESENT: "Invitation email re-sent successfully to",
  USER_DELETED: "Invited user deleted successfully.",
  INVITED_USERS_DATA: "Invited Users Data.",
  SUCCESS: "Success.",
} as const;
