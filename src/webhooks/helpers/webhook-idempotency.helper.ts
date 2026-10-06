import {
  PROCESSED_WEBHOOK_EVENT_STATUS,
  ProcessedWebhookEvent,
  WEBHOOK_SOURCE,
} from "@/db/models/processed-webhook-event";
import { randomUUID } from "node:crypto";

const MONGO_DUPLICATE_KEY = 11000;

/** Stripe stops retrying after ~3 days; the record outlives that by a margin. */
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/*
 * A claim this old belongs to a delivery that died mid-flight — the process
 * was killed between the claim and the completion. Without a takeover window
 * that event answers 409 to every retry and is never applied at all.
 */
const STALE_CLAIM_MS = 15 * 60 * 1000;

export enum WEBHOOK_CLAIM {
  CLAIMED = "claimed",
  ALREADY_PROCESSED = "already-processed",
  IN_FLIGHT = "in-flight",
}

export const DUPLICATE_EVENT_MESSAGE = "Event already processed.";
export const IN_FLIGHT_EVENT_MESSAGE = "Event is already being processed.";

interface IWebhookEventIdentity {
  id?: string;
  type?: string;
}

export interface IWebhookClaim {
  outcome: WEBHOOK_CLAIM;
  /** Absent unless the claim was won. */
  claimId?: string;
}

/**
 * Insert-first-wins guard against Stripe redelivering an event whose handler
 * has already run. Call it only after the signature has been verified — an
 * unverified payload must never be able to write a row here, or an attacker
 * could pre-claim an event id and have the real delivery skipped.
 */
export async function claimWebhookEvent(
  source: WEBHOOK_SOURCE,
  event: IWebhookEventIdentity,
): Promise<IWebhookClaim> {
  const eventId = event?.id;

  if (!eventId) {
    console.warn(
      `[webhook-idempotency] A verified "${event?.type}" event on ${source} carries no id; processed without a duplicate check.`,
    );
    return { outcome: WEBHOOK_CLAIM.CLAIMED };
  }

  return insertClaim(source, eventId, event.type, true);
}

async function insertClaim(
  source: WEBHOOK_SOURCE,
  eventId: string,
  eventType: string | undefined,
  mayRetry: boolean,
): Promise<IWebhookClaim> {
  const claimId = randomUUID();

  try {
    await ProcessedWebhookEvent.create({
      source,
      eventId,
      eventType,
      claimId,
      status: PROCESSED_WEBHOOK_EVENT_STATUS.PROCESSING,
      expiresAt: new Date(Date.now() + RETENTION_MS),
    });

    return { outcome: WEBHOOK_CLAIM.CLAIMED, claimId };
  } catch (error) {
    if ((error as { code?: number }).code !== MONGO_DUPLICATE_KEY) {
      throw error;
    }

    return resolveExistingClaim(source, eventId, eventType, mayRetry);
  }
}

async function resolveExistingClaim(
  source: WEBHOOK_SOURCE,
  eventId: string,
  eventType: string | undefined,
  mayRetry: boolean,
): Promise<IWebhookClaim> {
  const existing = await ProcessedWebhookEvent.findOne({ source, eventId });

  if (existing?.status === PROCESSED_WEBHOOK_EVENT_STATUS.COMPLETED) {
    return { outcome: WEBHOOK_CLAIM.ALREADY_PROCESSED };
  }

  // Released between the failed insert and this read, so it is unclaimed
  // again; without the retry the event answers 409 until Stripe redelivers.
  if (!existing) {
    return mayRetry
      ? insertClaim(source, eventId, eventType, false)
      : { outcome: WEBHOOK_CLAIM.IN_FLIGHT };
  }

  const claimId = randomUUID();

  // `timestamps` bumps updatedAt on the takeover, so a second caller racing
  // for the same abandoned claim finds it fresh and backs off. The new
  // claimId locks out the delivery whose claim this was.
  const takenOver = await ProcessedWebhookEvent.findOneAndUpdate(
    {
      source,
      eventId,
      status: PROCESSED_WEBHOOK_EVENT_STATUS.PROCESSING,
      updatedAt: { $lt: new Date(Date.now() - STALE_CLAIM_MS) },
    },
    {
      $set: {
        claimId,
        expiresAt: new Date(Date.now() + RETENTION_MS),
      },
    },
    { new: true },
  );

  return takenOver
    ? { outcome: WEBHOOK_CLAIM.CLAIMED, claimId }
    : { outcome: WEBHOOK_CLAIM.IN_FLIGHT };
}

export async function completeWebhookEvent(
  source: WEBHOOK_SOURCE,
  eventId?: string,
  claimId?: string,
) {
  if (!eventId || !claimId) return;

  await ProcessedWebhookEvent.updateOne(
    { source, eventId, claimId },
    { $set: { status: PROCESSED_WEBHOOK_EVENT_STATUS.COMPLETED } },
  );
}

/**
 * Drops the claim so Stripe's next delivery re-runs the handler. Its own
 * failure is swallowed: it is called from a catch, and the error that got the
 * handler there is the one worth reporting.
 */
export async function releaseWebhookEvent(
  source: WEBHOOK_SOURCE,
  eventId?: string,
  claimId?: string,
) {
  if (!eventId || !claimId) return;

  try {
    await ProcessedWebhookEvent.deleteOne({ source, eventId, claimId });
  } catch (error) {
    console.error(
      `[webhook-idempotency] Could not release the claim on ${source} event ${eventId}; its retries will answer 409 until the claim goes stale:`,
      error,
    );
  }
}
