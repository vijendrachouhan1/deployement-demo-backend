import {
  chargeRefundedEvent,
  type IChargeEventOptions,
} from "@/tests/utils/stripe-samples";

/**
 * charge.refunded is the payload of choice: all three routers accept it, and
 * with no seeded transaction it is a guaranteed no-op, so a 200 proves the
 * signature passed rather than that some handler happened to succeed.
 */
export function buildEvent(options: IChargeEventOptions = {}) {
  return chargeRefundedEvent(options);
}
