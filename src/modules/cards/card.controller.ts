import { ErrorResponse, SuccessResponse } from "@/helpers/api-response";
import { cardHelper } from "@/modules/cards/helpers/card.helper";
import { CARD_MESSAGES } from "@/modules/cards/utils/card.constant";
import { TCardController } from "@/modules/cards/utils/card.types";
import httpStatus from "http-status";
import Stripe from "stripe";

export class CardController {
  listCards: TCardController["listCards"] = async (req, res, next) => {
    const user = req.user!;

    try {
      const customerId = user.stripeCustomerId;

      // No customer means no cards: the empty state, not an error.
      if (!customerId) {
        return SuccessResponse(res, httpStatus.OK, {
          message: CARD_MESSAGES.CARDS_FETCHED_SUCCESS,
          data: { cards: [], defaultPaymentMethodId: null },
        });
      }

      // Must run before listCards: Stripe throws resource_missing for a
      // deleted customer, which would skip the 404 below.
      const customerResponse = await cardHelper.getCustomer(customerId);

      if (cardHelper.isCustomerDeleted(customerResponse)) {
        return ErrorResponse(res, httpStatus.NOT_FOUND, {
          message: CARD_MESSAGES.CUSTOMER_NOT_FOUND,
        });
      }

      const cards = await cardHelper.listCards(customerId);

      const customer = customerResponse as Stripe.Customer;
      const defaultPaymentMethodId =
        cardHelper.getDefaultPaymentMethodId(customer);

      return SuccessResponse(res, httpStatus.OK, {
        message: CARD_MESSAGES.CARDS_FETCHED_SUCCESS,
        data: {
          cards: cards.data,
          defaultPaymentMethodId,
        },
      });
    } catch (error) {
      next(error);
    }
  };

  addCard: TCardController["addCard"] = async (req, res, next) => {
    const user = req.user;

    if (!user) {
      return ErrorResponse(res, httpStatus.UNAUTHORIZED, {
        message: CARD_MESSAGES.UNAUTHORIZED,
      });
    }

    try {
      const customerId = await cardHelper.resolveCustomerId(user);

      if (!customerId) {
        return ErrorResponse(res, httpStatus.INTERNAL_SERVER_ERROR, {
          message: CARD_MESSAGES.CUSTOMER_CREATE_FAILED,
        });
      }

      const setupIntent = await cardHelper.createSetupIntent(customerId);

      return SuccessResponse(res, httpStatus.OK, {
        message: CARD_MESSAGES.SETUP_INTENT_CREATED,
        data: { client_secret: setupIntent.client_secret },
      });
    } catch (error) {
      next(error);
    }
  };

  setDefaultCard: TCardController["setDefaultCard"] = async (
    req,
    res,
    next,
  ) => {
    const user = req.user;

    if (!user?.stripeCustomerId) {
      return ErrorResponse(res, httpStatus.BAD_REQUEST, {
        message: CARD_MESSAGES.STRIPE_CUSTOMER_ID_NOT_FOUND,
      });
    }

    try {
      const { paymentMethodId } = req.body;
      const customerId = user.stripeCustomerId;

      if (!paymentMethodId) {
        await cardHelper.setDefaultCard(customerId, null);
        return SuccessResponse(res, httpStatus.OK, {
          message: CARD_MESSAGES.DEFAULT_CARD_REMOVED,
        });
      }

      await cardHelper.setDefaultCard(customerId, paymentMethodId);

      return SuccessResponse(res, httpStatus.OK, {
        message: CARD_MESSAGES.DEFAULT_CARD_UPDATED,
      });
    } catch (error) {
      next(error);
    }
  };
}
