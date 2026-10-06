import { ErrorLogs } from "@/db/models/errorLogs";
import { createFacetPipeline } from "@/helpers/query";
import { IErrorLogSearchQuery } from "@/modules/error-logs/utils/error-log.types";
import { SORT_BY } from "@/modules/error-logs/utils/error-log.enum";
import {
  DEFAULT_PAGE,
  DEFAULT_PAGE_SIZE,
} from "@/modules/error-logs/utils/error-log.constant";
import { TObjectId } from "@/types";

/**
 * ErrorLogHelper class for handling error log database operations
 */
class ErrorLogHelper {
  /**
   * Find all error logs with pagination and filters
   */
  async findAll(query: IErrorLogSearchQuery) {
    const {
      page = DEFAULT_PAGE,
      pageSize: limit = DEFAULT_PAGE_SIZE,
      errorType,
      sortBy,
      startDate,
      endDate,
    } = query;
    const skips = (page - 1) * limit;
    const sort = sortBy === SORT_BY.OLDEST ? 1 : -1;

    // Build date filter if dates are provided
    const dateFilter: any = {};
    if (startDate || endDate) {
      dateFilter["createdAt"] = {};
      if (startDate) {
        dateFilter["createdAt"]["$gte"] = new Date(startDate);
      }
      if (endDate) {
        dateFilter["createdAt"]["$lte"] = new Date(endDate);
      }
    }

    const facetPipeline = createFacetPipeline(page, skips, limit);

    return ErrorLogs.aggregate([
      // errorType filter and Date filter stage (if dates provided)
      {
        $match: {
          type: errorType,
          ...(Object.keys(dateFilter).length > 0
            ? [{ $match: dateFilter }]
            : []),
        },
      },
      {
        $sort: {
          createdAt: sort,
        },
      },
      ...facetPipeline,
    ]);
  }

  /**
   * Update the isImportant flag for an error log
   */
  async updateIsImportantFlag(id: TObjectId, isImportantFlag: boolean) {
    return ErrorLogs.findByIdAndUpdate(
      id,
      { isImportant: isImportantFlag },
      { new: true },
    );
  }
}

export const errorLogHelper = new ErrorLogHelper();
