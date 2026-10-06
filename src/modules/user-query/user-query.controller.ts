import status from "http-status";
import { userQueryHelper } from "@/modules/user-query/helpers/user-query.helper";
import { TUserQueryController } from "@/modules/user-query/utils/user-query.types";
import { USER_TYPE } from "@/enums";
import { SuccessResponse } from "@/helpers/api-response";
import { USER_QUERY_MESSAGES } from "@/modules/user-query/utils/user-query.constant";

/**
 * UserQueryController class for handling user query-related HTTP requests
 */
export class UserQueryController {
  /**
   * Get all user queries with filtering and pagination
   */
  getAllUserQueries: TUserQueryController["getAllUserQueries"] = async (
    req,
    res,
    next,
  ) => {
    try {
      const userId: string = req.user!._id.toString();
      const role = req.user?.roles;

      const filter = userQueryHelper.parseQueryParams(req.query);

      if (role !== USER_TYPE.ADMIN) {
        filter.userId = userId;
      }

      if (req.user?.companyRef) {
        filter.companyRef = req.user.companyRef._id.toString();
      }

      const data = await userQueryHelper.getAllUserQueries(filter);

      return SuccessResponse(res, status.OK, {
        message: USER_QUERY_MESSAGES.FETCHED_SUCCESS,
        data,
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * Create a new user query
   */
  create: TUserQueryController["createUserQuery"] = async (req, res, next) => {
    try {
      const document = {
        ...req.body,
        userRef: req.user?._id ?? undefined,
        companyRef: req.user?.companyRef ?? undefined,
      };

      const userQuery = await userQueryHelper.create(document);

      return SuccessResponse(res, status.CREATED, {
        message: USER_QUERY_MESSAGES.CREATED_SUCCESS,
        data: userQuery,
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * Get a user query by ID
   */
  getById: TUserQueryController["getUserQueryById"] = async (
    req,
    res,
    next,
  ) => {
    try {
      const user = req.user!;

      const userQueryId = req.params.id;

      const userQuery = await userQueryHelper.findOne({
        _id: userQueryId,

        ...(user.roles === USER_TYPE.ADMIN
          ? { companyRef: user.companyRef }
          : { userRef: user._id }),
      });

      if (!userQuery) {
        return SuccessResponse(res, status.NOT_FOUND, {
          message: USER_QUERY_MESSAGES.NOT_FOUND,
        });
      }

      return SuccessResponse(res, status.OK, {
        message: USER_QUERY_MESSAGES.FETCHED_ONE_SUCCESS,
        data: userQuery,
      });
    } catch (error) {
      next(error);
    }
  };
}
