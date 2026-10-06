import status from "http-status";
import { subscriptionHelper } from "@/modules/subscription/helpers/subscription.helper";
import { SuccessResponse } from "@/helpers/api-response";
import { TSubscriptionController } from "@/modules/subscription/utils/subscription.types";
import { SUBSCRIPTION_MESSAGES } from "@/modules/subscription/utils/subscription.constant";

/**
 * SubscriptionSuperAdminController class for handling super admin subscription-related HTTP requests
 */
export class SubscriptionSuperAdminController {
  /**
   * Get all subscribed users
   */
  getAllSubscribedUsers: TSubscriptionController["getAllSubscribedUsers"] =
    async (req, res, next) => {
      try {
        const query = req.query;

        const data = await subscriptionHelper.findAll(query);

        return SuccessResponse(res, status.OK, {
          message: SUBSCRIPTION_MESSAGES.USERS_FETCHED_SUCCESS,
          data,
        });
      } catch (error) {
        next(error);
      }
    };
}
