import { REFUND_ELIGIBILITY_DAYS } from "@/modules/stripe-connect/utils/stripe-connect.constant";

/** Must match the isRefundEligible window getAllOrders projects. */
export function isWithinRefundWindow(orderPlacedAt: Date) {
  const daysSinceOrder = Math.floor(
    (Date.now() - new Date(orderPlacedAt).getTime()) / (1000 * 60 * 60 * 24),
  );

  return daysSinceOrder <= REFUND_ELIGIBILITY_DAYS;
}

export function emptyOrderCounts() {
  return { allPayments: 0, pending: 0, completed: 0, refunded: 0 };
}
