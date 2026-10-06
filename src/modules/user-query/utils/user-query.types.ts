import {
  GetAllUserQueriesValidationSchema,
  userQueryValidators,
} from "@/modules/user-query/utils/user-query.validation";
import z from "zod";
import {
  USER_QUERY_STATUS,
  USER_QUERY_SUBJECT,
} from "@/modules/user-query/utils/user-query.enum";

export type TGetAllUserQueriesQuery = z.infer<
  typeof GetAllUserQueriesValidationSchema.query
>;

export interface IUserQueryFilter {
  page?: number;
  pageSize?: number;

  search?: string;

  sortBy?: string;
  sortOrder?: "asc" | "desc";

  userId?: string;
  companyRef?: string;
  subjects?: USER_QUERY_SUBJECT[];
  status?: USER_QUERY_STATUS[];
  dateFrom?: string;
  dateTo?: string;
}

export type TUserQueryController = typeof userQueryValidators;
