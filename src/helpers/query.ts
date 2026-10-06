import { FILTER_TYPE, FilterValue, SortValue } from "@/types/query.types";

export function createFacetPipeline(
  page: number,
  skips: number,
  pageSize: number,
) {
  return [
    {
      $facet: {
        items: [{ $skip: skips }, { $limit: pageSize }],
        totalCount: [{ $count: "count" }],
      },
    },
    {
      $addFields: {
        total: { $ifNull: [{ $arrayElemAt: ["$totalCount.count", 0] }, 0] },
        page: page,
        pageSize: pageSize,
      },
    },
    {
      $project: { items: 1, total: 1, page: 1, pageSize: 1 },
    },
  ];
}

export const buildNameSearchMatchStage = (searchValue?: string) => {
  if (!searchValue?.trim()) return null;

  const terms = searchValue.trim().split(/\s+/);
  const escapedSearchValue = searchValue.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); // Escape regex

  if (terms.length === 1) {
    const term = terms[0];
    const escapedTerm = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return {
      $match: {
        $or: [
          { "name.first": { $regex: escapedTerm, $options: "i" } },
          { "name.last": { $regex: escapedTerm, $options: "i" } },
        ],
      },
    };
  }

  // If 2+ words, match combined full name OR require all terms to be present in separate fields
  return {
    $match: {
      $or: [
        {
          $expr: {
            $regexMatch: {
              input: { $concat: ["$name.first", " ", "$name.last"] },
              regex: new RegExp(escapedSearchValue, "i"),
            },
          },
        },
        {
          $and: terms.map((term) => {
            const escapedTerm = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            return {
              $or: [
                { "name.first": { $regex: escapedTerm, $options: "i" } },
                { "name.last": { $regex: escapedTerm, $options: "i" } },
              ],
            };
          }),
        },
      ],
    },
  };
};

export const VALUE_SEPARATOR_DELIMETER = ",";
export const RANGE_DELIMETER = "|";
export const RANGE_VALUE_DELIMETER = "#";

function parseFilterValue(id: string, value: string): FilterValue | null {
  const [filterType, filterValue] = value.split(RANGE_VALUE_DELIMETER);

  if (!filterType || !filterValue) return null;

  switch (filterType) {
    case FILTER_TYPE.MULTISELECT:
      return {
        id,
        value: filterValue.split(VALUE_SEPARATOR_DELIMETER),
      };
    case FILTER_TYPE.RANGE:
      const rangeValues = filterValue
        .split(VALUE_SEPARATOR_DELIMETER)
        .map(Number);
      if (
        rangeValues.length === 2 &&
        !isNaN(rangeValues[0]) &&
        !isNaN(rangeValues[1])
      ) {
        return {
          id,
          value: rangeValues,
        };
      }
      return null;
    case FILTER_TYPE.DATERANGE:
      const [from, to] = filterValue.split(RANGE_DELIMETER);
      return {
        id,
        value: { from, to },
      };
    case FILTER_TYPE.RADIO:
    case FILTER_TYPE.DATE:
    case FILTER_TYPE.SELECT:
      return {
        id,
        value: filterValue,
      };
    default:
      return null;
  }
  return null;
}

export function parseQueryString(query: Record<string, string>): {
  filters: FilterValue[];
  sorting: SortValue[];
} {
  const filters: FilterValue[] = [];
  const sorting: SortValue[] = [];

  for (const [key, value] of Object.entries(query)) {
    if (
      key === "sort" ||
      key === "search" ||
      key === "page" ||
      key === "pageSize"
    )
      continue;

    const parsedFilter = parseFilterValue(key, value);
    if (parsedFilter) {
      filters.push(parsedFilter);
    }
  }

  // Process sorting
  const sortParam = query["sort"];
  if (sortParam) {
    const sortItems = sortParam.split(VALUE_SEPARATOR_DELIMETER);
    sortItems.forEach((item) => {
      const [id, direction] = item.split(RANGE_VALUE_DELIMETER);
      if (id && (direction === "asc" || direction === "desc")) {
        sorting.push({
          id,
          desc: direction === "desc",
        });
      }
    });
  }

  return { filters, sorting };
}

export function getMongoFilter({
  filters,
  searchValue,
  searchColumns,
}: {
  filters?: FilterValue[];
  searchValue?: string;
  searchColumns?: string[];
}): Record<string, unknown> {
  const mongoFilter: Record<string, unknown> = {};

  if (searchValue && searchColumns?.length) {
    mongoFilter.$or = searchColumns.map((column) => ({
      [column]: { $regex: searchValue, $options: "i" },
    }));
  }

  if (!filters?.length) return mongoFilter;

  filters.forEach((filter) => {
    const { id, value } = filter;

    if (Array.isArray(value)) {
      if (typeof value[0] === "string") {
        // Multiselect filter - use $in operator
        mongoFilter[id] = { $in: value };
      } else if (typeof value[0] === "number" && value.length === 2) {
        // Range filter - use $gte and $lte
        mongoFilter[id] = {
          $gte: value[0],
          $lte: value[1],
        };
      }
    } else if (typeof value === "object" && value.from && value.to) {
      if (value.from === "undefined") {
        mongoFilter[id] = {
          $lte: new Date(value.to),
        };
      } else if (value.to === "undefined") {
        mongoFilter[id] = {
          $gte: new Date(value.from),
        };
      } else {
        mongoFilter[id] = {
          $gte: new Date(value.from),
          $lte: new Date(value.to),
        };
      }
    } else if (value) {
      mongoFilter[id] = value;
    }
  });

  return mongoFilter;
}

export function getMongoSort(
  sorting: SortValue[] | undefined,
): Record<string, 1 | -1> {
  const mongoSort: Record<string, 1 | -1> = {};

  sorting?.forEach((sort) => {
    mongoSort[sort.id] = sort.desc ? -1 : 1;
  });
  if (!Object.keys(mongoSort).length) mongoSort.createdAt = -1;
  return mongoSort;
}

export function buildSearchFilter(
  searchValue: string | undefined,
  searchColumns: string[],
) {
  if (searchValue && searchColumns?.length) {
    return {
      $or: searchColumns.map((column) => ({
        [column]: { $regex: searchValue, $options: "i" },
      })),
    };
  }
  return {};
}
