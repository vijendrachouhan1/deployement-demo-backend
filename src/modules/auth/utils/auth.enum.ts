export enum LOGIN_METHOD {
  PASSWORD = "password",
  OTP = "otp",
}

/**
 * The flow a pending-MFA token was issued for. Each /auth/mfa route accepts only
 * the purposes it belongs to, so a login token cannot be spent on setup, disable
 * or reset. See MfaRouter in modules/auth/index.ts.
 */
export enum PENDING_MFA_PURPOSE {
  LOGIN = "login_mfa",
  SIGNUP = "signup_mfa",
}

export enum MFA_RESET_IDENTITY_METHOD {
  AUTHENTICATOR = "authenticator",
  EMAIL_OTP = "email_otp",
}
