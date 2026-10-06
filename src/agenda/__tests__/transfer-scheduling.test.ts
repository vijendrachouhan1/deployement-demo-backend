import { StripeConnectHelper } from "@/agenda/helpers/stripe-connect.helper";
import { sleep } from "@/helpers/common";
import { StripeConnectTransactions } from "@/db/models/stripeConnect/transactions";
import { TRANSFER_STATUS } from "@/modules/stripe-connect/utils/stripe-connect.enum";
import { stripeMock } from "@/tests/mocks/stripe.mock";
import { createAdminSession, ITestSession } from "@/tests/utils/auth";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  seedEligibleTransaction,
  transferStatusOf,
} from "./helpers/eligible-transaction.helper";

vi.mock("@/helpers/common", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/helpers/common")>()),
  sleep: vi.fn(),
}));

const MINUTE_MS = 1000 * 60;
const DAY_MS = MINUTE_MS * 60 * 24;
const BATCH_SIZE = 20;
const BATCH_DELAY_MS = 1000;
// Seeding a full batch is the slow part; the wait itself is stubbed out. A
// timeout here would let processTransfers() run on into the next test.
const TEST_TIMEOUT_MS = 30_000;

describe("payout job — which rows run, and when", () => {
  beforeEach(() => {
    stripeMock.transfers.create.mockResolvedValue({ id: "tr_test" });
    vi.mocked(sleep).mockResolvedValue(undefined);
  });

  // =========================================================================
  // Batching exists to stay under Stripe's write rate limit.
  // =========================================================================

  describe("batching", () => {
    it(
      "processes a full batch with no inter-batch delay",
      async () => {
        const session = await createAdminSession();
        for (let i = 0; i < BATCH_SIZE; i++) {
          await seedEligibleTransaction(session, { amountPaid: 10 });
        }

        await StripeConnectHelper.processTransfers();

        expect(stripeMock.transfers.create).toHaveBeenCalledTimes(BATCH_SIZE);
        expect(sleep).not.toHaveBeenCalled();
      },
      TEST_TIMEOUT_MS,
    );

    it(
      "delays once and processes every row when the batch overflows",
      async () => {
        const session = await createAdminSession();
        for (let i = 0; i < BATCH_SIZE + 1; i++) {
          await seedEligibleTransaction(session, { amountPaid: 10 });
        }

        await StripeConnectHelper.processTransfers();

        expect(stripeMock.transfers.create).toHaveBeenCalledTimes(
          BATCH_SIZE + 1,
        );
        expect(sleep).toHaveBeenCalledTimes(1);
        expect(sleep).toHaveBeenCalledWith(BATCH_DELAY_MS);
      },
      TEST_TIMEOUT_MS,
    );
  });

  describe("failure isolation", () => {
    it("marks only the failing row FAILED and completes the rest", async () => {
      const session = await createAdminSession();
      const failing = await seedEligibleTransaction(session, {
        amountPaid: 10,
        stripeAccountId: "acct_broken",
      });
      const healthy = await seedEligibleTransaction(session, {
        amountPaid: 20,
        stripeAccountId: "acct_healthy",
      });

      stripeMock.transfers.create.mockImplementation(
        ({ destination }: { destination: string }) =>
          destination === "acct_broken"
            ? Promise.reject(new Error("No such destination"))
            : Promise.resolve({ id: "tr_test" }),
      );

      await StripeConnectHelper.processTransfers();

      expect(await transferStatusOf(failing._id)).toBe(TRANSFER_STATUS.FAILED);
      expect(await transferStatusOf(healthy._id)).toBe(
        TRANSFER_STATUS.SUCCEEDED,
      );
    });

    it("KNOWN BUG: a FAILED row is never retried on the next run", async () => {
      const session = await createAdminSession();
      const transaction = await seedEligibleTransaction(session, {
        amountPaid: 10,
        transferStatus: TRANSFER_STATUS.FAILED,
      });

      await StripeConnectHelper.processTransfers();

      expect(stripeMock.transfers.create).not.toHaveBeenCalled();
      expect(await transferStatusOf(transaction._id)).toBe(
        TRANSFER_STATUS.FAILED,
      );
    });
  });

  // =========================================================================
  // Refund window — an order is payable only once it can no longer be refunded.
  // The job reads the wall clock at query time, so the boundary is asserted
  // with a minute of margin rather than at millisecond precision.
  // =========================================================================

  describe("refund window", () => {
    const seedRefundableOrder = (session: ITestSession, placedAgoMs: number) =>
      seedEligibleTransaction(session, {
        amountPaid: 10,
        isRefundable: true,
        orderPlacedAt: new Date(Date.now() - placedAgoMs),
      });

    it("leaves an order just inside the 10-day window refundable and unpaid", async () => {
      const session = await createAdminSession();
      const transaction = await seedRefundableOrder(
        session,
        10 * DAY_MS - MINUTE_MS,
      );

      await StripeConnectHelper.processTransfers();

      const row = await StripeConnectTransactions.findById(transaction._id);
      expect(row?.isRefundable).toBe(true);
      expect(row?.transferStatus).toBe(TRANSFER_STATUS.PENDING);
      expect(stripeMock.transfers.create).not.toHaveBeenCalled();
    });

    it("closes the window just past 10 days and pays out in the same run", async () => {
      const session = await createAdminSession();
      const transaction = await seedRefundableOrder(
        session,
        10 * DAY_MS + MINUTE_MS,
      );

      await StripeConnectHelper.processTransfers();

      const row = await StripeConnectTransactions.findById(transaction._id);
      expect(row?.isRefundable).toBe(false);
      expect(row?.transferStatus).toBe(TRANSFER_STATUS.SUCCEEDED);
      expect(stripeMock.transfers.create).toHaveBeenCalledWith(
        expect.objectContaining({ amount: 900 }),
      );
    });

    it("ignores refunded and unpaid rows entirely", async () => {
      const session = await createAdminSession();
      await seedEligibleTransaction(session, {
        amountPaid: 10,
        refunded: true,
      });
      await seedEligibleTransaction(session, {
        amountPaid: 10,
        paymentStatus: "pending",
      });

      await StripeConnectHelper.processTransfers();

      expect(stripeMock.transfers.create).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // A PAID row can still carry no charge id, and the SDK drops an undefined
  // source_transaction — funding the transfer from the platform balance.
  // =========================================================================
  describe("unsettled charges", () => {
    it("does not transfer a paid row that has no charge id yet", async () => {
      const session = await createAdminSession();
      await seedEligibleTransaction(session, {
        amountPaid: 10,
        stripeChargeId: undefined,
      });

      await StripeConnectHelper.processTransfers();

      expect(stripeMock.transfers.create).not.toHaveBeenCalled();
    });

    it("leaves that row PENDING so it pays out once the charge lands", async () => {
      const session = await createAdminSession();
      const transaction = await seedEligibleTransaction(session, {
        amountPaid: 10,
        stripeChargeId: undefined,
      });

      await StripeConnectHelper.processTransfers();

      expect(await transferStatusOf(transaction._id)).toBe(
        TRANSFER_STATUS.PENDING,
      );
    });

    it("never sends a transfer without a source_transaction", async () => {
      const session = await createAdminSession();
      await seedEligibleTransaction(session, { amountPaid: 10 });
      await seedEligibleTransaction(session, {
        amountPaid: 10,
        stripeChargeId: undefined,
      });

      await StripeConnectHelper.processTransfers();

      for (const call of stripeMock.transfers.create.mock.calls) {
        expect(call[0].source_transaction).toBeTruthy();
      }
    });
  });
});
