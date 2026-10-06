import { StripeConnectTransactions } from "@/db/models/stripeConnect/transactions";
import { WEBHOOK_SOURCE } from "@/db/models/processed-webhook-event";
import { paymentGateway } from "@/providers/payment";
import { ErrorResponse, SuccessResponse } from "@/helpers/api-response";
import { STRIPE_WEBHOOK_EVENT } from "@/enums/payment.enum";
import { PAYMENT_STATUS } from "@/providers/payment/stripe/stripe.types";
import { NextFunction, Request, Response } from "express";
import status from "http-status";
import envConfig from "@/config/env";
import {
  claimWebhookEvent,
  completeWebhookEvent,
  DUPLICATE_EVENT_MESSAGE,
  IN_FLIGHT_EVENT_MESSAGE,
  releaseWebhookEvent,
  WEBHOOK_CLAIM,
} from "@/webhooks/helpers/webhook-idempotency.helper";

/*
 * A module function rather than a method: the router hands `handleWebhook` to
 * express unbound, so `this` is undefined inside it.
 */
async function applyEvent(event: any) {
  switch (event.type) {
    case STRIPE_WEBHOOK_EVENT.PAYMENT_INTENT_SUCCEEDED:
      {
        const paymentIntent = event.data.object;
        if (paymentIntent && paymentIntent.id) {
          await StripeConnectTransactions.findOneAndUpdate(
            {
              stripePaymentIntentId: paymentIntent.id,
            },
            {
              paymentStatus: PAYMENT_STATUS.PAID,
              orderPlacedAt: Date.now(),
            },
          );
        }
      }
      break;
    case STRIPE_WEBHOOK_EVENT.CHARGE_SUCCEEDED:
      {
        const charge = event.data.object;
        if (charge && charge.payment_intent) {
          const transactionUpdateObj: {
            stripeChargeId: string;
          } = { stripeChargeId: charge.id };

          await StripeConnectTransactions.findOneAndUpdate(
            {
              stripePaymentIntentId: charge.payment_intent,
            },
            {
              ...transactionUpdateObj,
            },
          );
        }
      }
      break;
    case STRIPE_WEBHOOK_EVENT.CHARGE_REFUNDED:
      {
        const charge = event.data.object;
        if (charge && charge.id) {
          await StripeConnectTransactions.findOneAndUpdate(
            {
              stripeChargeId: charge.id,
            },
            {
              refunded: true,
            },
          );
        }
      }
      break;
  }
}

export class StripeConnectWebhook {
  public async handleWebhook(req: Request, res: Response, next: NextFunction) {
    try {
      // Retrieve the event by verifying the signature using the raw body and secret.
      let event: any;
      try {
        event = await paymentGateway.verifyWebhookEvent(
          req.body,
          req.headers["stripe-signature"] as string,
          envConfig.STRIPE_CONNECT_WEBHOOK_SECRET,
        );
      } catch (err) {
        return ErrorResponse(res, status.BAD_REQUEST, {
          message: "Webhook signature verification failed.",
          errors: err,
        });
      }

      const claim = await claimWebhookEvent(
        WEBHOOK_SOURCE.STRIPE_CONNECT,
        event,
      );

      if (claim.outcome === WEBHOOK_CLAIM.ALREADY_PROCESSED) {
        return SuccessResponse(res, status.OK, {
          message: DUPLICATE_EVENT_MESSAGE,
        });
      }

      if (claim.outcome === WEBHOOK_CLAIM.IN_FLIGHT) {
        return ErrorResponse(res, status.CONFLICT, {
          message: IN_FLIGHT_EVENT_MESSAGE,
        });
      }

      try {
        await applyEvent(event);
        await completeWebhookEvent(
          WEBHOOK_SOURCE.STRIPE_CONNECT,
          event.id,
          claim.claimId,
        );
      } catch (error) {
        await releaseWebhookEvent(
          WEBHOOK_SOURCE.STRIPE_CONNECT,
          event.id,
          claim.claimId,
        );
        throw error;
      }

      return SuccessResponse(res, status.OK, {
        message: "Operation successfull",
      });
    } catch (error) {
      next(error);
    }
  }
}
