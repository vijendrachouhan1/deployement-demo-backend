import { PaginatedSearchQuery } from "@/types/query.types";
import { ObjectId } from "@/helpers/common";
import { createFacetPipeline } from "@/helpers/query";
import { User } from "@/db/models/user";
import { Company, ICompany } from "@/db/models/company";
import { PAGINATION } from "@/constants/pagination";
import { extractLimitAndOffset } from "@/helpers/pagination";

class CompanyHelper {
  /**
   * Get all companies with pagination and search
   */
  getCompanies = async (query: PaginatedSearchQuery) => {
    const searchValue = query.searchValue;

    const { page, pageSize, skips } = extractLimitAndOffset(
      query.page,
      query.pageSize,
    );

    const facetPipeline = createFacetPipeline(page, skips, pageSize);

    return Company.aggregate([
      {
        $match:
          searchValue && searchValue.length
            ? { name: { $regex: searchValue, $options: "i" } }
            : {},
      },
      { $sort: { createdAt: -1 } },
      ...facetPipeline,
    ]);
  };

  /**
   * Get users of a specific company
   */
  getCompanyUsers = async (companyRef: string, query: PaginatedSearchQuery) => {
    const limit = query.pageSize || PAGINATION.DEFAULT_PAGE_SIZE;
    const page = query.page || PAGINATION.DEFAULT_PAGE;
    const skips = (page - 1) * limit;
    const searchValue = query.searchValue;

    const facetPipeline = createFacetPipeline(page, skips, limit);

    return User.aggregate([
      {
        $match: {
          companyRef: ObjectId(companyRef),
          ...(searchValue && searchValue.length
            ? { $text: { $search: searchValue } }
            : {}),
        },
      },
      ...facetPipeline,
    ]);
  };

  /**
   * Update a company by ID
   */
  update = async (companyRef: string, updatedData: Partial<ICompany>) => {
    return Company.findByIdAndUpdate(companyRef, updatedData, {
      new: true,
    });
  };

  /**
   * Get company details by ID
   */
  getCompanyDetails = async (id: string) => {
    return Company.findById(id).populate("userRef");
  };

  /**
   * Change user role within a company
   */
  changeUserRole = async (userId: string, companyRef: string, role: string) => {
    return User.updateOne({ _id: userId, companyRef }, { roles: role });
  };
}

export const companyHelper = new CompanyHelper();
