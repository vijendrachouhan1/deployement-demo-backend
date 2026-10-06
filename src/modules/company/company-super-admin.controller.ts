import { SuccessResponse } from "@/helpers/api-response";
import { companyHelper } from "@/modules/company/helpers/company.helper";
import { COMPANY_MESSAGES } from "@/modules/company/utils/company.constant";
import { TCompanyController } from "@/modules/company/utils/company.types";
import { PaginatedSearchQuery } from "@/types/query.types";
import status from "http-status";

/**
 * CompanySuperAdminController class for handling super admin company-related HTTP requests
 */
export class CompanySuperAdminController {
  /**
   * Get all companies
   */
  getCompanies: TCompanyController["getCompanies"] = async (req, res, next) => {
    try {
      const query: PaginatedSearchQuery = req.query;

      const data = await companyHelper.getCompanies(query);

      return SuccessResponse(res, status.OK, {
        message: COMPANY_MESSAGES.COMPANIES_FETCHED_SUCCESS,
        data,
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * Get users of a specific company
   */
  getCompanyUsers: TCompanyController["getCompanyUsers"] = async (
    req,
    res,
    next,
  ) => {
    try {
      const companyRef: string = req.params.id;
      const query: PaginatedSearchQuery = req.query;

      const data = await companyHelper.getCompanyUsers(companyRef, query);

      return SuccessResponse(res, status.OK, {
        message: COMPANY_MESSAGES.COMPANY_USERS_FETCHED_SUCCESS,
        data,
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * Edit a company
   */
  editCompany: TCompanyController["editCompany"] = async (req, res, next) => {
    try {
      const id: string = req.params.id;
      const update = req.body;

      const data = await companyHelper.update(id, update);

      return SuccessResponse(res, status.OK, {
        message: COMPANY_MESSAGES.COMPANY_UPDATED_SUCCESS,
        data,
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * Change user role within a company
   */
  changeUserRole: TCompanyController["changeUserRole"] = async (
    req,
    res,
    next,
  ) => {
    try {
      const companyRef = req.params.id;
      const roles = req.body.roles;
      const userId = req.body.userId;

      const data = await companyHelper.changeUserRole(
        userId,
        companyRef,
        roles,
      );

      return SuccessResponse(res, status.OK, {
        message: COMPANY_MESSAGES.USER_ROLE_CHANGED_SUCCESS,
        data,
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * Get company details
   */
  getCompanyDetails: TCompanyController["getCompanyDetails"] = async (
    req,
    res,
    next,
  ) => {
    try {
      const companyRef = req.params.id;

      const data = await companyHelper.getCompanyDetails(companyRef);

      return SuccessResponse(res, status.OK, {
        message: COMPANY_MESSAGES.COMPANY_DETAILS_FETCHED_SUCCESS,
        data,
      });
    } catch (error) {
      next(error);
    }
  };
}
