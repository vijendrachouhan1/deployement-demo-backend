import dayjs from "dayjs";
import { IUser } from "@/db/models/user";
import { STATUS, USER_TYPE } from "@/enums";
import { ERROR_CODES } from "@/constants/error-codes";
import { ICompany } from "@/db/models/company";
import { IUserDocument } from "@/db/models/user";
import {
  DEFAULT_PASSWORD_GRACE_DAYS,
  DEFAULT_PASSWORD_VALIDITY_DAYS,
  MFA_ENROLLMENT_REQUIRED_AT_SIGNUP,
  MFA_REQUIRED_ROLES,
} from "@/modules/auth/utils/auth.constant";
import {
  TPasswordRotationConfig,
  TPasswordRotationState,
} from "@/modules/auth/utils/auth.types";
import crypto from "crypto";

/** Checks whether an existing user account is inactive or has been deleted. */
export function isUserInactiveOrDeleted(user: IUser) {
  return user.status === STATUS.DELETED || user.status === STATUS.INACTIVE;
}

/**
 * Resolves the password rotation configuration for a company.
 * Falls back to default values when the company is `null` or the relevant fields are not set.
 */
export const getPasswordRotationConfig = (
  company: Partial<ICompany> | null,
): TPasswordRotationConfig => {
  return {
    rotatePassword: company?.rotatePassword ?? false,
    passwordValidityDays:
      company?.passwordValidityDays ?? DEFAULT_PASSWORD_VALIDITY_DAYS,
    passwordGraceDays:
      company?.passwordGraceDays ?? DEFAULT_PASSWORD_GRACE_DAYS,
  };
};

/** Builds the password expiration timestamp by adding the validity period to the current date. */
export const buildPasswordTimestamps = (
  passwordValidityDays: number = DEFAULT_PASSWORD_VALIDITY_DAYS,
): { passwordExpiresAt: Date } => {
  const today = dayjs();
  const passwordExpiresAt = today.add(passwordValidityDays, "day");

  return {
    passwordExpiresAt: passwordExpiresAt.toDate(),
  };
};

/**
 * Evaluates the current password rotation state for a user.
 *
 * Determines whether the user should be blocked from proceeding due to
 * password expiration policies, or warned that their password is about to expire.
 *
 * 1. If the user has no password set, they are not blocked.
 * 2. If password rotation is disabled for the company, they are not blocked.
 * 3. If `forcePasswordChange` is set, the user is blocked.
 * 4. If the password has not yet expired, the user is not blocked.
 * 5. If the password has expired but the grace period is still active, the
 *    user is not blocked but receives a warning with the remaining grace days.
 * 6. If the grace period has also elapsed, the user is blocked.
 */
export const evaluatePasswordRotationState = ({
  user,
  company,
  now = new Date(),
}: {
  user: IUserDocument;
  company: Partial<ICompany> | null;
  now?: Date;
}): TPasswordRotationState => {
  if (!user.hasPassword) {
    return { isBlocked: false };
  }

  const config = getPasswordRotationConfig(company);

  if (!config.rotatePassword) {
    return { isBlocked: false };
  }

  if (user.forcePasswordChange) {
    return { isBlocked: true, errorCode: ERROR_CODES.PASSWORD_CHANGE_REQUIRED };
  }

  const today = dayjs(now);
  const fallbackBaseDate = user.createdAt || now;

  const passwordExpiresAt = user.passwordExpiresAt
    ? dayjs(user.passwordExpiresAt)
    : dayjs(fallbackBaseDate).add(config.passwordValidityDays, "day");

  if (today.isSame(passwordExpiresAt) || today.isBefore(passwordExpiresAt)) {
    return { isBlocked: false };
  }

  const graceEndsAt = passwordExpiresAt.add(config.passwordGraceDays, "day");

  if (
    config.passwordGraceDays > 0 &&
    (today.isSame(graceEndsAt) || today.isBefore(graceEndsAt))
  ) {
    const daysLeft = Math.max(
      0,
      Math.ceil(graceEndsAt.diff(today, "day", true)),
    );

    return {
      isBlocked: false,
      errorCode: ERROR_CODES.PASSWORD_EXPIRING_SOON,
      daysLeft,
    };
  }

  return { isBlocked: true, errorCode: ERROR_CODES.PASSWORD_EXPIRED };
};

/**
 * Generates a list of recovery codes
 */
export function generateRecoveryCodes(count = 10) {
  return Array.from({ length: count }, () =>
    crypto.randomBytes(4).toString("hex").toUpperCase(),
  );
}

/**
 * Checks whether the user should be prompted/redirected for MFA enrollment
 */
export function shouldPromptUserForMfaEnrollment(role: USER_TYPE) {
  return MFA_ENROLLMENT_REQUIRED_AT_SIGNUP && MFA_REQUIRED_ROLES.includes(role);
}
