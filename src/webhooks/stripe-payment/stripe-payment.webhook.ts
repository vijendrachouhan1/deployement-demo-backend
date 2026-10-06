import { Request, Response, NextFunction } from "express";
import { StripePaymentTransactions } from "@/db/models/stripePayment/transactions";
import { WEBHOOK_SOURCE } from "@/db/models/processed-webhook-event";
import { ErrorResponse, SuccessResponse } from "@/helpers/api-response";
import { STRIPE_WEBHOOK_EVENT } from "@/enums/payment.enum";
import status from "http-status";
import { PAYMENT_STATUS } from "@/providers/payment/stripe/stripe.types";
import { paymentGateway } from "@/providers/payment";
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
    case STRIPE_WEBHOOK_EVENT.CHECKOUT_SESSION_COMPLETED:
      {
        const checkoutSession = event.data.object;
        if (checkoutSession.id && checkoutSession.payment_intent) {
          await StripePaymentTransactions.findOneAndUpdate(
            {
              stripeCheckoutSessionId: checkoutSession.id,
            },
            {
              stripePaymentIntentId: checkoutSession.payment_intent,
              paymentStatus: PAYMENT_STATUS.PAID,
              orderPlacedAt: Date.now(),
              amountPaid: checkoutSession.amount_total / 100, // convert cents to dollars
            },
          );
        }
      }
      break;
    case STRIPE_WEBHOOK_EVENT.CHARGE_UPDATED:
      {
        const charge = event.data.object;
        if (charge.payment_intent) {
          await StripePaymentTransactions.findOneAndUpdate(
            {
              stripePaymentIntentId: charge.payment_intent,
            },
            {
              stripeChargeId: charge.id,
            },
          );
        }
      }
      break;
    case STRIPE_WEBHOOK_EVENT.CHARGE_REFUNDED:
      {
        const charge = event.data.object;
        if (charge.id) {
          await StripePaymentTransactions.findOneAndUpdate(
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

export class StripePaymentWebhook {
  public async handleWebhook(req: Request, res: Response, next: NextFunction) {
    try {
      // Retrieve the event by verifying the signature using the raw body and secret.
      let event: any;
      try {
        event = await paymentGateway.verifyWebhookEvent(
          req.body,
          req.headers["stripe-signature"] as string,
          envConfig.STRIPE_PAYMENT_WEBHOOK_SECRET,
        );
      } catch (err) {
        return ErrorResponse(res, status.BAD_REQUEST, {
          message: "Webhook signature verification failed.",
          errors: err,
        });
      }

      const claim = await claimWebhookEvent(
        WEBHOOK_SOURCE.STRIPE_PAYMENT,
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
          WEBHOOK_SOURCE.STRIPE_PAYMENT,
          event.id,
          claim.claimId,
        );
      } catch (error) {
        await releaseWebhookEvent(
          WEBHOOK_SOURCE.STRIPE_PAYMENT,
          event.id,
          claim.claimId,
        );
        throw error;
      }

      return SuccessResponse(res, status.OK, {
        message: "Operation successful",
      });
    } catch (error) {
      next(error);
    }
  }
}
