export enum EMAIL_TEMPLATE_NAME {
  VERIFY_OTP = "VerifyOTPTemplate",
  RESET_PASSWORD = "ResetPasswordTemplate",
  WELCOME = "WelcomeEmail",
  INVITE_USER = "InviteUserTemplate",
  MAGIC_LINK_LOGIN = "MagicLinkLoginTemplate",
}

export enum EMAIL_PROVIDER {
  AWS = "aws",
  SENDGRID = "sendgrid",
  /** Captures emails in memory instead of sending. Development only, for E2E tests. */
  LOCAL = "local",
}
