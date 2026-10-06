export const ERROR_LOG_MESSAGES = {
  SUCCESS: "Success.",
  BAD_REQUEST: "Bad request. check the body",
  INVALID_CREDENTIALS: "Invalid credentials",
  ACCESS_DENIED: "Access denied !",
  SYSTEM_ACCOUNT_MFA_MISCONFIGURED:
    "MFA must not be enabled for system accounts. Contact an administrator.",
} as const;

export const DEFAULT_PAGE = 1;
export const DEFAULT_PAGE_SIZE = 10;
