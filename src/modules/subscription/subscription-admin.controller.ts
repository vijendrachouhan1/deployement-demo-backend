import { NextFunction, Request, Response } from "express";
import { subscriptionHelper } from "@/modules/subscription/helpers/subscription.helper";
import { SUBSCRIPTION_MESSAGES } from "@/modules/subscription/utils/subscription.constant";
import { TSubscriptionController } from "@/modules/subscription/utils/subscription.types";
import { paymentGateway } from "@/providers/payment";
import { ErrorResponse, SuccessResponse } from "@/helpers/api-response";
import status from "http-status";

/**
 * SubscriptionAdminController class for handling admin subscription-related HTTP requests
 */
export class SubscriptionAdminController {
  /**
   * Get all Stripe subscription plans
   */
  getAllStripeSubscriptionPlans = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const data = await subscriptionHelper.findAllSubscriptionPlans();

      return SuccessResponse(res, status.OK, {
        message: SUBSCRIPTION_MESSAGES.FETCHED_SUCCESS,
        data,
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * Get user plans
   */
  getUserPlans = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user!;
      const companyId = user.companyRef;

      // Subscription.companyRef is required, so a companyless caller can never
      // have a plan to fetch. Saying so beats a 200 carrying null.
      if (!companyId) {
        return ErrorResponse(res, status.FORBIDDEN, {
          message: SUBSCRIPTION_MESSAGES.NO_COMPANY,
        });
      }

      const plans = await subscriptionHelper.findUserPlans(companyId);

      return SuccessResponse(res, status.OK, {
        message: SUBSCRIPTION_MESSAGES.USER_PLANS_SUCCESS,
        data: plans,
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * Create a Stripe customer
   */
  createStripeCustomer = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const user = req.user!;
      const data = await subscriptionHelper.createStripeCustomer(user);

      return SuccessResponse(res, status.OK, {
        message: SUBSCRIPTION_MESSAGES.CUSTOMER_CREATED,
        data,
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * Create a new subscription
   */
  createSubscription: TSubscriptionController["createSubscription"] = async (
    req,
    res,
    next,
  ) => {
    try {
      const { priceId } = req.body;
      const user = req.user!;

      // Same charge-with-no-record trap as changeSubscription: the webhook
      // cannot write a Subscription row without a companyRef, so a successful
      // charge here would leave the caller paying for nothing on record.
      if (!user.companyRef) {
        return ErrorResponse(res, status.FORBIDDEN, {
          message: SUBSCRIPTION_MESSAGES.NO_COMPANY,
        });
      }

      // Checking if stripe customer Id is created or not => If not then create one
      const userData = await subscriptionHelper.createStripeCustomer(user);
      const stripeCustomerId = userData!.stripeCustomerId;

      if (!stripeCustomerId) {
        return ErrorResponse(res, status.BAD_REQUEST, {
          message: "Stripe customer ID not found.",
        });
      }

      // Fetch and delete existing subscriptions (if any)
      await paymentGateway.cleanupIncompleteSubscriptions(stripeCustomerId);

      // Create new subscription
      const result = await paymentGateway.createSubscription(
        stripeCustomerId,
        priceId,
      );

      if (!result.success) {
        return ErrorResponse(res, status.PAYMENT_REQUIRED, {
          message: result.error,
        });
      }

      return SuccessResponse(res, status.OK, {
        message: SUBSCRIPTION_MESSAGES.SUBSCRIPTION_CREATED,
        data: {
          stripeCustomerId,
          subscriptionId: result.subscriptionId,
          clientSecret: result.clientSecret,
        },
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * Cancel a subscription
   */
  cancelSubscription: TSubscriptionController["cancelSubscription"] = async (
    req,
    res,
    next,
  ) => {
    try {
      const user = req.user!;
      const subscriptionId: string = req.body.subId;

      // A subscription id is not proof of ownership, so scope the lookup to
      // the caller's company before anything reaches Stripe. A caller with no
      // company owns nothing to cancel.
      if (!user.companyRef) {
        return ErrorResponse(res, status.FORBIDDEN, {
          message: SUBSCRIPTION_MESSAGES.NO_COMPANY,
        });
      }

      const subscription = await subscriptionHelper.findCompanySubscription(
        subscriptionId,
        user.companyRef,
      );

      if (!subscription) {
        return ErrorResponse(res, status.NOT_FOUND, {
          message: SUBSCRIPTION_MESSAGES.SUBSCRIPTION_NOT_FOUND,
        });
      }

      try {
        await paymentGateway.cancelSubscription(subscriptionId);
      } catch {
        return ErrorResponse(res, status.BAD_REQUEST, {
          message: SUBSCRIPTION_MESSAGES.CANCEL_FAILED,
        });
      }

      await subscriptionHelper.markCancellationRequested(subscription._id);

      return SuccessResponse(res, status.OK, {
        message: SUBSCRIPTION_MESSAGES.SUBSCRIPTION_CANCELLED,
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * Change subscription plan
   */
  changeSubscription: TSubscriptionController["changeSubscription"] = async (
    req,
    res,
    next,
  ) => {
    try {
      const { newPriceId } = req.body;
      const user = req.user!;
      const companyId = user.companyRef;

      // Without a company this reads as "on the free plan" and creates a real
      // paid subscription at Stripe — one the webhook can never record, since
      // Subscription.companyRef is required. The caller is charged for a plan
      // the app will never show them.
      if (!companyId) {
        return ErrorResponse(res, status.FORBIDDEN, {
          message: SUBSCRIPTION_MESSAGES.NO_COMPANY,
        });
      }

      // Checking if stripe customer Id is created or not => If not then create one
      const userData = await subscriptionHelper.createStripeCustomer(user);
      const stripeCustomerId = userData!.stripeCustomerId;

      if (!stripeCustomerId) {
        return ErrorResponse(res, status.BAD_REQUEST, {
          message: "Stripe customer ID not found.",
        });
      }

      // Get current subscription (if any) - free users won't have any subscription
      const currentSubscription =
        await subscriptionHelper.findUserPlans(companyId);

      // Changing the price does not clear the end date Stripe already holds.
      if (currentSubscription?.subscriptionCancellationRequested) {
        return ErrorResponse(res, status.CONFLICT, {
          message: SUBSCRIPTION_MESSAGES.CANCELLATION_PENDING,
        });
      }

      let currentPriceId = currentSubscription?.planId;
      let currentSubscriptionId = currentSubscription?.stripeSubscriptionId;

      // Handle different scenarios based on current subscription state
      if (!currentSubscription) {
        const liveAtStripe =
          await subscriptionHelper.settleStripeSubscriptions(stripeCustomerId);

        // The local row can be missing or stale, leaving Stripe the only source.
        if (liveAtStripe?.cancel_at_period_end) {
          return ErrorResponse(res, status.CONFLICT, {
            message: SUBSCRIPTION_MESSAGES.CANCELLATION_PENDING,
          });
        }

        if (!liveAtStripe) {
          const created = await paymentGateway.createSubscription(
            stripeCustomerId,
            newPriceId,
          );

          if (!created.success) {
            return ErrorResponse(res, status.PAYMENT_REQUIRED, {
              message: created.error,
            });
          }

          return SuccessResponse(res, status.OK, {
            message: SUBSCRIPTION_MESSAGES.UPGRADED_FROM_FREE,
            data: {
              stripeCustomerId,
              subscriptionId: created.subscriptionId,
              clientSecret: created.clientSecret,
              changeType: "upgrade_from_free",
              effectiveDate: "immediate",
            },
          });
        }

        // Change the plan on the subscription Stripe already holds rather than
        // opening another one beside it.
        currentSubscriptionId = liveAtStripe.id;
        currentPriceId = liveAtStripe.items?.data?.[0]?.price?.id;
      }

      // Falling through to the create branch would bill them a second time
      // alongside the subscription this row represents.
      if (!currentSubscriptionId) {
        return ErrorResponse(res, status.CONFLICT, {
          message: SUBSCRIPTION_MESSAGES.SUBSCRIPTION_NOT_CHANGEABLE,
        });
      }

      // Check if user is trying to switch to the same plan
      if (currentPriceId === newPriceId) {
        return ErrorResponse(res, status.BAD_REQUEST, {
          message: SUBSCRIPTION_MESSAGES.ALREADY_SUBSCRIBED,
        });
      }

      //function will automatically handle both upgrade and downgrade
      const result = await paymentGateway.updateSubscription(
        currentSubscriptionId,
        newPriceId,
      );

      if (result.success === false) {
        return ErrorResponse(res, status.BAD_REQUEST, {
          message: result.error,
        });
      }

      return SuccessResponse(res, status.OK, {
        message: SUBSCRIPTION_MESSAGES.SUBSCRIPTION_CHANGED,
        data: {
          stripeCustomerId,
          subscriptionId: result.subscriptionId,
          clientSecret:
            "clientSecret" in result ? result.clientSecret : undefined,
        },
      });
    } catch (error) {
      next(error);
    }
  };
}
