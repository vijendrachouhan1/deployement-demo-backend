import { PaginatedSearchQuery } from "@/types/query.types";
import { ERROR_TYPE } from "@/enums";
import { errorLogValidators } from "@/modules/error-logs/utils/error-log.validation";

// ==================== Interfaces ====================

export interface IErrorLogSearchQuery extends PaginatedSearchQuery {
  errorType?: ERROR_TYPE;
  startDate?: Date | string;
  endDate?: Date | string;
}

// ==================== Controller Types ====================

export type TErrorLogController = typeof errorLogValidators;
