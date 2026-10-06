import status from "http-status";

import { stripePaymentHelper } from "@/modules/stripe-payment/helpers/stripe-payment.helper";
import { STRIPE_PAYMENT_MESSAGES } from "@/modules/stripe-payment/utils/stripe-payment.constant";
import { DURATION } from "@/modules/stripe-payment/utils/stripe-payment.enum";
import {
  ITransactionDetails,
  TCreateCoupon,
  TStripePaymentController,
  TCreatePromotionCode,
  TListCoupons,
  TListPromotionCodes,
} from "@/modules/stripe-payment/utils/stripe-payment.types";
import { TObjectId } from "@/types/common.types";
import { paymentGateway } from "@/providers/payment";
import { PAGINATION } from "@/constants/pagination";
import { SuccessResponse } from "@/helpers/api-response";
import {
  buildSearchFilter,
  getMongoFilter,
  getMongoSort,
  parseQueryString,
} from "@/helpers/query";
import { extractLimitAndOffset } from "@/helpers/pagination";
import ExcelJS from "exceljs";

export class StripePaymentAdminController {
  // ---------------------------------
  // `stripe payment product` methods
  // ---------------------------------
  public createProduct: TStripePaymentController["createProduct"] = async (
    req,
    res,
    next,
  ) => {
    try {
      const user = req.user!;

      const userRef: TObjectId = user._id;
      const companyRef: TObjectId = user.companyRef!;

      const data = await stripePaymentHelper.createProduct({
        title: req.body.title,
        price: Number(req.body.price),
        userRef,
        companyRef,
      });
      return SuccessResponse(res, status.OK, {
        message: STRIPE_PAYMENT_MESSAGES.SUCCESS,
        data,
      });
    } catch (error) {
      next(error);
    }
  };

  public editProduct: TStripePaymentController["editProduct"] = async (
    req,
    res,
    next,
  ) => {
    try {
      const id: string = req.params.id;
      const { title, price } = req.body;

      const data = await stripePaymentHelper.editProduct(id, {
        title,
        ...(price !== undefined && { price: Number(price) }),
      });

      return SuccessResponse(res, status.OK, {
        message: STRIPE_PAYMENT_MESSAGES.SUCCESS,
        data,
      });
    } catch (error) {
      next(error);
    }
  };

  public deleteProduct: TStripePaymentController["deleteProduct"] = async (
    req,
    res,
    next,
  ) => {
    try {
      const id = req.params.id;
      const data = await stripePaymentHelper.deleteProduct(id);
      return SuccessResponse(res, status.OK, {
        message: STRIPE_PAYMENT_MESSAGES.SUCCESS,
        data,
      });
    } catch (error) {
      next(error);
    }
  };

  public getEarningChart: TStripePaymentController["getEarningChart"] = async (
    req,
    res,
    next,
  ) => {
    try {
      const { type } = req.query;

      const data = await stripePaymentHelper.calculateEarningChartData(
        req.user!.companyRef!.toString(),
        type as DURATION,
      );
      return SuccessResponse(res, status.OK, {
        message: STRIPE_PAYMENT_MESSAGES.SUCCESS,
        data,
      });
    } catch (error) {
      next(error);
    }
  };

  // ------------------------
  // `stripe coupon` methods
  // ------------------------
  public createCoupon: TStripePaymentController["createCoupon"] = async (
    req,
    res,
    next,
  ) => {
    try {
      const {
        name,
        duration,
        amount_off,
        currency,
        duration_in_months,
        max_redemptions,
        percent_off,
        redeem_by,
      } = req.body;

      const couponData: TCreateCoupon = {
        name,
        duration,
        ...(amount_off && { amount_off, currency }),
        ...(percent_off && { percent_off }),
        ...(duration_in_months && { duration_in_months }),
        ...(max_redemptions && { max_redemptions }),
        ...(redeem_by && { redeem_by }),
      };

      const data = await paymentGateway.createCoupon(couponData);
      return SuccessResponse(res, status.OK, {
        message: STRIPE_PAYMENT_MESSAGES.SUCCESS,
        data,
      });
    } catch (error) {
      next(error);
    }
  };

  public listCoupons: TStripePaymentController["listCoupons"] = async (
    req,
    res,
    next,
  ) => {
    try {
      const { limit, starting_after, ending_before }: any = req.query;

      const params: TListCoupons = {
        limit: Number(limit) || PAGINATION.DEFAULT_PAGE_SIZE,
      };

      if (starting_after) {
        params.starting_after = starting_after;
      } else if (ending_before) {
        params.ending_before = ending_before;
      }

      const data = await paymentGateway.listCoupons(params);
      return SuccessResponse(res, status.OK, {
        message: STRIPE_PAYMENT_MESSAGES.SUCCESS,
        data,
      });
    } catch (error) {
      next(error);
    }
  };

  public getCoupon: TStripePaymentController["getCoupon"] = async (
    req,
    res,
    next,
  ) => {
    try {
      const couponId: string = req.params.couponId;

      const data = await paymentGateway.getCoupon(couponId);

      return SuccessResponse(res, status.OK, {
        message: STRIPE_PAYMENT_MESSAGES.SUCCESS,
        data,
      });
    } catch (error) {
      next(error);
    }
  };

  public editCoupon: TStripePaymentController["editCoupon"] = async (
    req,
    res,
    next,
  ) => {
    try {
      const couponId: string = req.params.couponId;

      const data = await paymentGateway.updateCoupon(couponId, req.body);
      return SuccessResponse(res, status.OK, {
        message: STRIPE_PAYMENT_MESSAGES.SUCCESS,
        data,
      });
    } catch (error) {
      next(error);
    }
  };

  public deleteCoupon: TStripePaymentController["deleteCoupon"] = async (
    req,
    res,
    next,
  ) => {
    try {
      const couponId: string = req.params.couponId;
      const data = await paymentGateway.deleteCoupon(couponId);
      return SuccessResponse(res, status.OK, {
        message: STRIPE_PAYMENT_MESSAGES.SUCCESS,
        data,
      });
    } catch (error) {
      next(error);
    }
  };

  // --------------------------------
  // `stripe promotion code` methods
  // --------------------------------
  public createPromotionCode: TStripePaymentController["createPromotionCode"] =
    async (req, res, next) => {
      try {
        const promotionCodeData: TCreatePromotionCode = {
          coupon: req.body.coupon,
          code: req.body.code,
          ...(req.body.expires_at && { expires_at: req.body.expires_at }),
          ...(req.body.max_redemptions && {
            max_redemptions: req.body.max_redemptions,
          }),
        };

        const data =
          await paymentGateway.createPromotionCode(promotionCodeData);
        return SuccessResponse(res, status.OK, {
          message: STRIPE_PAYMENT_MESSAGES.SUCCESS,
          data,
        });
      } catch (error) {
        next(error);
      }
    };

  public listPromotionCodes: TStripePaymentController["listPromotionCodes"] =
    async (req, res, next) => {
      try {
        const couponId: string = req.params.couponId;

        const { limit, starting_after, ending_before }: any = req.query;

        const params: TListPromotionCodes = {
          limit: Number(limit) || PAGINATION.DEFAULT_PAGE_SIZE,
        };

        if (starting_after) {
          params.starting_after = starting_after;
        } else if (ending_before) {
          params.ending_before = ending_before;
        }

        const data = await paymentGateway.listPromotionCodes({
          coupon: couponId,
          ...params,
        });
        return SuccessResponse(res, status.OK, {
          message: STRIPE_PAYMENT_MESSAGES.SUCCESS,
          data,
        });
      } catch (error) {
        next(error);
      }
    };

  public updatePromotionCode: TStripePaymentController["updatePromotionCode"] =
    async (req, res, next) => {
      try {
        const promotionCodeId: string = req.params.promotionCodeId;

        const data = await paymentGateway.updatePromotionCode(
          promotionCodeId,
          req.body,
        );
        return SuccessResponse(res, status.OK, {
          message: STRIPE_PAYMENT_MESSAGES.SUCCESS,
          data,
        });
      } catch (error) {
        next(error);
      }
    };

  // ---------------------------------
  // `stripe payment transactions` methods
  // ---------------------------------
  public getTransactions: TStripePaymentController["getTransactions"] = async (
    req,
    res,
    next,
  ) => {
    try {
      const user = req.user!;
      const query = req.query;
      const searchValue = query.search as string;

      const { page, pageSize, skips } = extractLimitAndOffset(
        query.page as string,
        query.pageSize as string,
      );

      const queryCopy = { ...query };
      delete queryCopy.search;
      delete queryCopy.page;
      delete queryCopy.pageSize;

      const { filters, sorting } = parseQueryString(
        queryCopy as Record<string, string>,
      );

      const mongoFilter = getMongoFilter({
        filters,
      });

      const mongoSort = getMongoSort(sorting);
      const searchFilter = buildSearchFilter(searchValue, [
        "product.title",
        "user.name.first",
        "user.name.last",
      ]);

      const transactions = await stripePaymentHelper.getTransactions({
        filters: mongoFilter,
        searchFilter,
        sorting: mongoSort,
        page,
        pageSize,
        skips,
        companyRef: user?.companyRef!._id.toString(),
      });

      return SuccessResponse(res, status.OK, {
        message: STRIPE_PAYMENT_MESSAGES.SUCCESS,
        data: transactions,
      });
    } catch (error) {
      next(error);
    }
  };

  public countTransactions: TStripePaymentController["countTransactions"] =
    async (req, res, next) => {
      try {
        const companyRef = req.user!.companyRef!.toString();

        const data = await stripePaymentHelper.countTransactions(companyRef);

        return SuccessResponse(res, status.OK, {
          message: STRIPE_PAYMENT_MESSAGES.SUCCESS,
          data,
        });
      } catch (error) {
        next(error);
      }
    };

  public exportTransactions: TStripePaymentController["exportTransactions"] =
    async (req, res, next) => {
      try {
        const user = req.user!;
        res.setHeader(
          "Content-Type",
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        );
        res.setHeader(
          "Content-Disposition",
          "attachment; filename=transactions.xlsx",
        );

        const result = await stripePaymentHelper.getTransactions({
          companyRef: user.companyRef!.toString(),
          page: 1,
          pageSize: 1000,
          skips: 0,
          sorting: { createdAt: -1 },
        });

        const transactions = result.data as ITransactionDetails[];

        const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
          stream: res,
        });
        const worksheet = workbook.addWorksheet("Transactions");

        worksheet.columns = [
          { header: "ID", key: "id", width: 20 },
          { header: "User Name", key: "userName", width: 30 },
          { header: "Product Name", key: "productName", width: 30 },
          { header: "Amount", key: "amount", width: 20 },
          { header: "Purchase Date", key: "orderPlacedAt", width: 20 },
          { header: "Payment Status", key: "paymentStatus", width: 20 },
        ];

        for (const t of transactions) {
          worksheet
            .addRow({
              id: t._id.toString(),
              userName: t.userName,
              orderPlacedAt: t.orderPlacedAt || t.createdAt,
              productName: t.productName,
              amount: t.amount,
              paymentStatus: t.paymentStatus,
            })
            .commit();
        }

        worksheet.commit();
        await workbook.commit();
      } catch (error) {
        next(error);
      }
    };
}
