import mongoose from "mongoose";

export enum WEBHOOK_SOURCE {
  SUBSCRIPTION = "subscription",
  STRIPE_PAYMENT = "stripe-payment",
  STRIPE_CONNECT = "stripe-connect",
}

export enum PROCESSED_WEBHOOK_EVENT_STATUS {
  PROCESSING = "processing",
  COMPLETED = "completed",
}

export interface IProcessedWebhookEvent {
  source: WEBHOOK_SOURCE;
  eventId: string;
  eventType?: string;
  claimId: string;
  status: PROCESSED_WEBHOOK_EVENT_STATUS;
  expiresAt: Date;
}

export interface IProcessedWebhookEventDocument extends IProcessedWebhookEvent {
  _id: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const ProcessedWebhookEventSchema =
  new mongoose.Schema<IProcessedWebhookEventDocument>(
    {
      source: {
        type: String,
        enum: Object.values(WEBHOOK_SOURCE),
        required: true,
      },
      eventId: {
        type: String,
        required: true,
      },
      eventType: {
        type: String,
      },
      // A takeover stamps a new one, so the delivery it displaced can no
      // longer complete or release a row it no longer owns.
      claimId: {
        type: String,
        required: true,
      },
      status: {
        type: String,
        enum: Object.values(PROCESSED_WEBHOOK_EVENT_STATUS),
        required: true,
        default: PROCESSED_WEBHOOK_EVENT_STATUS.PROCESSING,
      },
      expiresAt: {
        type: Date,
        required: true,
      },
    },
    { timestamps: true },
  );

/*
 * Scoped by source, not by id alone: Stripe fans one event out to every
 * endpoint subscribed to it, and `charge.refunded` is handled by both the
 * payment and the connect webhook. A global unique index would let whichever
 * endpoint received it first suppress the other's work.
 */
ProcessedWebhookEventSchema.index({ source: 1, eventId: 1 }, { unique: true });

ProcessedWebhookEventSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const ProcessedWebhookEvent =
  mongoose.model<IProcessedWebhookEventDocument>(
    "ProcessedWebhookEvent",
    ProcessedWebhookEventSchema,
  );
