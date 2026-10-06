import envConfig from "@/config/env";
import { User } from "@/db/models/user";
import { EMAIL_TEMPLATE_NAME } from "@/enums/email.enum";
import { authService } from "@/providers/auth";
import { emailService } from "@/providers/email";
import status from "http-status";
import { generateAuthTokens } from "@/modules/auth/helpers/token.helper";

export const requestMagicLink = async (email: string) => {
  const user = await User.findOne({ email });

  if (!user) {
    return { success: true };
  }

  // 1. Create magic link session using Auth Provider
  const session = await authService.createMagicLinkSession({
    email,
    redirectURI: `${envConfig.FRONTEND_HOST}/callback/magic-link`,
  });

  await emailService.sendTemplateEmail({
    to: email,
    templateName: EMAIL_TEMPLATE_NAME.MAGIC_LINK_LOGIN,
    templateData: {
      magicLink: session.link,
    },
  });

  return { success: true };
};

export const verifyMagicLink = async (token: string) => {
  // 1. Verify magic link token using Auth Provider
  const data = await authService.verifyMagicLinkToken({
    code: token,
  });

  // 2. Check user exists in db or not
  const user = await User.findOne({ email: data.email });

  if (!user) {
    return {
      error: "Invalid or expired link",
      statusCode: status.UNAUTHORIZED,
      token: "",
    };
  }

  // 3. Generate JWT token
  const {
    token: jwtToken,
    refreshToken,
    permissions,
  } = await generateAuthTokens({ user });

  return {
    user: { ...user, permissions },
    token: jwtToken,
    refreshToken,
    statusCode: status.OK,
  };
};
