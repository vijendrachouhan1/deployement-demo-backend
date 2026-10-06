export enum SERVER_ENV {
  PRODUCTION = "production",
  DEVELOPMENT = "development",
  STAGING = "staging",
  TEST = "test",
}

export enum STATUS {
  ACTIVE = "ACTIVE",
  INACTIVE = "INACTIVE",
  DELETED = "DELETED",
  PAST_DUE = "PAST_DUE",
}

// these are the default roles available for each organization
export enum USER_TYPE {
  SUPER_ADMIN = "super-admin",
  ADMIN = "admin",
  USER = "user",
  SYSTEM = "system",
}

export enum INVITED_USER_STATUS {
  ACCEPTED = "ACCEPTED",
  PENDING = "PENDING", // Email sent, waiting for user to accept
  CANCELED = "CANCELED",
  QUEUED = "QUEUED", // Inserted, but email not yet sent
  FAILED = "FAILED", // Email sending failed
  ALREADY_INVITED = "ALREADY_INVITED", // Not invited because it's a duplicate
}

export enum REFERRAL_TYPE {
  SIGN_UP = "SIGN_UP",
}

export enum SES_ACTIONS {
  CREATE = "create",
  UPDATE = "update",
  DELETE = "delete",
}

export enum FILE_OUTPUT_TYPE {
  JSON = "json",
  STRING = "string",
}

export enum PromiseStatus {
  FULFILLED = "fulfilled",
  REJECTED = "rejected",
  PENDING = "pending",
}

export enum ONE_SIGNAL_NOTIFICATION_EVENT {
  DISPLAYED = "notification.willDisplay",
  CLICKED = "notification.clicked",
  DISMISSED = "notification.dismissed",
}

export enum NOTIFICATION_CHANNEL {
  PUSH = "push",
  EMAIL = "email",
  IN_APP = "in_app",
}

export enum NOTIFICATION_TYPE {
  CHAT_MESSAGE = "chat_message",
  PROFILE_AND_PASSWORD = "profile_and_password",
}

export enum NOTIFICATION_TITLE {
  PASSWORD_CHANGED = "Password changed",
}

export enum COOKIE_NAME {
  TOKEN = "token",
  REFRESH_TOKEN = "refreshToken",
  USER_TYPE = "userType",
  COMPANY_REF = "companyRef",
  IS_ADMIN_PATH = "isAdminPath",
  USER_REF = "userRef",
  CHAT_TOKEN = "chatToken",
  PASSWORD_EXPIRED = "passwordExpired",
  // MFA related cookies
  MFA_CHALLENGE_ID = "mfaChallengeId",
  MFA_FACTOR_ID = "mfaFactorId",
  PENDING_MFA_TOKEN = "pendingMfaToken",
}

export enum ERROR_TYPE {
  GENERIC = "generic",
  EMAIL = "email",
}
