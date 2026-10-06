export interface PaginatedSearchQuery {
  page?: number;
  pageSize?: number;
  searchValue?: string;
  filter?: any;
  companyRef?: string;
  sortBy?: string;
  referredBy?: string;
}

export interface FilterValue {
  id: string;
  value: string[] | { from: string; to: string } | number[] | string | number;
  type?: FILTER_TYPE;
}

export interface SortValue {
  id: string;
  desc: boolean;
}

export enum FILTER_TYPE {
  MULTISELECT = "multiselect",
  SELECT = "select",
  DATERANGE = "daterange",
  RANGE = "range",
  SEARCH = "search",
  RADIO = "radio",
  DATE = "date",
}

export interface IBaseFilters {
  page: number;
  pageSize: number;
  skips: number;
  searchValue?: string;
  filters?: FilterValue[];
  sorting?: SortValue[];
}
