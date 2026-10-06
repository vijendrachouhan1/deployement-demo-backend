import { PaginatedResponse, PaginationOptions } from "@/types/pagination.types";
import { PAGINATION } from "../constants/pagination";

export function buildPaginatedResponse<T>(
  data: T[],
  { page, pageSize, totalCount }: PaginationOptions,
): PaginatedResponse<T> {
  const totalPages = Math.ceil(totalCount / pageSize);

  return {
    data,
    pagination: {
      currentPage: page,
      pageSize,
      totalCount,
      totalPages,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1,
      nextPage: page < totalPages ? page + 1 : null,
      previousPage: page > 1 ? page - 1 : null,
    },
  };
}

export const extractLimitAndOffset = (
  page?: number | string,
  pageSize?: number | string,
) => {
  page = Number(page) || PAGINATION.DEFAULT_PAGE;
  pageSize = Number(pageSize) || PAGINATION.DEFAULT_PAGE_SIZE;

  const skips = (page - 1) * pageSize;
  return { page, pageSize, skips };
};
