import status from "http-status";

import { IUserQuery } from "@/db/models/userQuery";
import { ErrorResponse, SuccessResponse } from "@/helpers/api-response";
import { ObjectId } from "@/helpers/common";
import { userQueryHelper } from "@/modules/user-query/helpers/user-query.helper";
import { TUserQueryController } from "@/modules/user-query/utils/user-query.types";
import { emailService } from "@/providers/email";

export class UserQueryAdminController {
  public delete: TUserQueryController["delete"] = async (req, res, next) => {
    try {
      const userQueryId = req.params.id;
      const userQuery = await userQueryHelper.delete(userQueryId);

      if (!userQuery) {
        return ErrorResponse(res, status.NOT_FOUND, {
          message: "User query not found.",
        });
      }

      return SuccessResponse(res, status.OK, {
        message: "User query deleted successfully.",
      });
    } catch (error) {
      next(error);
    }
  };

  public update: TUserQueryController["update"] = async (req, res, next) => {
    try {
      const userQueryId = req.params.id;
      const updatedData = req.body as Partial<IUserQuery>;

      const userQuery = await userQueryHelper.findAndUpdate({
        id: userQueryId,
        update: updatedData,
      });

      if (!userQuery) {
        return ErrorResponse(res, status.NOT_FOUND, {
          message: "User query not found.",
          data: userQuery,
        });
      }

      return SuccessResponse(res, status.OK, {
        message: "User query updated successfully.",
        data: userQuery,
      });
    } catch (error) {
      next(error);
    }
  };

  public sendEmail: TUserQueryController["sendEmail"] = async (
    req,
    res,
    next,
  ) => {
    try {
      const { queryId } = req.params;

      const { message, bccEmails, ccEmails, subject } = req.body;

      const userQuery = await userQueryHelper.findOne({
        _id: ObjectId(queryId),
      });

      if (!userQuery) {
        return ErrorResponse(res, status.NOT_FOUND, {
          message: "User query not found.",
        });
      }
      const company = await userQueryHelper.getCompany(
        String(userQuery.companyRef),
      );

      if (!company || !company.supportEmail) {
        return ErrorResponse(res, status.NOT_FOUND, {
          message: "Company not found.",
        });
      }

      await emailService.sendEmail({
        from: company.supportEmail,
        to: userQuery.email,
        subject: subject || "Query support",
        html: message,
        cc: ccEmails,
        bcc: bccEmails,
      });

      return SuccessResponse(res, status.OK, {
        message: "Email sent successfully.",
        data: userQuery,
      });
    } catch (error) {
      next(error);
    }
  };
}
