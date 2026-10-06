import envConfig from "@/config/env";
import { User } from "@/db/models/user";
import { Company } from "@/db/models/company";
import { NOTIFICATION_TITLE, NOTIFICATION_TYPE } from "@/enums";
import { ErrorResponse, SuccessResponse } from "@/helpers/api-response";
import { ObjectId } from "@/helpers/common";
import { getNotificationChannels } from "@/helpers/notification";
import { notificationsHelper } from "@/modules/notifications/helpers/notifications.helper";
import { userHelper } from "@/modules/users/helpers/users.helper";
import { TUserController } from "@/modules/users/utils/users.types";
import { authService } from "@/providers/auth";
import {
  safeEmit,
  summarizeFailureReason,
} from "@/modules/audit-logs/helpers/emit.helper";
import { AuditAction, AuditStatus, AuditTargetType } from "@/enums/audit.enum";
import status from "http-status";
import {
  buildPasswordTimestamps,
  getPasswordRotationConfig,
} from "@/modules/auth/utils/auth.util";

export class SuperAdminUsersController {
  public updateUserProfile: TUserController["updateUserProfile"] = async (
    req,
    res,
    next,
  ) => {
    try {
      const userRef: string = req.params.id;
      const { update } = req.body;

      const companyRef: string = req.body.companyRef;

      const data = await userHelper.updateUser(
        { _id: ObjectId(userRef), companyRef: ObjectId(companyRef) },
        update,
      );
      if (!data) {
        return ErrorResponse(res, status.BAD_REQUEST, {
          message: "Bad request. check the body",
        });
      }

      const message = "Superadmin updated your profile!";

      const notificationPref = await notificationsHelper.getPreferences(
        ObjectId(userRef),
      );

      notificationsHelper.create(
        {
          userRef: ObjectId(userRef),
          message,
          title: "Profile Update",
          companyRef: ObjectId(companyRef),
          redirectUrl: `${envConfig.FRONTEND_HOST}/profile/profile-settings`,
        },
        {
          createNotificationInDb: true,
          channels: getNotificationChannels(
            notificationPref,
            NOTIFICATION_TYPE.PROFILE_AND_PASSWORD,
          ),
        },
      );

      return SuccessResponse(res, status.OK, {
        message: "Successfully updated user details.",
      });
    } catch (error) {
      next(error);
    }
  };

  public changeUserPassword: TUserController["changeUserPassword"] = async (
    req,
    res,
    next,
  ) => {
    try {
      const userRef: string = req.params.id;
      const user = await User.findById(ObjectId(userRef));
      const companyRef = user?.companyRef;
      const { currentPassword, newPassword, confirmedPassword } = req.body;

      if (!user) {
        return ErrorResponse(res, status.CONFLICT, {
          message: "Invalid UserRef.",
        });
      }

      if (newPassword !== confirmedPassword) {
        return ErrorResponse(res, status.UNPROCESSABLE_ENTITY, {
          message: "New password and confirmed password do not match",
        });
      }

      const message = "Superadmin changed your password!";

      await authService.authenticateWithPassword({
        email: user.email,
        password: currentPassword,
      });

      await authService.updateUser({
        userId: user.externalUserId!,
        password: newPassword,
      });

      const company = user.companyRef
        ? await Company.findById(user.companyRef).select(
            "rotatePassword passwordValidityDays passwordGraceDays",
          )
        : null;
      const rotationConfig = getPasswordRotationConfig(company);

      await User.findByIdAndUpdate(user._id, {
        hasPassword: true,
        ...buildPasswordTimestamps(rotationConfig.passwordValidityDays),
        forcePasswordChange: true,
      });

      const preferences = await notificationsHelper.getPreferences(
        ObjectId(userRef),
      );

      notificationsHelper.create(
        {
          title: NOTIFICATION_TITLE.PASSWORD_CHANGED,
          message,
          userRef: ObjectId(userRef),
          companyRef: companyRef?._id,
          redirectUrl: `${envConfig.FRONTEND_HOST}/profile/profile-settings/password`,
        },
        {
          createNotificationInDb: true,
          channels: getNotificationChannels(
            preferences,
            NOTIFICATION_TYPE.PROFILE_AND_PASSWORD,
          ),
        },
      );

      safeEmit({
        action: AuditAction.USER_PASSWORD_CHANGED_BY_SUPER_ADMIN,
        status: AuditStatus.SUCCESS,
        targetType: AuditTargetType.USER,
        targetId: userRef,
      });

      return SuccessResponse(res, status.OK, {
        message: `Changed password successfully`,
      });
    } catch (error) {
      safeEmit({
        action: AuditAction.USER_PASSWORD_CHANGED_BY_SUPER_ADMIN,
        status: AuditStatus.FAILURE,
        targetType: AuditTargetType.USER,
        targetId: req.params.id,
        failureReason: summarizeFailureReason(error),
      });
      next(error);
    }
  };
}
