import { companyHelper } from "@/modules/company/helpers/company.helper";
import httpStatus from "http-status";
import { ErrorResponse, SuccessResponse } from "@/helpers/api-response";
import { TCompanyController } from "@/modules/company/utils/company.types";
import { COMPANY_MESSAGES } from "@/modules/company/utils/company.constant";

/**
 * CompanyAdminController class for handling admin company-related HTTP requests
 */
export class CompanyAdminController {
  /**
   * Update a company
   */
  updateCompany: TCompanyController["updateCompany"] = async (
    req,
    res,
    next,
  ) => {
    try {
      const id: string = req.params.id;

      if (!id) {
        return ErrorResponse(res, httpStatus.BAD_REQUEST, {
          message: "Bad request. id is required",
        });
      }

      const data = await companyHelper.update(id, req.body);
      return SuccessResponse(res, httpStatus.OK, {
        message: COMPANY_MESSAGES.COMPANY_UPDATED_SUCCESS,
        data,
      });
    } catch (error) {
      next(error);
    }
  };
}
