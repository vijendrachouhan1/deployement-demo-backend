import { User } from "@/db/models/user";
import { USER_TYPE } from "@/enums";
import { ErrorResponse, SuccessResponse } from "@/helpers/api-response";
import { ObjectId } from "@/helpers/common";
import { cookieHelper } from "@/helpers/cookie";
import { jwtHelper } from "@/helpers/jwt";
import { errorLogHelper } from "@/modules/error-logs/helpers/error-log.helper";
import { ERROR_LOG_MESSAGES } from "@/modules/error-logs/utils/error-log.constant";
import {
  IErrorLogSearchQuery,
  TErrorLogController,
} from "@/modules/error-logs/utils/error-log.types";
import { authService } from "@/providers/auth";
import status from "http-status";
/**
 * ErrorLogController class for handling error log-related HTTP requests
 */
export class ErrorLogController {
  /**
   * Get all error logs with pagination and filters
   */
  getErrors: TErrorLogController["getErrors"] = async (req, res, next) => {
    try {
      const query: IErrorLogSearchQuery = req.query;
      const data = await errorLogHelper.findAll(query);
      return SuccessResponse(res, status.OK, {
        message: ERROR_LOG_MESSAGES.SUCCESS,
        data,
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * Update the isImportant flag for an error log
   */
  updateIsImportantFlag: TErrorLogController["updateImportantFlag"] = async (
    req,
    res,
    next,
  ) => {
    try {
      const id = req.params.id;
      const { isImportantFlag } = req.body;

      const data = await errorLogHelper.updateIsImportantFlag(
        ObjectId(id),
        isImportantFlag,
      );
      if (!data) {
        return ErrorResponse(res, status.BAD_REQUEST, {
          message: ERROR_LOG_MESSAGES.BAD_REQUEST,
        });
      }
      return SuccessResponse(res, status.OK, {
        message: ERROR_LOG_MESSAGES.SUCCESS,
        data,
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * Login endpoint for system users
   */
  login: TErrorLogController["login"] = async (req, res, next) => {
    try {
      const { email, password } = req.body;

      const authUser = await authService.authenticateWithPassword({
        email,
        password,
      });

      const user = await User.findOne({
        $and: [{ externalUserId: authUser.user.id }],
      });

      if (!user || user.roles !== USER_TYPE.SYSTEM) {
        return ErrorResponse(res, status.UNAUTHORIZED, {
          message: ERROR_LOG_MESSAGES.ACCESS_DENIED,
        });
      }

      if (authUser.mfaRequired || user.mfa?.enrolled) {
        return ErrorResponse(res, status.UNAUTHORIZED, {
          message: ERROR_LOG_MESSAGES.SYSTEM_ACCOUNT_MFA_MISCONFIGURED,
        });
      }

      const token = jwtHelper.generateToken({
        _id: user._id.toString(),
        email: user.email,
      });

      if (req.isMobile) {
        return SuccessResponse(res, status.OK, {
          message: ERROR_LOG_MESSAGES.SUCCESS,
          data: { user, token },
        });
      }

      cookieHelper.setAuthCookies(res, {
        token,
        user,
      });

      return SuccessResponse(res, status.OK, {
        message: ERROR_LOG_MESSAGES.SUCCESS,
        data: { user },
      });
    } catch (error) {
      next(error);
    }
  };
}
