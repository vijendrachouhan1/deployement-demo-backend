import envConfig from "@/config/env";
import { CookieOptions } from "express";
import { isProduction, isStaging } from "@/helpers/common";

const isSecure = isProduction() || isStaging();

// Token duration: 7 days
const MAX_AGE = 7 * 24 * 60 * 60 * 1000;

export const defaultCookieOptions: CookieOptions = {
  path: "/",
  domain: envConfig.COOKIE_DOMAIN_NAME,
  secure: isSecure,
  sameSite: "lax",
  maxAge: MAX_AGE,
};

// This is for non-sensitive data that might be needed by client-side JS
export const publicCookieOptions: CookieOptions = {
  ...defaultCookieOptions,
  httpOnly: false,
};

// This is for sensitive data like tokens
export const httpOnlyCookieOptions: CookieOptions = {
  ...defaultCookieOptions,
  httpOnly: true,
};

export const clearCookieOptions: CookieOptions = {
  path: "/",
  domain: envConfig.COOKIE_DOMAIN_NAME,
  secure: isSecure,
  sameSite: "lax",
};
