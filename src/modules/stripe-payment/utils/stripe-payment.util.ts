import { REFUND_PERIOD } from "@/modules/stripe-payment/utils/stripe-payment.constant";

/** Must match the isRefundEligible window getAllOrders projects. */
export function isWithinRefundWindow(orderPlacedAt: Date) {
  const daysSinceOrder = Math.floor(
    (Date.now() - new Date(orderPlacedAt).getTime()) / (1000 * 60 * 60 * 24),
  );

  return daysSinceOrder <= REFUND_PERIOD.ELIGIBILITY_DAYS;
}
