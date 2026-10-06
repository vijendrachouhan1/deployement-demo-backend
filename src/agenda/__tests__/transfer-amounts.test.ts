import { StripeConnectHelper } from "@/agenda/helpers/stripe-connect.helper";
import { TRANSFER_STATUS } from "@/modules/stripe-connect/utils/stripe-connect.enum";
import { stripeMock } from "@/tests/mocks/stripe.mock";
import { createAdminSession } from "@/tests/utils/auth";
import { beforeEach, describe, expect, it } from "vitest";

import {
  seedEligibleTransaction,
  transferStatusOf,
} from "./helpers/eligible-transaction.helper";

describe("payout job — transfer amounts", () => {
  beforeEach(() => {
    stripeMock.transfers.create.mockResolvedValue({ id: "tr_test" });
  });

  // =========================================================================
  // Fee math — the platform takes 10%, the vendor gets the rest, in cents.
  // amountPaid is stored in dollars, so every payout crosses a unit boundary.
  // =========================================================================

  describe("fee math", () => {
    it("transfers 989 cents for a $10.99 sale", async () => {
      const session = await createAdminSession();
      await seedEligibleTransaction(session, { amountPaid: 10.99 });

      await StripeConnectHelper.processTransfers();

      expect(stripeMock.transfers.create).toHaveBeenCalledTimes(1);
      expect(stripeMock.transfers.create).toHaveBeenCalledWith(
        expect.objectContaining({ amount: 989 }),
      );
    });

    it.each([
      [0.99, 89],
      [10.99, 989],
      [19.95, 1795],
      [33.33, 3000],
      [50, 4500],
      [100, 9000],
    ])("pays out %d dollars as %d cents", async (amountPaid, expected) => {
      const session = await createAdminSession();
      await seedEligibleTransaction(session, { amountPaid });

      await StripeConnectHelper.processTransfers();

      expect(stripeMock.transfers.create).toHaveBeenCalledWith(
        expect.objectContaining({ amount: expected }),
      );
    });

    it("never lets the fee and the payout disagree with the gross", async () => {
      const session = await createAdminSession();
      await seedEligibleTransaction(session, { amountPaid: 33.33 });

      await StripeConnectHelper.processTransfers();

      const [{ amount }] = stripeMock.transfers.create.mock.calls[0];
      expect(3333 - amount).toBe(333);
    });

    it("sends the transfer in usd against the settled charge", async () => {
      const session = await createAdminSession();
      await seedEligibleTransaction(session, {
        amountPaid: 50,
        stripeAccountId: "acct_vendor_1",
        stripeChargeId: "ch_settled_1",
      });

      await StripeConnectHelper.processTransfers();

      expect(stripeMock.transfers.create).toHaveBeenCalledWith({
        amount: 4500,
        currency: "usd",
        destination: "acct_vendor_1",
        description: "10% application fee deducted.",
        source_transaction: "ch_settled_1",
      });
    });
  });

  // =========================================================================
  // Zero-value payouts must not be recorded as money that moved.
  // =========================================================================

  describe("zero-value payouts", () => {
    it("marks SKIPPED and calls Stripe not at all when amountPaid is 0", async () => {
      const session = await createAdminSession();
      const transaction = await seedEligibleTransaction(session, {
        amountPaid: 0,
      });

      await StripeConnectHelper.processTransfers();

      expect(stripeMock.transfers.create).not.toHaveBeenCalled();
      expect(await transferStatusOf(transaction._id)).toBe(
        TRANSFER_STATUS.SKIPPED,
      );
    });

    it("marks SKIPPED when the payout rounds down to zero cents", async () => {
      const session = await createAdminSession();
      const transaction = await seedEligibleTransaction(session, {
        amountPaid: 0.004,
      });

      await StripeConnectHelper.processTransfers();

      expect(stripeMock.transfers.create).not.toHaveBeenCalled();
      expect(await transferStatusOf(transaction._id)).toBe(
        TRANSFER_STATUS.SKIPPED,
      );
    });

    it("still transfers a sub-cent-fee sale that rounds to a payout", async () => {
      const session = await createAdminSession();
      const transaction = await seedEligibleTransaction(session, {
        amountPaid: 0.05,
      });

      await StripeConnectHelper.processTransfers();

      expect(stripeMock.transfers.create).toHaveBeenCalledWith(
        expect.objectContaining({ amount: 4 }),
      );
      expect(await transferStatusOf(transaction._id)).toBe(
        TRANSFER_STATUS.SUCCEEDED,
      );
    });
  });
});
