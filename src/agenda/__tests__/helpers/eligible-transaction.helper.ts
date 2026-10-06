import { StripeConnectTransactions } from "@/db/models/stripeConnect/transactions";
import { PAYMENT_STATUS } from "@/providers/payment/stripe/stripe.types";
import {
  seedStripeConnectTransaction,
  TOwner,
} from "@/tests/utils/payment-factories";

/**
 * A transaction the payout job will pick up: refund window closed, payment
 * settled, transfer not yet attempted (transferStatus defaults to PENDING).
 */
export function seedEligibleTransaction(
  owner: TOwner,
  overrides: Record<string, unknown> = {},
) {
  return seedStripeConnectTransaction(owner, {
    isRefundable: false,
    refunded: false,
    paymentStatus: PAYMENT_STATUS.PAID,
    ...overrides,
  });
}

export async function transferStatusOf(id: unknown) {
  return (await StripeConnectTransactions.findById(id))?.transferStatus;
}
