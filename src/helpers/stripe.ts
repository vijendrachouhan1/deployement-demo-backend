import { paymentGateway } from "@/providers/payment";

/**
 * `price * 100` is not safe on a float: 19.99 * 100 is 1998.9999999999998, and
 * Stripe rejects a non-integer amount outright — so every product priced at a
 * value the binary representation cannot hold exactly failed to check out.
 */
export function toCents(amountInDollars: number): number {
  return Math.round(amountInDollars * 100);
}

/**
 * The customer is created at Stripe before the row that stores its id is
 * claimed, so the loser of that race holds one nothing will ever reference.
 * Best-effort: failing the purchase over the cleanup would be worse.
 */
export async function discardUnusedStripeCustomer(
  createdId: string,
  storedId?: string | null,
) {
  if (!storedId || createdId === storedId) return;

  try {
    await paymentGateway.deleteCustomer(createdId);
  } catch (error) {
    console.error(
      `[stripe] Could not delete orphaned Stripe customer ${createdId}:`,
      error,
    );
  }
}
