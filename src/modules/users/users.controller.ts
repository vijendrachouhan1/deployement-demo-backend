import { User } from "@/db/models/user";
import { COOKIE_NAME, NOTIFICATION_TITLE, NOTIFICATION_TYPE } from "@/enums";
import { ErrorResponse, SuccessResponse } from "@/helpers/api-response";
import { cookieHelper } from "@/helpers/cookie";
import { getNotificationChannels } from "@/helpers/notification";
import {
  buildPasswordTimestamps,
  evaluatePasswordRotationState,
  getPasswordRotationConfig,
} from "@/modules/auth/utils/auth.util";
import { notificationsHelper } from "@/modules/notifications/helpers/notifications.helper";
import { USER_RESPONSE_MESSAGES } from "@/modules/users/utils/users.constant";
import { TUserController } from "@/modules/users/utils/users.types";
import { authService } from "@/providers/auth";
import { emailService } from "@/providers/email";
import status from "http-status";
import { generateAuthTokens } from "@/modules/auth/helpers/token.helper";

/**
 * UserController class for handling user-related HTTP requests
 */
export class UserController {
  /**
   * Get current user information
   */
  me: TUserController["me"] = async (req, res, next) => {
    try {
      if (!req.user) {
        return ErrorResponse(res, status.UNAUTHORIZED, {
          message: USER_RESPONSE_MESSAGES.USER_FETCH_ERROR,
        });
      }

      // tracking the user last activity time
      const user = await User.findByIdAndUpdate(
        req.user._id,
        {
          lastActivity: Date.now(),
        },
        { new: true },
      ).lean();

      const { company } = req.user;

      const rotationState = evaluatePasswordRotationState({
        user: user!,
        company: company || null,
      });

      cookieHelper.setCookie(res, {
        cookieName: COOKIE_NAME.PASSWORD_EXPIRED,
        value: String(rotationState.isBlocked),
        httpOnly: false,
      });

      return SuccessResponse(res, status.OK, {
        message: USER_RESPONSE_MESSAGES.USER_FETCH_SUCCESS,
        data: {
          ...user,
          permissions: req.user?.permissions,
          companyRef: company,
          isPasswordExpired: rotationState.isBlocked,
          passwordExpiryDaysLeft: rotationState.daysLeft,
        },
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * Update user profile
   */
  updateProfile: TUserController["updateProfile"] = async (req, res, next) => {
    const user = req.user;

    if (!user) {
      return ErrorResponse(res, status.UNAUTHORIZED, {
        message: USER_RESPONSE_MESSAGES.UNAUTHORIZED,
      });
    }

    try {
      const update = req.body;

      const companyRef = user?.companyRef;
      const message = USER_RESPONSE_MESSAGES.PROFILE_UPDATED;

      const updateData = {
        name: {
          first: update.name.first || user.name.first,
          last: update.name.last || user.name.last,
        },
        images: update.images ? [update.images] : user.images,
      };

      const updatedUser = await User.findByIdAndUpdate(user._id, updateData, {
        returnDocument: "after",
      });

      const preferences = await notificationsHelper.getPreferences(user._id);

      await notificationsHelper.create(
        {
          title: "Profile updated",
          message,
          companyRef,
          userRef: user._id,
        },
        {
          createNotificationInDb: true,
          channels: getNotificationChannels(
            preferences,
            NOTIFICATION_TYPE.PROFILE_AND_PASSWORD,
          ),
        },
      );

      const { token, refreshToken, permissions } = await generateAuthTokens({
        user: updatedUser!,
        loginMethod: req.loginMethod,
      });

      if (req.isMobile) {
        return SuccessResponse(res, status.OK, {
          message: USER_RESPONSE_MESSAGES.PROFILE_UPDATE_SUCCESS,
          data: { user: { ...updatedUser, permissions }, token, refreshToken },
        });
      }

      cookieHelper.setAuthCookies(res, {
        token,
        refreshToken,
        user: updatedUser!,
      });

      return SuccessResponse(res, status.OK, {
        message: USER_RESPONSE_MESSAGES.PROFILE_UPDATE_SUCCESS,
        data: {
          user: updatedUser,
        },
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * Change user password
   */
  changePassword: TUserController["changePassword"] = async (
    req,
    res,
    next,
  ) => {
    const user = req.user;

    if (!user) {
      return ErrorResponse(res, status.UNAUTHORIZED, {
        message: USER_RESPONSE_MESSAGES.UNAUTHORIZED,
      });
    }

    try {
      const { currentPassword, newPassword } = req.body;

      const userId = user._id;
      const companyRef = req.user?.companyRef;
      const message = USER_RESPONSE_MESSAGES.PASSWORD_CHANGED;

      await authService.authenticateWithPassword({
        email: user.email,
        password: currentPassword,
      });

      await authService.updateUser({
        userId: user.externalUserId!,
        password: newPassword,
      });

      const rotationConfig = getPasswordRotationConfig(user.company || null);
      const passwordUpdate = {
        hasPassword: true,
        ...buildPasswordTimestamps(rotationConfig.passwordValidityDays),
        forcePasswordChange: false,
      };
      const updatedUser = await User.findByIdAndUpdate(
        user._id,
        passwordUpdate,
        {
          new: true,
        },
      );

      const preferences = await notificationsHelper.getPreferences(userId);

      await notificationsHelper.create(
        {
          title: NOTIFICATION_TITLE.PASSWORD_CHANGED,
          message,
          companyRef,
          userRef: userId,
        },
        {
          createNotificationInDb: true,
          channels: getNotificationChannels(
            preferences,
            NOTIFICATION_TYPE.PROFILE_AND_PASSWORD,
          ),
        },
      );

      const { token, refreshToken, permissions } = await generateAuthTokens({
        user: updatedUser!,
        loginMethod: req.loginMethod,
      });

      if (req.isMobile) {
        return SuccessResponse(res, status.OK, {
          message: USER_RESPONSE_MESSAGES.PASSWORD_CHANGE_SUCCESS,
          data: { user: { ...updatedUser, permissions }, token, refreshToken },
        });
      }

      cookieHelper.setAuthCookies(res, {
        token,
        refreshToken,
        user,
      });

      await emailService.sendEmail({
        to: user.email,
        subject: `Your password was changed successfully`,
        html: `Password Change Confirmation`,
      });

      return SuccessResponse(res, status.OK, {
        message: USER_RESPONSE_MESSAGES.PASSWORD_CHANGE_SUCCESS,
        data: { user: updatedUser },
      });
    } catch (error) {
      next(error);
    }
  };
}
