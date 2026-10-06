import status from "http-status";
import { productHelper } from "@/modules/products/helpers/product.helper";
import { ErrorResponse, SuccessResponse } from "@/helpers/api-response";
import { TProductController } from "@/modules/products/utils/product.types";
import { ObjectId } from "@/helpers/common";

/**
 * ProductsAdminController class for handling admin product-related HTTP requests
 */
export class ProductsAdminController {
  /**
   * Create a new product
   */
  create: TProductController["createProduct"] = async (req, res, next) => {
    const user = req.user!;

    try {
      const document = req.body;

      const data = await productHelper.create({
        ...document,
        companyRef: user.companyRef!._id,
      });
      return SuccessResponse(res, status.OK, { message: "Success.", data });
    } catch (error) {
      next(error);
    }
  };

  /**
   * Update an existing product
   */
  update: TProductController["updateProduct"] = async (req, res, next) => {
    const user = req.user!;

    try {
      const id: string = req.params.id;

      const update = req.body;

      const companyRef = user.companyRef!;

      const data = await productHelper.findAndUpdate(
        { _id: ObjectId(id), companyRef },
        update,
      );
      if (!data) {
        return ErrorResponse(res, status.BAD_REQUEST, {
          message: "Bad request. check the body",
        });
      }
      return SuccessResponse(res, status.OK, { message: "Success.", data });
    } catch (error) {
      next(error);
    }
  };

  /**
   * Soft delete a product
   */
  delete: TProductController["deleteProduct"] = async (req, res, next) => {
    const user = req.user!;

    try {
      const id = req.params.id;
      // Fetch companyRef from `req.user` to prevent unauthorized access to other companies' data.
      // This is done to prevent other ADMIN's misusing companyRef in `req.body`.
      const companyRef = user.companyRef!;

      const data = await productHelper.softDelete({
        _id: ObjectId(id),
        companyRef,
      });

      if (!data) {
        return ErrorResponse(res, status.BAD_REQUEST, {
          message: "Bad request. check the body",
        });
      }
      return SuccessResponse(res, status.OK, { message: "Success.", data });
    } catch (error) {
      next(error);
    }
  };
}
