import { IProductsDocument, Products } from "@/db/models/products";
import { PAGINATION } from "@/constants/pagination";
import { STATUS } from "@/enums";
import { ObjectId } from "@/helpers/common";
import { createFacetPipeline } from "@/helpers/query";
import {
  TGetProductsQuery,
  IProduct,
} from "@/modules/products/utils/product.types";
import { FilterQuery } from "mongoose";

class ProductHelper {
  findOne = async (condition: FilterQuery<IProductsDocument>) => {
    return Products.findOne(condition);
  };

  findAll = async (query: TGetProductsQuery) => {
    const page = query.page || PAGINATION.DEFAULT_PAGE;
    const limit = query.pageSize || PAGINATION.DEFAULT_PAGE_SIZE;
    const skips = (page - 1) * limit;
    const searchValue = query.searchValue;
    const sortBy = query.sortBy === "true" ? 1 : -1;
    const companyRef = query.companyRef;

    const companyRefCondition = companyRef
      ? { companyRef: ObjectId(companyRef) }
      : {};

    const facetPipeline = createFacetPipeline(page, skips, limit);

    return Products.aggregate([
      {
        $match:
          searchValue && searchValue.length
            ? {
                title: { $regex: searchValue, $options: "i" },
                status: STATUS.ACTIVE,
                ...companyRefCondition,
              }
            : { status: STATUS.ACTIVE, ...companyRefCondition },
      },
      {
        $sort: {
          createdAt: sortBy,
        },
      },
      ...facetPipeline,
    ]);
  };

  create = async (document: IProduct) => {
    return Products.create(document);
  };

  findAndUpdate = async (
    condition: FilterQuery<IProductsDocument>,
    update: IProduct,
  ) => {
    return Products.findOneAndUpdate(
      condition,
      { ...update },
      { returnDocument: "after" },
    );
  };

  softDelete = async (condition: FilterQuery<IProductsDocument>) => {
    return Products.findOneAndUpdate(
      condition,
      { $set: { status: STATUS.DELETED } },
      { returnDocument: "after" },
    );
  };
}

export const productHelper = new ProductHelper();
