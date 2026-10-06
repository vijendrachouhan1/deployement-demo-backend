import { SuccessResponse } from "@/helpers/api-response";
import { productHelper } from "@/modules/products/helpers/product.helper";
import { PRODUCT_MESSAGES } from "@/modules/products/utils/product.constant";
import { TProductController } from "@/modules/products/utils/product.types";
import { ObjectId } from "@/helpers/common";
import { buildPaginatedResponse } from "@/helpers/pagination";
import status from "http-status";

/**
 * ProductController class for handling product-related HTTP requests
 */
export class ProductController {
  /**
   * Get all products with filtering and pagination
   */
  get: TProductController["getProducts"] = async (req, res, next) => {
    try {
      const user = req.user!;

      const query = req.query;

      const companyRef = user.companyRef!.toString();

      const result = await productHelper.findAll({
        ...query,
        companyRef,
      });

      const data = result[0];

      return SuccessResponse(res, status.OK, {
        message: PRODUCT_MESSAGES.FETCHED_SUCCESS,
        data: buildPaginatedResponse(data.items, {
          totalCount: data.total,
          page: data.page,
          pageSize: data.pageSize,
        }),
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * Get a single product by ID
   */
  getOne: TProductController["getProductById"] = async (req, res, next) => {
    try {
      const id = req.params.id;

      const data = await productHelper.findOne({
        _id: ObjectId(id),
        companyRef: req.user!.companyRef,
      });

      return SuccessResponse(res, status.OK, {
        message: PRODUCT_MESSAGES.FETCHED_ONE_SUCCESS,
        data,
      });
    } catch (error) {
      next(error);
    }
  };
}
