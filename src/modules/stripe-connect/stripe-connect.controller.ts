import { stripeConnectHelper } from "@/modules/stripe-connect/helpers/stripe-connect.helper";
import { paymentGateway } from "@/providers/payment";
import { ErrorResponse, SuccessResponse } from "@/helpers/api-response";
import { ObjectId } from "@/helpers/common";
import {
  buildSearchFilter,
  getMongoFilter,
  getMongoSort,
  parseQueryString,
} from "@/helpers/query";
import {
  buildPaginatedResponse,
  extractLimitAndOffset,
} from "@/helpers/pagination";
import { CURRENCY } from "@/providers/payment/stripe/stripe.types";
import status from "http-status";
import { TStripeConnectController } from "@/modules/stripe-connect/utils/stripe-connect.types";
import { TRANSFER_STATUS } from "@/modules/stripe-connect/utils/stripe-connect.enum";
import { STRIPE_CONNECT_MESSAGES } from "@/modules/stripe-connect/utils/stripe-connect.constant";
import {
  emptyOrderCounts,
  isWithinRefundWindow,
} from "@/modules/stripe-connect/utils/stripe-connect.util";
import { toCents } from "@/helpers/stripe";

/**
 * StripeConnectController class for handling Stripe Connect related HTTP requests
 */
export class StripeConnectController {
  /**
   * Get products with pagination and filtering
   */
  product: TStripeConnectController["product"] = async (req, res, next) => {
    try {
      const user = req.user!;
      const { query } = req;
      const searchValue = query.search;
      const { page, pageSize } = extractLimitAndOffset(
        query.page,
        query.pageSize,
      );

      const { filters, sorting } = parseQueryString(req.query);

      const mongoFilter = getMongoFilter({
        filters,
        searchColumns: ["title"],
        searchValue: searchValue,
      });

      const mongoSort = getMongoSort(sorting);

      const companyRef = user.companyRef!;

      const data = await stripeConnectHelper.findAllProducts({
        companyRef: companyRef?._id || companyRef,
        filters: mongoFilter,
        sorting: mongoSort,
        page,
        pageSize,
      });
      return SuccessResponse(res, status.OK, {
        message: STRIPE_CONNECT_MESSAGES.SUCCESS,
        data,
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * Create payment intent for a product
   */
  createPaymentIntent: TStripeConnectController["createPaymentIntent"] = async (
    req,
    res,
    next,
  ) => {
    try {
      const { productId } = req.body;
      const productData = await stripeConnectHelper.findOneProduct(
        ObjectId(productId),
      );

      if (!productData) {
        return ErrorResponse(res, status.BAD_REQUEST, {
          message: STRIPE_CONNECT_MESSAGES.PRODUCT_NOT_FOUND,
        });
      }

      const user = req.user!;

      // StripeConnectCustomer.companyRef is required, so a companyless caller
      // would leave a customer at Stripe and no order anyone can look up.
      if (!user.companyRef) {
        return ErrorResponse(res, status.FORBIDDEN, {
          message: STRIPE_CONNECT_MESSAGES.NO_COMPANY,
        });
      }

      const customerId = await stripeConnectHelper.resolveCustomerId(user);

      const paymentIntent = await paymentGateway.createPaymentIntent({
        amount: toCents(productData.price as number),
        currency: CURRENCY.USD,
        customerId,
      });

      await stripeConnectHelper.createTransaction({
        stripeAccountId: productData.stripeAccountId,
        stripeCustomerId: customerId,
        stripePaymentIntentId: paymentIntent.id,
        productRef: productData._id,
        amountPaid: productData.price as number,
        companyRef: productData.companyRef,
      });

      return SuccessResponse(res, status.OK, {
        message: STRIPE_CONNECT_MESSAGES.SUCCESS,
        data: {
          clientSecret: paymentIntent.client_secret,
          paymentIntentId: paymentIntent.id,
        },
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * Create a Stripe customer
   */
  createCustomer: TStripeConnectController["createCustomer"] = async (
    req,
    res,
    next,
  ) => {
    try {
      const user = req.user!;
      const customerData = await stripeConnectHelper.getCustomer(user._id);

      if (customerData) {
        return ErrorResponse(res, status.UNPROCESSABLE_ENTITY, {
          message: STRIPE_CONNECT_MESSAGES.CUSTOMER_ALREADY_EXISTS,
        });
      }

      if (!user.companyRef) {
        return ErrorResponse(res, status.FORBIDDEN, {
          message: STRIPE_CONNECT_MESSAGES.NO_COMPANY,
        });
      }

      const customerId = await stripeConnectHelper.resolveCustomerId(user);

      return SuccessResponse(res, status.OK, {
        message: STRIPE_CONNECT_MESSAGES.SUCCESS,
        data: {
          stripeCustomerId: customerId,
        },
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * Get customer details
   */
  getCustomer: TStripeConnectController["getCustomer"] = async (
    req,
    res,
    next,
  ) => {
    try {
      const userRef = req.user!._id;
      const customerData = await stripeConnectHelper.getCustomer(userRef);

      return SuccessResponse(res, status.OK, {
        message: STRIPE_CONNECT_MESSAGES.SUCCESS,
        data: {
          stripeCustomerId: customerData?.stripeCustomerId,
        },
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * Get past orders with pagination and filtering
   */
  pastOrders: TStripeConnectController["pastOrders"] = async (
    req,
    res,
    next,
  ) => {
    try {
      const userRef = req.user!._id;
      const customerData = await stripeConnectHelper.getCustomer(userRef);
      const stripeCustomerId = customerData?.stripeCustomerId;

      const query = req.query;
      const searchValue = query.search;

      const { page, pageSize, skips } = extractLimitAndOffset(
        query.page,
        query.pageSize,
      );

      // A bare [] has no .data for the table to read.
      if (!stripeCustomerId) {
        return SuccessResponse(res, status.OK, {
          message: STRIPE_CONNECT_MESSAGES.SUCCESS,
          data: buildPaginatedResponse([], { page, pageSize, totalCount: 0 }),
        });
      }

      const queryCopy = { ...query };
      delete queryCopy.search;
      delete queryCopy.page;
      delete queryCopy.pageSize;

      const { filters, sorting } = parseQueryString(queryCopy);

      const mongoFilter = getMongoFilter({
        filters,
      });

      const mongoSort = getMongoSort(sorting);
      const searchFilter = buildSearchFilter(searchValue, [
        "productDetails.title",
      ]);

      const transactions = await stripeConnectHelper.getAllOrders(
        stripeCustomerId,
        {
          page,
          pageSize,
          skips,
          filters: mongoFilter,
          sorting: mongoSort,
          searchFilter,
        },
      );

      return SuccessResponse(res, status.OK, {
        message: STRIPE_CONNECT_MESSAGES.SUCCESS,
        data: transactions,
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * Get count of past orders
   */
  pastOrdersCount: TStripeConnectController["pastOrdersCount"] = async (
    req,
    res,
    next,
  ) => {
    try {
      const userRef = req.user!._id;
      const customerData = await stripeConnectHelper.getCustomer(userRef);
      const stripeCustomerId = customerData?.stripeCustomerId;

      // A bare [] would make the UI read counts off an array.
      if (!stripeCustomerId) {
        return SuccessResponse(res, status.OK, {
          message: STRIPE_CONNECT_MESSAGES.SUCCESS,
          data: emptyOrderCounts(),
        });
      }

      const count =
        await stripeConnectHelper.getAllOrdersCount(stripeCustomerId);

      return SuccessResponse(res, status.OK, {
        message: STRIPE_CONNECT_MESSAGES.SUCCESS,
        data: count,
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * Refund an order
   */
  refundOrder: TStripeConnectController["refundOrder"] = async (
    req,
    res,
    next,
  ) => {
    try {
      const stripeTransactionId = req.params.id;

      // ORDERS_MANAGE is valued "my-orders:view" on the base role, so it
      // identifies nobody — ownership comes from the Connect customer id.
      const customerData = await stripeConnectHelper.getCustomer(req.user!._id);
      const stripeCustomerId = customerData?.stripeCustomerId;

      if (!stripeCustomerId) {
        return ErrorResponse(res, status.NOT_FOUND, {
          message: STRIPE_CONNECT_MESSAGES.ORDER_NOT_FOUND,
        });
      }

      const transactionDetails = await stripeConnectHelper.findOneOrder(
        ObjectId(stripeTransactionId),
        stripeCustomerId,
      );

      if (!transactionDetails) {
        return ErrorResponse(res, status.NOT_FOUND, {
          message: STRIPE_CONNECT_MESSAGES.ORDER_NOT_FOUND,
        });
      }

      if (transactionDetails.refunded) {
        return ErrorResponse(res, status.CONFLICT, {
          message: STRIPE_CONNECT_MESSAGES.ORDER_ALREADY_REFUNDED,
        });
      }

      const chargeId = transactionDetails.stripeChargeId;

      if (!chargeId || !transactionDetails.orderPlacedAt) {
        return ErrorResponse(res, status.CONFLICT, {
          message: STRIPE_CONNECT_MESSAGES.CHARGE_NOT_SETTLED,
        });
      }

      if (!isWithinRefundWindow(transactionDetails.orderPlacedAt)) {
        return ErrorResponse(res, status.CONFLICT, {
          message: STRIPE_CONNECT_MESSAGES.REFUND_WINDOW_EXPIRED,
        });
      }

      // The window is floored to whole days, so it can still say yes after the
      // payout job has closed the order out. These two fields are what the job
      // actually maintains.
      if (
        !transactionDetails.isRefundable ||
        transactionDetails.transferStatus !== TRANSFER_STATUS.PENDING
      ) {
        return ErrorResponse(res, status.CONFLICT, {
          message: STRIPE_CONNECT_MESSAGES.CANT_BE_REFUNDED,
        });
      }

      const { refunded } = await stripeConnectHelper.refundOrder(
        ObjectId(stripeTransactionId),
        chargeId,
      );

      if (!refunded) {
        return ErrorResponse(res, status.CONFLICT, {
          message: STRIPE_CONNECT_MESSAGES.CANT_BE_REFUNDED,
        });
      }

      return SuccessResponse(res, status.OK, {
        message: STRIPE_CONNECT_MESSAGES.SUCCESS,
        data: true,
      });
    } catch (error) {
      next(error);
    }
  };
}
