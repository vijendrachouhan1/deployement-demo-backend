import httpStatus from "http-status";

import { TUserController } from "@/modules/users/utils/users.types";
import { ErrorResponse, SuccessResponse } from "@/helpers/api-response";
import { PaginatedSearchQuery } from "@/types/query.types";
import {
  USER_ANALYTICS_DURATION,
  USER_ANALYTICS_TYPE,
} from "@/modules/users/utils/users.enum";
import { userHelper } from "@/modules/users/helpers/users.helper";
import { rolesHelper } from "@/modules/roles/helpers/roles.helper";
import { USER_RESPONSE_MESSAGES } from "@/modules/users/utils/users.constant";
import { USER_TYPE } from "@/enums";
import { User } from "@/db/models/user";
import {
  safeEmit,
  summarizeFailureReason,
} from "@/modules/audit-logs/helpers/emit.helper";
import { AuditAction, AuditStatus, AuditTargetType } from "@/enums/audit.enum";

export class UserAdminController {
  public get: TUserController["getUsers"] = async (req, res, next) => {
    try {
      const query: PaginatedSearchQuery = req.query;

      const data = await userHelper.findAll({
        ...query,
        companyRef: req.user?.companyRef?.toString(),
      });

      return SuccessResponse(res, httpStatus.OK, {
        message: USER_RESPONSE_MESSAGES.DATA_FETCHED,
        data,
      });
    } catch (error) {
      next(error);
    }
  };

  public getOne: TUserController["getOne"] = async (req, res, next) => {
    try {
      const id = req.params.id;

      const data = await userHelper.findOne(id);

      return SuccessResponse(res, httpStatus.OK, {
        message: USER_RESPONSE_MESSAGES.DATA_FETCHED,
        data,
      });
    } catch (error) {
      next(error);
    }
  };

  public updateStatus: TUserController["updateStatus"] = async (
    req,
    res,
    next,
  ) => {
    try {
      const id: string = req.params.id;
      const { status } = req.body;
      const { user } = req;

      if (!user?.companyRef) {
        return ErrorResponse(res, httpStatus.BAD_REQUEST, {
          message: USER_RESPONSE_MESSAGES.COMPANY_REF_REQUIRED,
        });
      }

      const data = await userHelper.updateStatus(
        id,
        user.companyRef._id.toString(),
        status,
      );
      if (!data) {
        return ErrorResponse(res, httpStatus.BAD_REQUEST, {
          message: "Bad request. check the body",
        });
      }

      return SuccessResponse(res, httpStatus.OK, {
        message: USER_RESPONSE_MESSAGES.DATA_UPDATED_SUCCESS,
        data,
      });
    } catch (error) {
      next(error);
    }
  };

  public changeUserRole: TUserController["changeUserRole"] = async (
    req,
    res,
    next,
  ) => {
    const companyRef = req.params.id;
    const { role, userId } = req.body;

    try {
      const assignableRoles = await rolesHelper.listAssignableRoles(companyRef);

      if (!assignableRoles.some((assignable) => assignable.slug === role)) {
        return ErrorResponse(res, httpStatus.BAD_REQUEST, {
          message: USER_RESPONSE_MESSAGES.ROLE_NOT_ASSIGNABLE,
        });
      }

      const before = await User.findOne({ _id: userId, companyRef })
        .select("roles")
        .lean();

      const data = await userHelper.changeUserRole(userId, companyRef, role);

      safeEmit({
        action: AuditAction.USER_ROLE_CHANGED,
        status: AuditStatus.SUCCESS,
        targetType: AuditTargetType.USER,
        targetId: userId,
        changes: [{ field: "roles", before: before?.roles, after: role }],
      });

      return SuccessResponse(res, httpStatus.OK, {
        message: USER_RESPONSE_MESSAGES.DATA_UPDATED_SUCCESS,
        data,
      });
    } catch (error) {
      safeEmit({
        action: AuditAction.USER_ROLE_CHANGED,
        status: AuditStatus.FAILURE,
        targetType: AuditTargetType.USER,
        targetId: userId,
        failureReason: summarizeFailureReason(error),
      });
      next(error);
    }
  };

  public forcePasswordChange: TUserController["forcePasswordChange"] = async (
    req,
    res,
    next,
  ) => {
    try {
      const id = req.params.id;
      const companyRef = req.user?.companyRef;

      if (!companyRef) {
        return ErrorResponse(res, httpStatus.BAD_REQUEST, {
          message: USER_RESPONSE_MESSAGES.COMPANY_REF_REQUIRED,
        });
      }

      const data = await userHelper.updateUser(
        { _id: id, companyRef },
        { forcePasswordChange: true },
      );

      if (!data) {
        return ErrorResponse(res, httpStatus.NOT_FOUND, {
          message: "User not found for this company.",
        });
      }

      safeEmit({
        action: AuditAction.USER_PASSWORD_FORCE_CHANGE,
        status: AuditStatus.SUCCESS,
        targetType: AuditTargetType.USER,
        targetId: id,
      });

      return SuccessResponse(res, httpStatus.OK, {
        message: "Forced password change enabled for user.",
        data,
      });
    } catch (error) {
      safeEmit({
        action: AuditAction.USER_PASSWORD_FORCE_CHANGE,
        status: AuditStatus.FAILURE,
        targetType: AuditTargetType.USER,
        targetId: req.params.id,
        failureReason: summarizeFailureReason(error),
      });
      next(error);
    }
  };

  public forcePasswordChangeByCompany: TUserController["forcePasswordChangeByCompany"] =
    async (req, res, next) => {
      try {
        const user = req.user!;
        const id = req.params.id;
        const companyRef = user.companyRef!;

        if (!companyRef) {
          return ErrorResponse(res, httpStatus.BAD_REQUEST, {
            message: USER_RESPONSE_MESSAGES.COMPANY_REF_REQUIRED,
          });
        }

        if (user.roles === USER_TYPE.ADMIN && id !== companyRef.toString()) {
          return ErrorResponse(res, httpStatus.FORBIDDEN, {
            message: "Admin can force password change only for own company.",
          });
        }

        const data = await userHelper.updateMany(
          { companyRef, forcePasswordChange: false, _id: { $ne: user._id } },
          { forcePasswordChange: true },
        );

        safeEmit({
          action: AuditAction.COMPANY_FORCE_PASSWORD_CHANGE,
          status: AuditStatus.SUCCESS,
          targetType: AuditTargetType.COMPANY,
          targetId: companyRef.toString(),
          metadata: { affectedUserCount: data.modifiedCount },
        });

        return SuccessResponse(res, httpStatus.OK, {
          message: "Forced password change enabled for company users.",
          data,
        });
      } catch (error) {
        safeEmit({
          action: AuditAction.COMPANY_FORCE_PASSWORD_CHANGE,
          status: AuditStatus.FAILURE,
          targetType: AuditTargetType.COMPANY,
          targetId: req.user?.companyRef?.toString(),
          failureReason: summarizeFailureReason(error),
        });
        next(error);
      }
    };

  public getDashboardMetrics: TUserController["empty"] = async (
    req,
    res,
    next,
  ) => {
    const { user } = req;

    if (!user?.companyRef) {
      return ErrorResponse(res, httpStatus.BAD_REQUEST, {
        message: USER_RESPONSE_MESSAGES.COMPANY_REF_REQUIRED,
      });
    }

    try {
      const data = await userHelper.getDashboardStats(
        user.companyRef._id.toString(),
      );

      return SuccessResponse(res, httpStatus.OK, {
        message: USER_RESPONSE_MESSAGES.DATA_FETCHED,
        data,
      });
    } catch (error) {
      next(error);
    }
  };
  public getUserAnalytics: TUserController["userAnalytics"] = async (
    req,
    res,
    next,
  ) => {
    try {
      const {
        type = USER_ANALYTICS_TYPE.TOTAL,
        duration = USER_ANALYTICS_DURATION.MONTHLY,
        year,
      } = req.query;

      const data = await userHelper.getUserAnalytics(
        type,
        duration,
        year ? Number(year) : undefined,
      );

      return SuccessResponse(res, httpStatus.OK, {
        message: USER_RESPONSE_MESSAGES.DATA_FETCHED,
        data,
      });
    } catch (error) {
      next(error);
    }
  };
}
