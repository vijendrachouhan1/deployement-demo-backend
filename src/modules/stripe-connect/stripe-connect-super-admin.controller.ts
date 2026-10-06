import status from "http-status";
import { stripeConnectHelper } from "@/modules/stripe-connect/helpers/stripe-connect.helper";
import { STRIPE_CONNECT_MESSAGES } from "@/modules/stripe-connect/utils/stripe-connect.constant";
import {
  ITransaction,
  TStripeConnectController,
} from "@/modules/stripe-connect/utils/stripe-connect.types";
import { SuccessResponse } from "@/helpers/api-response";
import {
  buildSearchFilter,
  getMongoFilter,
  getMongoSort,
  parseQueryString,
} from "@/helpers/query";
import { extractLimitAndOffset } from "@/helpers/pagination";
import ExcelJS from "exceljs";

export class StripeConnectSuperAdminController {
  /**
   * Get all stripe transactions (includes stripe payment, stripe connect, stripe subscriptions etc.)
   */
  getTransactions: TStripeConnectController["getTransactions"] = async (
    req,
    res,
    next,
  ) => {
    try {
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

      const transactions = await stripeConnectHelper.getSuperAdminTransactions({
        filters: mongoFilter,
        searchFilter,
        sorting: mongoSort,
        page,
        pageSize,
        skips,
      });

      return SuccessResponse(res, status.OK, {
        message: STRIPE_CONNECT_MESSAGES.SUCCESS,
        data: transactions,
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * Count all transactions
   */
  countTransactions: TStripeConnectController["countTransactions"] = async (
    req,
    res,
    next,
  ) => {
    try {
      const count = await stripeConnectHelper.countSuperAdminTransactions();
      return SuccessResponse(res, status.OK, {
        message: STRIPE_CONNECT_MESSAGES.SUCCESS,
        data: count,
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * Export transactions to Excel
   */
  exportTransactions: TStripeConnectController["exportTransactions"] = async (
    req,
    res,
    next,
  ) => {
    try {
      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      );
      res.setHeader(
        "Content-Disposition",
        "attachment; filename=transactions.xlsx",
      );

      const result = await stripeConnectHelper.getSuperAdminTransactions({
        page: 1,
        pageSize: 1000,
        skips: 0,
      });

      const transactions = result.data as ITransaction[];

      const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
        stream: res,
      });
      const worksheet = workbook.addWorksheet("Transactions");

      worksheet.columns = [
        { header: "ID", key: "id", width: 20 },
        { header: "User Name", key: "userName", width: 30 },
        { header: "Product Name", key: "productName", width: 30 },
        { header: "Vendor Name", key: "vendorName", width: 30 },
        { header: "Amount", key: "amount", width: 20 },
        { header: "Purchase Date", key: "purchaseDate", width: 20 },
        { header: "Payment Status", key: "paymentStatus", width: 20 },
        { header: "Transfer Status", key: "transferStatus", width: 20 },
      ];

      for (const t of transactions) {
        worksheet
          .addRow({
            id: t._id.toString(),
            userName: t.user.name,
            productName: t.product.name,
            vendorName: t.vendor.name,
            purchaseDate: t.purchaseDate || t.createdAt,
            amount: t.amount,
            paymentStatus: t.paymentStatus,
            transferStatus: t.transferStatus,
          })
          .commit();
      }

      worksheet.commit();
      await workbook.commit();
    } catch (error) {
      next(error);
    }
  };

  /**
   * Get all vendors
   */
  getAllVendors: TStripeConnectController["getAllVendors"] = async (
    req,
    res,
    next,
  ) => {
    try {
      const query = req.query;
      const data = await stripeConnectHelper.getAllVendors(query);

      return SuccessResponse(res, status.OK, {
        message: STRIPE_CONNECT_MESSAGES.SUCCESS,
        data,
      });
    } catch (error) {
      next(error);
    }
  };
}
