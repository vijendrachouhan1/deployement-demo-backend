import httpStatus from "http-status";

import { IProducts } from "@/db/models/products";
import { productHelper } from "@/modules/products/helpers/product.helper";
import { TProductController } from "@/modules/products/utils/product.types";
import { SuccessResponse } from "@/helpers/api-response";
import { ObjectId } from "@/helpers/common";

export class ProductSuperAdminController {
  public get: TProductController["getProducts"] = async (req, res, next) => {
    try {
      const query = req.query;

      const data = await productHelper.findAll(query);

      return SuccessResponse(res, httpStatus.OK, { message: "Success.", data });
    } catch (error) {
      next(error);
    }
  };

  public getOne: TProductController["getProductById"] = async (
    req,
    res,
    next,
  ) => {
    try {
      const id: string = req.params.id;

      const data = await productHelper.findOne({ _id: ObjectId(id) });

      return SuccessResponse(res, httpStatus.OK, { message: "Success.", data });
    } catch (error) {
      next(error);
    }
  };

  public update: TProductController["updateProduct"] = async (
    req,
    res,
    next,
  ) => {
    try {
      const id = req.params.id;
      const update = req.body;
      const { companyRef, ...rest } = update;

      const updatedProduct: Partial<IProducts> = { ...rest };

      if (companyRef) {
        updatedProduct.companyRef = ObjectId(companyRef);
      }
      const data = await productHelper.findAndUpdate(
        { _id: ObjectId(id) },
        updatedProduct,
      );

      return SuccessResponse(res, httpStatus.OK, { message: "Success.", data });
    } catch (error) {
      next(error);
    }
  };

  public create: TProductController["createProduct"] = async (
    req,
    res,
    next,
  ) => {
    try {
      const document = req.body;

      if (!document.companyRef) {
        throw new Error("Company Ref is required");
      }

      const data = await productHelper.create({
        ...document,
        companyRef: ObjectId(document.companyRef),
        userRef: req.user?._id,
      });

      return SuccessResponse(res, httpStatus.OK, { message: "Success.", data });
    } catch (error) {
      next(error);
    }
  };

  public delete: TProductController["deleteProduct"] = async (
    req,
    res,
    next,
  ) => {
    try {
      const id = req.params.id;
      const data = await productHelper.softDelete({
        _id: ObjectId(id),
      });

      return SuccessResponse(res, httpStatus.OK, { message: "Success.", data });
    } catch (error) {
      next(error);
    }
  };
}
