import { stripePaymentHelper } from "@/modules/stripe-payment/helpers/stripe-payment.helper";
import { isWithinRefundWindow } from "@/modules/stripe-payment/utils/stripe-payment.util";
import { STRIPE_PAYMENT_MESSAGES } from "@/modules/stripe-payment/utils/stripe-payment.constant";
import {
  TStripePaymentController,
  TCreateCheckoutSession,
} from "@/modules/stripe-payment/utils/stripe-payment.types";
import { paymentGateway } from "@/providers/payment";
import { ErrorResponse, SuccessResponse } from "@/helpers/api-response";
import { toCents } from "@/helpers/stripe";
import { ObjectId } from "@/helpers/common";
import {
  buildSearchFilter,
  getMongoFilter,
  getMongoSort,
  parseQueryString,
} from "@/helpers/query";
import { extractLimitAndOffset } from "@/helpers/pagination";
import {
  UI_MODE,
  PAYMENT_MODE,
  REDIRECT_ON_COMPLETION,
  CURRENCY,
} from "@/modules/stripe-payment/utils/stripe-payment.enum";
import status from "http-status";

/**
 * StripePaymentController class for handling Stripe Payment related HTTP requests
 */
export class StripePaymentController {
  /**
   * Get products with pagination and filtering
   */
  product: TStripePaymentController["product"] = async (req, res, next) => {
    try {
      const user = req.user!;

      const { query } = req;

      const searchValue = query.search;

      const { page, pageSize } = extractLimitAndOffset(
        query.page,
        query.pageSize,
      );

      const { filters, sorting } = parseQueryString(query);

      const mongoFilter = getMongoFilter({
        filters,
        searchColumns: ["title"],
        searchValue: searchValue,
      });

      const mongoSort = getMongoSort(sorting);

      const companyRef = user.companyRef!;

      const data = await stripePaymentHelper.findAllProducts({
        companyRef: companyRef?._id || companyRef,
        filters: mongoFilter,
        sorting: mongoSort,
        page,
        pageSize,
      });
      return SuccessResponse(res, status.OK, {
        message: STRIPE_PAYMENT_MESSAGES.SUCCESS,
        data,
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * Get past orders with pagination and filtering
   */
  pastOrders: TStripePaymentController["pastOrders"] = async (
    req,
    res,
    next,
  ) => {
    try {
      const userRef = req.user!._id;
      const customerData = await stripePaymentHelper.getCustomer(userRef);

      if (!customerData) {
        return SuccessResponse(res, status.OK, {
          message: STRIPE_PAYMENT_MESSAGES.SUCCESS,
          data: [],
        });
      }

      const stripeCustomerId = customerData.stripeCustomerId;

      const query = req.query;
      const searchValue = query.search;

      const { page, pageSize, skips } = extractLimitAndOffset(
        query.page,
        query.pageSize,
      );

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

      const transactions = await stripePaymentHelper.getAllOrders(
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
        message: STRIPE_PAYMENT_MESSAGES.SUCCESS,
        data: transactions,
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * Get count of orders
   */
  ordersCount: TStripePaymentController["ordersCount"] = async (
    req,
    res,
    next,
  ) => {
    try {
      const userRef = req.user!._id;
      const customerData = await stripePaymentHelper.getCustomer(userRef);

      const stripeCustomerId = customerData?.stripeCustomerId;

      if (!stripeCustomerId) {
        return SuccessResponse(res, status.OK, {
          message: STRIPE_PAYMENT_MESSAGES.SUCCESS,
          data: [],
        });
      }

      const count = await stripePaymentHelper.getOrdersCount(stripeCustomerId);

      return SuccessResponse(res, status.OK, {
        message: STRIPE_PAYMENT_MESSAGES.SUCCESS,
        data: count,
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * Refund an order
   */
  refundOrder: TStripePaymentController["refundOrder"] = async (
    req,
    res,
    next,
  ) => {
    try {
      const stripeTransactionId = req.params.id;

      const transactionDetails = await stripePaymentHelper.findOneOrder(
        ObjectId(stripeTransactionId),
        req.user!._id,
      );

      if (!transactionDetails) {
        return ErrorResponse(res, status.NOT_FOUND, {
          message: STRIPE_PAYMENT_MESSAGES.ORDER_NOT_FOUND,
        });
      }

      if (transactionDetails.refunded) {
        return ErrorResponse(res, status.CONFLICT, {
          message: STRIPE_PAYMENT_MESSAGES.ORDER_ALREADY_REFUNDED,
        });
      }

      const chargeId = transactionDetails.stripeChargeId;

      if (!chargeId || !transactionDetails.orderPlacedAt) {
        return ErrorResponse(res, status.CONFLICT, {
          message: STRIPE_PAYMENT_MESSAGES.CHARGE_NOT_SETTLED,
        });
      }

      if (
        !transactionDetails.refundRequestedAt &&
        !isWithinRefundWindow(transactionDetails.orderPlacedAt)
      ) {
        return ErrorResponse(res, status.CONFLICT, {
          message: STRIPE_PAYMENT_MESSAGES.REFUND_WINDOW_EXPIRED,
        });
      }

      // The check above is a read, so two concurrent requests both pass it.
      const claimed = await stripePaymentHelper.claimOrderForRefund(
        ObjectId(stripeTransactionId),
        transactionDetails.refundRequestedAt ?? new Date(),
      );

      if (!claimed) {
        return ErrorResponse(res, status.CONFLICT, {
          message: STRIPE_PAYMENT_MESSAGES.REFUND_IN_PROGRESS,
        });
      }

      try {
        // A prior refund may have succeeded after a timeout; its idempotency key can expire.
        const alreadyRefunded = transactionDetails.refundRequestedAt
          ? (await paymentGateway.retrieveCharge(chargeId)).refunded
          : false;
        if (!alreadyRefunded) {
          await paymentGateway.createRefund(chargeId);
        }

        const completed = await stripePaymentHelper.completeOrderRefund(
          ObjectId(stripeTransactionId),
          claimed.refundClaimId!,
        );
        if (!completed.matchedCount) {
          return ErrorResponse(res, status.CONFLICT, {
            message: STRIPE_PAYMENT_MESSAGES.REFUND_IN_PROGRESS,
          });
        }
      } catch (refundError) {
        try {
          await stripePaymentHelper.releaseOrderRefundClaim(
            ObjectId(stripeTransactionId),
            claimed.refundClaimId!,
          );
        } catch (releaseError) {
          console.error(
            "Could not release refund claim; it will expire:",
            releaseError,
          );
        }
        throw refundError;
      }

      return SuccessResponse(res, status.OK, {
        message: STRIPE_PAYMENT_MESSAGES.SUCCESS,
        data: true,
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * Create checkout session
   */
  createCheckoutSession: TStripePaymentController["createCheckoutSession"] =
    async (req, res, next) => {
      try {
        // get product details using productId.
        const { productId } = req.body;
        const productData = await stripePaymentHelper.findOneProduct(
          ObjectId(productId),
        );

        if (!productData) {
          return ErrorResponse(res, status.BAD_REQUEST, {
            message: STRIPE_PAYMENT_MESSAGES.PRODUCT_NOT_FOUND,
          });
        }

        const user = req.user!;
        const userRef = user._id;

        // StripePaymentCustomer.companyRef is required, and the upsert below
        // does not run validators — a companyless caller would leave a
        // customer at Stripe and a row missing the field every read expects.
        if (!user.companyRef) {
          return ErrorResponse(res, status.FORBIDDEN, {
            message: STRIPE_PAYMENT_MESSAGES.NO_COMPANY,
          });
        }

        const customerId = await stripePaymentHelper.resolveCustomerId(user);

        const checkoutData: TCreateCheckoutSession = {
          customer: customerId,
          ui_mode: UI_MODE.EMBEDDED,
          mode: PAYMENT_MODE.PAYMENT,
          redirect_on_completion: REDIRECT_ON_COMPLETION.NEVER,
          allow_promotion_codes: true,
          line_items: [
            {
              price_data: {
                currency: CURRENCY.USD,
                unit_amount: toCents(productData.price as number),
                product_data: {
                  name: productData.title,
                },
              },
              quantity: 1,
            },
          ],
        };
        const session =
          await paymentGateway.createCheckoutSession(checkoutData);

        await stripePaymentHelper.createTransaction({
          userRef,
          stripeCustomerId: customerId,
          stripeCheckoutSessionId: session.id,
          productRef: productData._id,
          companyRef: productData.companyRef!,
        });

        return SuccessResponse(res, status.OK, {
          message: STRIPE_PAYMENT_MESSAGES.SUCCESS,
          data: { clientSecret: session.client_secret, sessionId: session.id },
        });
      } catch (error) {
        next(error);
      }
    };

  /**
   * Retrieve checkout session status
   */
  retrieveCheckoutSession: TStripePaymentController["sessionStatus"] = async (
    req,
    res,
    next,
  ) => {
    try {
      const sessionId = req.query.sessionId;

      const transaction = await stripePaymentHelper.findOrderByCheckoutSession(
        sessionId,
        req.user!._id,
      );

      if (!transaction) {
        return ErrorResponse(res, status.NOT_FOUND, {
          message: STRIPE_PAYMENT_MESSAGES.ORDER_NOT_FOUND,
        });
      }

      const session = await paymentGateway.retrieveCheckoutSession(sessionId);

      return SuccessResponse(res, status.OK, {
        message: STRIPE_PAYMENT_MESSAGES.SUCCESS,
        data: {
          status: session.status,
          customer_email: session.customer_details?.email,
        },
      });
    } catch (error) {
      next(error);
    }
  };
}
