import envConfig from "@/config/env";
import { Company } from "@/db/models/company";
import { WEBHOOK_SOURCE } from "@/db/models/processed-webhook-event";
import { Subscription } from "@/db/models/subscription";
import { IUserDocument, User } from "@/db/models/user";
import { ErrorResponse, SuccessResponse } from "@/helpers/api-response";
import { STRIPE_WEBHOOK_EVENT } from "@/enums/payment.enum";
import { STRIPE_SUBSCRIPTION_STATUS } from "@/modules/subscription/utils/subscription.enum";
import { paymentGateway } from "@/providers/payment";
import {
  claimWebhookEvent,
  completeWebhookEvent,
  DUPLICATE_EVENT_MESSAGE,
  IN_FLIGHT_EVENT_MESSAGE,
  releaseWebhookEvent,
  WEBHOOK_CLAIM,
} from "@/webhooks/helpers/webhook-idempotency.helper";
import {
  sendNewSubscriptionEmail,
  sendSubscriptionCancelledEmail,
  sendSubscriptionRenewalFailedEmail,
} from "@/webhooks/subscription/subscription-email.helper";
import { mapStripeSubscriptionStatus } from "@/webhooks/subscription/subscription-status.helper";
import { NextFunction, Request, Response } from "express";
import mongoose from "mongoose";
import status from "http-status";

const enum SUBSCRIPTION_PLAN {
  UNNAMED_PLAN = "Unnamed Plan",
}

/*
 * A module function rather than a method: the router hands `handleWebhook` to
 * express unbound, so `this` is undefined inside it.
 */
async function applyEvent(event: any, user: IUserDocument) {
  switch (event.type) {
    case STRIPE_WEBHOOK_EVENT.CUSTOMER_SUBSCRIPTION_UPDATED: {
      const subscriptionEvent = event.data.object;

      // Not an early return: a subscription scheduled to cancel still moves
      // through statuses — past_due above all — and skipping the write here
      // leaves the local row claiming it is healthy.
      const cancelAtPeriodEnd =
        subscriptionEvent?.cancel_at_period_end === true;

      const localStatus = mapStripeSubscriptionStatus(subscriptionEvent.status);

      if (!localStatus) {
        console.warn(
          `[subscription.webhook] Unmapped Stripe status "${subscriptionEvent.status}" for subscription ${subscriptionEvent.id}; no write performed.`,
        );
        break;
      }

      const primaryItem = subscriptionEvent?.items?.data?.[0];

      // Stripe sends a null top-level plan once a subscription has
      // more than one item, so every field falls back to the item.
      const planFields = {
        price: subscriptionEvent.plan?.amount ?? primaryItem?.plan?.amount,
        planId: subscriptionEvent.plan?.id ?? primaryItem?.plan?.id,
        planName:
          subscriptionEvent.plan?.nickname ||
          primaryItem?.plan?.nickname ||
          SUBSCRIPTION_PLAN.UNNAMED_PLAN,
        currentPeriodStarts: primaryItem?.current_period_start,
        currentPeriodEnds: primaryItem?.current_period_end,
        productId: primaryItem?.plan?.product,
        period: primaryItem?.plan?.interval,
        subscriptionCancellationRequested: cancelAtPeriodEnd,
      };

      const existingSubscription = await Subscription.findOne({
        stripeSubscriptionId: subscriptionEvent.id,
      });

      let response;
      if (existingSubscription) {
        await Subscription.updateOne(
          { stripeSubscriptionId: subscriptionEvent.id },
          { $set: { ...planFields, status: localStatus } },
        );
        response = existingSubscription;
      } else if (localStatus === STRIPE_SUBSCRIPTION_STATUS.ACTIVE) {
        // companyRef is optional on User but required on
        // Subscription. Creating would throw, and a retry of an event
        // that can never succeed is a loop.
        if (!user.companyRef) {
          console.warn(
            `[subscription.webhook] User ${user._id} belongs to no company; not recording subscription ${subscriptionEvent.id}.`,
          );
          break;
        }

        try {
          response = await Subscription.create({
            userRef: user._id,
            companyRef: user.companyRef,
            stripeCustomerId: subscriptionEvent.customer,
            stripeSubscriptionId: subscriptionEvent.id,
            status: localStatus,
            ...planFields,
          });
        } catch (error) {
          // An event the schema rejects does not improve on
          // redelivery, so asking Stripe to retry only loops it.
          // Anything else — a step-down, a write conflict — does
          // improve, and swallowing it drops the subscription for
          // good, since Stripe only retries on a non-2xx.
          if (!(error instanceof mongoose.Error.ValidationError)) {
            throw error;
          }

          console.warn(
            `[subscription.webhook] Could not record subscription ${subscriptionEvent.id}:`,
            error,
          );
          break;
        }
      } else {
        // An inactive row for an untracked subscription would invent
        // history it never had.
        console.warn(
          `[subscription.webhook] Ignoring "${subscriptionEvent.status}" for untracked subscription ${subscriptionEvent.id}.`,
        );
        break;
      }

      if (localStatus === STRIPE_SUBSCRIPTION_STATUS.ACTIVE) {
        // The row's companyRef, not the user's: the user is looked up
        // by Stripe customer id and may have since changed company.
        await Company.updateOne(
          { _id: response.companyRef },
          { $set: { subscriptionRef: response._id } },
        );
      }

      // The cancellation endpoint may already have set the local flag.
      if (cancelAtPeriodEnd) {
        if (event.data.previous_attributes?.cancel_at_period_end === false) {
          await sendSubscriptionCancelledEmail({
            email: user.email,
            fullName: user.fullName,
          });
        }
      } else if (localStatus === STRIPE_SUBSCRIPTION_STATUS.ACTIVE) {
        await sendNewSubscriptionEmail({
          email: user.email,
          fullName: user.fullName,
        });
      }

      break;
    }
    case STRIPE_WEBHOOK_EVENT.CUSTOMER_SUBSCRIPTION_DELETED: {
      // Reached without cancel_at_period_end too: dunning exhaustion,
      // a dashboard delete, plain churn.
      await Subscription.updateOne(
        { stripeSubscriptionId: event.data.object.id },
        { $set: { status: STRIPE_SUBSCRIPTION_STATUS.INACTIVE } },
      );

      // Delete events routinely arrive for subscriptions the company
      // already moved off, so the clear below is scoped to this row —
      // otherwise it wipes a pointer to a live one.
      const deletedSubscription = await Subscription.findOne({
        stripeSubscriptionId: event.data.object.id,
      });

      if (deletedSubscription) {
        await Company.updateOne(
          {
            _id: deletedSubscription.companyRef,
            subscriptionRef: deletedSubscription._id,
          },
          {
            $set: {
              subscriptionRef: null,
            },
          },
        );
      }
      break;
    }
    case STRIPE_WEBHOOK_EVENT.INVOICE_PAYMENT_FAILED: {
      // Basil removed these top-level fields; the installed SDK uses the older format.
      const invoiceEvent = event.data.object;
      const invoice =
        "subscription" in invoiceEvent && "payment_intent" in invoiceEvent
          ? invoiceEvent
          : await paymentGateway.retrieveInvoice(invoiceEvent.id);
      const paymentIntentId = invoice.payment_intent;
      if (invoice.billing_reason != "subscription_create") {
        // A one-off invoice carries no subscription, and Mongoose drops an
        // undefined key entirely — leaving {} to match an arbitrary row.
        if (invoice.subscription && user.companyRef) {
          await Subscription.updateOne(
            {
              stripeSubscriptionId: invoice.subscription,
              companyRef: user.companyRef,
            },
            { $set: { status: STRIPE_SUBSCRIPTION_STATUS.PAST_DUE } },
          );
        }
        if (paymentIntentId) {
          await sendSubscriptionRenewalFailedEmail({
            email: user.email,
            fullName: user.fullName,
          });
        }
      }
      break;
    }
  }
}

export class SubscriptionWebhook {
  public async handleWebhook(req: Request, res: Response, next: NextFunction) {
    try {
      let event: any;

      try {
        event = await paymentGateway.verifyWebhookEvent(
          req.body,
          req.headers["stripe-signature"] as string,
          envConfig.STRIPE_WEBHOOK_SECRET,
        );
      } catch (err) {
        return ErrorResponse(res, status.BAD_REQUEST, {
          message: "Webhook signature verification failed.",
          errors: err,
        });
      }

      const claim = await claimWebhookEvent(WEBHOOK_SOURCE.SUBSCRIPTION, event);

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
        const user = await User.findOne({
          stripeCustomerId: event.data.object.customer,
        });

        if (user) {
          await applyEvent(event, user);
        } else {
          // Acknowledged so Stripe stops retrying, but a real event for a
          // customer this app cannot resolve is not a success.
          console.warn(
            `[subscription.webhook] No user for Stripe customer ${event.data.object.customer}; "${event.type}" ignored.`,
          );
        }

        await completeWebhookEvent(
          WEBHOOK_SOURCE.SUBSCRIPTION,
          event.id,
          claim.claimId,
        );
      } catch (error) {
        await releaseWebhookEvent(
          WEBHOOK_SOURCE.SUBSCRIPTION,
          event.id,
          claim.claimId,
        );
        throw error;
      }

      return SuccessResponse(res, status.OK, {
        message: "Subscription created successfully.",
      });
    } catch (error) {
      next(error);
    }
  }
}
