import { StripeConnectProducts } from "@/db/models/stripeConnect/products";
import {
  TCreateProduct,
  TFindAllProductsParams,
} from "@/modules/stripe-connect/utils/stripe-connect.types";
import { TObjectId } from "@/types/common.types";
import { buildPaginatedResponse } from "@/helpers/pagination";
import { createFacetPipeline } from "@/helpers/query";

/**
 * Find all products with pagination and filtering
 */
export async function findAllProducts({
  companyRef,
  filters = {},
  sorting = {},
  page = 1,
  pageSize = 10,
}: TFindAllProductsParams) {
  const skips = (page - 1) * pageSize;

  const pipeline = [
    {
      $match: {
        companyRef,
        ...filters,
      },
    },

    ...(Object.keys(sorting).length > 0 ? [{ $sort: sorting }] : []),

    {
      $project: {
        _id: 1,
        title: 1,
        price: 1,
      },
    },

    ...createFacetPipeline(page, skips, pageSize),
  ];

  const result = await StripeConnectProducts.aggregate(pipeline);
  const data = result[0];

  return buildPaginatedResponse(data.items, {
    page,
    pageSize,
    totalCount: data.total,
  });
}

/**
 * Find a single product by ID
 */
export async function findOneProduct(productId: TObjectId) {
  return StripeConnectProducts.findById(productId);
}

/**
 * Create a new product
 */
export async function createProduct(productDetails: TCreateProduct) {
  return StripeConnectProducts.create(productDetails);
}

/**
 * Edit an existing product
 */
export async function editProduct(
  productId: string,
  productDetails: Partial<TCreateProduct>,
) {
  return StripeConnectProducts.findByIdAndUpdate(
    productId,
    { $set: productDetails },
    { new: true },
  );
}

/**
 * Delete a product
 */
export async function deleteProduct(id: string, companyRef: string) {
  return StripeConnectProducts.findOneAndDelete({
    _id: id,
    companyRef: companyRef,
  });
}
