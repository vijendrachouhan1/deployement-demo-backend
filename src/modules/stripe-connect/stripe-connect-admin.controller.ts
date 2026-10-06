import status from "http-status";

import { stripeConnectHelper } from "@/modules/stripe-connect/helpers/stripe-connect.helper";
import { STRIPE_CONNECT_MESSAGES } from "@/modules/stripe-connect/utils/stripe-connect.constant";
import { DURATION } from "@/modules/stripe-connect/utils/stripe-connect.enum";
import {
  TStripeConnectController,
  ITransactionDetails,
  TBalanceTransactions,
} from "@/modules/stripe-connect/utils/stripe-connect.types";
import { TObjectId } from "@/types/common.types";
import { PAGINATION } from "@/constants/pagination";
import { ErrorResponse, SuccessResponse } from "@/helpers/api-response";
import {
  buildSearchFilter,
  getMongoFilter,
  getMongoSort,
  parseQueryString,
} from "@/helpers/query";
import { extractLimitAndOffset } from "@/helpers/pagination";
import ExcelJS from "exceljs";
import { paymentGateway } from "@/providers/payment";

export class StripeConnectAdminController {
  // ---------------------------------
  // `stripe connect vendor` methods
  // ---------------------------------
  public vendorDetails: TStripeConnectController["vendorDetails"] = async (
    req,
    res,
    next,
  ) => {
    const user = req.user!;

    try {
      const userRef: TObjectId = user._id;
      const vendorData = await stripeConnectHelper.getVendor({ userRef });

      if (!vendorData) {
        return ErrorResponse(res, status.BAD_REQUEST, {
          message: STRIPE_CONNECT_MESSAGES.COMPLETE_ONBOARDING,
        });
      }

      const stripeAccount = await paymentGateway.getConnectAccount(
        vendorData.stripeAccountId,
      );

      const data = {
        stripeAccountId: vendorData?.stripeAccountId,
        isDetailsSubmitted: stripeAccount.details_submitted,
        isTransfersActive: stripeAccount.capabilities?.transfers,
      };

      return SuccessResponse(res, status.OK, {
        message: STRIPE_CONNECT_MESSAGES.SUCCESS,
        data,
      });
    } catch (error) {
      next(error);
    }
  };

  public createAccount: TStripeConnectController["createAccount"] = async (
    req,
    res,
    next,
  ) => {
    const user = req.user!;

    try {
      const userRef: TObjectId = user._id;
      const vendorData = await stripeConnectHelper.getVendor({ userRef });

      if (vendorData) {
        const data = { accountId: vendorData.stripeAccountId };
        return SuccessResponse(res, status.OK, {
          message: STRIPE_CONNECT_MESSAGES.SUCCESS,
          data,
        });
      }

      // create a vendor account using stripe api
      const account = await paymentGateway.createConnectAccount();

      // save the above created vendor details in the DB.
      await stripeConnectHelper.createVendor({
        userRef,
        stripeAccountId: account.id,
        companyRef: user.companyRef!,
      });

      return SuccessResponse(res, status.OK, {
        message: STRIPE_CONNECT_MESSAGES.SUCCESS,
        data: { accountId: account.id },
      });
    } catch (error) {
      next(error);
    }
  };

  public createAccountSession: TStripeConnectController["createAccountSession"] =
    async (req, res, next) => {
      try {
        const { accountId }: { accountId: string } = req.body;
        const accountSession =
          await paymentGateway.createAccountSession(accountId);

        return SuccessResponse(res, status.OK, {
          message: STRIPE_CONNECT_MESSAGES.SUCCESS,
          data: { clientSecret: accountSession.client_secret },
        });
      } catch (error) {
        next(error);
      }
    };

  public createDashboardLink: TStripeConnectController["createDashboardLink"] =
    async (req, res, next) => {
      try {
        const userRef: TObjectId = req.user!._id;
        const stripeConnectInfo = await stripeConnectHelper.getVendor({
          userRef,
        });

        if (!stripeConnectInfo?.stripeAccountId) {
          return ErrorResponse(res, status.CONFLICT, {
            message: "Stripe Account not yet created",
            data: null,
          });
        }

        const dashboardLink = await paymentGateway.createDashboardLink(
          stripeConnectInfo.stripeAccountId,
        );

        return SuccessResponse(res, status.OK, {
          message: STRIPE_CONNECT_MESSAGES.SUCCESS,
          data: { url: dashboardLink.url },
        });
      } catch (error) {
        next(error);
      }
    };

  public transferredTransactions: TStripeConnectController["transferredTransactions"] =
    async (req, res, next) => {
      try {
        const { limit, starting_after, ending_before } = req.query;

        const params: TBalanceTransactions = {
          limit: limit || PAGINATION.DEFAULT_PAGE_SIZE,
        };

        if (starting_after) {
          params.starting_after = starting_after;
        } else if (ending_before) {
          params.ending_before = ending_before;
        }

        const vendorData = await stripeConnectHelper.getVendor({
          userRef: req.user!._id,
        });

        if (!vendorData?.stripeAccountId) {
          return ErrorResponse(res, status.CONFLICT, {
            message: "Stripe Account not yet created",
            data: { data: [] },
          });
        }

        const transactions = await paymentGateway.getConnectBalanceTransactions(
          {
            ...params,
          },
          { stripeAccount: vendorData.stripeAccountId },
        );

        return SuccessResponse(res, status.OK, {
          message: STRIPE_CONNECT_MESSAGES.SUCCESS,
          data: transactions,
        });
      } catch (error) {
        next(error);
      }
    };

  public getAllTransactions: TStripeConnectController["getAllTransactions"] =
    async (req, res, next) => {
      try {
        const query: any = req.query;
        const vendorData = await stripeConnectHelper.getVendor({
          userRef: req.user!._id,
        });

        if (!vendorData?.stripeAccountId) {
          return ErrorResponse(res, status.CONFLICT, {
            message: STRIPE_CONNECT_MESSAGES.STRIPE_ACCOUNT_NOT_CREATED,
            data: [],
          });
        }
        const transactions = await stripeConnectHelper.getAllTransactions({
          ...query,
          stripeAccountId: vendorData.stripeAccountId,
        });

        return SuccessResponse(res, status.OK, {
          message: STRIPE_CONNECT_MESSAGES.SUCCESS,
          data: transactions,
        });
      } catch (error) {
        next(error);
      }
    };

  public getEarningDetails: TStripeConnectController["getEarningDetails"] =
    async (req, res, next) => {
      try {
        const vendorData = await stripeConnectHelper.getVendor({
          userRef: req.user!._id,
        });

        if (!vendorData?.stripeAccountId) {
          return ErrorResponse(res, status.CONFLICT, {
            message: STRIPE_CONNECT_MESSAGES.STRIPE_ACCOUNT_NOT_CREATED,
            data: [],
          });
        }

        const transactions = await stripeConnectHelper.getEarningDetails(
          vendorData.stripeAccountId,
        );

        const formattedData = Object.entries(transactions).reduce(
          (acc, [key, value]) => ({
            ...acc,
            [key]: Number(value).toFixed(2),
          }),
          {},
        );

        return SuccessResponse(res, status.OK, {
          message: STRIPE_CONNECT_MESSAGES.SUCCESS,
          data: formattedData,
        });
      } catch (error) {
        next(error);
      }
    };

  public getTransactionDetails: TStripeConnectController["getTransactionDetails"] =
    async (req, res, next) => {
      try {
        const user = req.user!;
        const query = req.query;
        const searchValue = query.search as string;

        const { page, pageSize, skips } = extractLimitAndOffset(
          query.page,
          query.pageSize,
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

        const vendorData = await stripeConnectHelper.getVendor({
          userRef: user._id,
        });

        if (!vendorData?.stripeAccountId) {
          return ErrorResponse(res, status.CONFLICT, {
            message: STRIPE_CONNECT_MESSAGES.STRIPE_ACCOUNT_NOT_CREATED,
            data: [],
          });
        }

        const transactions = await stripeConnectHelper.getTransactionDetails({
          filters: mongoFilter,
          searchFilter,
          sorting: mongoSort,
          page,
          pageSize,
          skips,
          companyRef: user?.companyRef!._id.toString(),
          stripeAccountId: vendorData.stripeAccountId,
        });

        return SuccessResponse(res, status.OK, {
          message: STRIPE_CONNECT_MESSAGES.SUCCESS,
          data: transactions,
        });
      } catch (error) {
        next(error);
      }
    };

  // ---------------------------------
  // `stripe connect product` methods
  // ---------------------------------
  public createProduct: TStripeConnectController["createProduct"] = async (
    req,
    res,
    next,
  ) => {
    try {
      const userRef: TObjectId = req.user!._id;
      const vendorData = await stripeConnectHelper.getVendor({ userRef });

      if (!vendorData?.stripeAccountId) {
        return ErrorResponse(res, status.CONFLICT, {
          message: STRIPE_CONNECT_MESSAGES.STRIPE_ACCOUNT_NOT_CREATED,
          data: [],
        });
      }

      const data = await stripeConnectHelper.createProduct({
        title: req.body.title,
        price: Number(req.body.price),
        userRef,
        stripeAccountId: vendorData.stripeAccountId,
        companyRef: vendorData.companyRef,
      });
      return SuccessResponse(res, status.OK, { message: "Success.", data });
    } catch (error) {
      next(error);
    }
  };

  public editProduct: TStripeConnectController["editProduct"] = async (
    req,
    res,
    next,
  ) => {
    try {
      const userRef: TObjectId = req.user!._id;
      const vendorData = await stripeConnectHelper.getVendor({ userRef });

      if (!vendorData?.stripeAccountId) {
        return ErrorResponse(res, status.CONFLICT, {
          message: STRIPE_CONNECT_MESSAGES.STRIPE_ACCOUNT_NOT_CREATED,
          data: [],
        });
      }

      const { title, price } = req.body;
      const data = await stripeConnectHelper.editProduct(req.params.id, {
        title,
        ...(price !== undefined && { price: Number(price) }),
        userRef,
        stripeAccountId: vendorData.stripeAccountId,
        companyRef: vendorData.companyRef,
      });

      return SuccessResponse(res, status.OK, {
        message: STRIPE_CONNECT_MESSAGES.PRODUCT_UPDATED,
        data,
      });
    } catch (error) {
      next(error);
    }
  };

  public deleteProduct: TStripeConnectController["deleteProduct"] = async (
    req,
    res,
    next,
  ) => {
    try {
      const user = req.user!;
      const id: string = req.params.id;
      const companyRef: string = user.companyRef!.toString();

      const data = await stripeConnectHelper.deleteProduct(id, companyRef);

      return SuccessResponse(res, status.OK, {
        message: STRIPE_CONNECT_MESSAGES.PRODUCT_DELETED,
        data,
      });
    } catch (error) {
      next(error);
    }
  };

  // -----------------------
  // Charts related methods
  // -----------------------
  public getEarnings: TStripeConnectController["getEarnings"] = async (
    req,
    res,
    next,
  ) => {
    try {
      const { type } = req.query; // "monthly", "yearly", or "weekly"

      const vendorData = await stripeConnectHelper.getVendor({
        userRef: req.user!._id,
      });

      if (!vendorData?.stripeAccountId) {
        return ErrorResponse(res, status.CONFLICT, {
          message: STRIPE_CONNECT_MESSAGES.STRIPE_ACCOUNT_NOT_CREATED,
          data: [],
        });
      }

      const earnings = await stripeConnectHelper.getEarningsByType(
        vendorData.stripeAccountId,
        type as DURATION,
      );

      return SuccessResponse(res, status.OK, {
        message: STRIPE_CONNECT_MESSAGES.SUCCESS,
        data: earnings,
      });
    } catch (error) {
      next(error);
    }
  };

  countTransactionByStatus: TStripeConnectController["countTransactionByStatus"] =
    async (req, res, next) => {
      try {
        const user = req.user!;
        const data = await stripeConnectHelper.countTransactionByStatus(
          user.companyRef!.toString(),
        );

        return SuccessResponse(res, status.OK, {
          message: STRIPE_CONNECT_MESSAGES.SUCCESS,
          data,
        });
      } catch (error) {
        next(error);
      }
    };

  exportTransactions: TStripeConnectController["exportTransactions"] = async (
    req,
    res,
    next,
  ) => {
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

      const vendorData = await stripeConnectHelper.getVendor({
        userRef: user._id,
      });
      if (!vendorData) {
        return ErrorResponse(res, status.UNAUTHORIZED, {
          message: STRIPE_CONNECT_MESSAGES.UNAUTHORIZED_REQUEST,
        });
      }

      const result = await stripeConnectHelper.getTransactionDetails({
        companyRef: user.companyRef!.toString(),
        stripeAccountId: vendorData.stripeAccountId,
        page: 1,
        pageSize: 1000,
      });

      const transactions = result.data as ITransactionDetails[];

      const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: res });
      const worksheet = workbook.addWorksheet("Transactions");

      worksheet.columns = [
        { header: "ID", key: "id", width: 20 },
        { header: "User Name", key: "name", width: 30 },
        { header: "Product", key: "productName", width: 30 },
        { header: "Price", key: "price", width: 20 },
        { header: "Purchase Date", key: "purchaseDate", width: 20 },
        { header: "Payment Status", key: "paymentStatus", width: 20 },
      ];

      for (const t of transactions) {
        worksheet
          .addRow({
            id: t._id.toString(),
            name: `${t.buyerName?.first} ${t.buyerName?.last}`,
            purchaseDate: t.purchaseDate || t.createdAt,
            productName: t.productName,
            price: t.price,
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
