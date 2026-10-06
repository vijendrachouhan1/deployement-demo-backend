import {
  ITransactionDocument,
  StripeConnectTransactions,
} from "@/db/models/stripeConnect/transactions";
import { paymentGateway } from "@/providers/payment";
import {
  PLATFORM_FEE_PERCENTAGE,
  TRANSFER_STATUS,
} from "@/modules/stripe-connect/utils/stripe-connect.enum";
import {
  CURRENCY,
  PAYMENT_STATUS,
} from "@/providers/payment/stripe/stripe.types";
import { sleep } from "@/helpers/common";

export class StripeConnectHelper {
  // Stripe API has rate limit of 25 read/write ops per sec (test mode)
  // and 100 read/write ops per sec (live mode). So update BATCH_SIZE as per requirement.
  private static readonly BATCH_SIZE = 20;
  private static readonly BATCH_DELAY_MS = 1000;
  private static readonly REFUND_PERIOD_DAYS = 10;

  public static async processTransfers() {
    try {
      console.log("Starting transfers...");
      await this.updateRefundableOrders();
      const transactions = await this.findAllEligibleTransactions();

      await this.processBatchedTransfers(transactions);

      console.log("All transfers completed.");
    } catch (error) {
      console.error("Error processing transfers:", error);
      throw error;
    }
  }

  private static async processBatchedTransfers(
    transactions: ITransactionDocument[],
  ) {
    for (let i = 0; i < transactions.length; i += this.BATCH_SIZE) {
      const batch = transactions.slice(i, i + this.BATCH_SIZE);
      await Promise.allSettled(
        batch.map((transaction) => this.processTransfer(transaction)),
      );

      // Add a delay between batches to avoid hitting rate limits
      if (i + this.BATCH_SIZE < transactions.length) {
        await sleep(this.BATCH_DELAY_MS);
      }
    }
  }

  /**
   * amountPaid is stored in DOLLARS; Stripe transfers are denominated in cents.
   * The fee is rounded and subtracted so fee + payout always equals the gross —
   * no cent is created or lost by the split.
   */
  private static splitInCents(amountPaid: number) {
    const grossInCents = Math.round(amountPaid * 100);
    const feeInCents = Math.round(
      grossInCents * PLATFORM_FEE_PERCENTAGE.PERCENTAGE,
    );

    return {
      grossInCents,
      feeInCents,
      payoutInCents: grossInCents - feeInCents,
    };
  }

  private static async processTransfer(transaction: ITransactionDocument) {
    try {
      const { payoutInCents } = this.splitInCents(transaction.amountPaid);
      const description = `${PLATFORM_FEE_PERCENTAGE.PERCENTAGE * 100}% application fee deducted.`;

      if (payoutInCents <= 0) {
        await StripeConnectTransactions.findByIdAndUpdate(transaction._id, {
          $set: {
            transferStatus: TRANSFER_STATUS.SKIPPED,
          },
        });

        console.log(
          `Transfer skipped (nothing owed) for Transaction Id: ${transaction._id}, account: ${transaction.stripeAccountId}`,
        );
        return;
      }

      // The SDK drops an undefined source_transaction instead of erroring.
      if (!transaction.stripeChargeId) {
        console.warn(
          `Transfer skipped (charge not settled) for Transaction Id: ${transaction._id}, account: ${transaction.stripeAccountId}`,
        );
        return;
      }

      await paymentGateway.createTransfer({
        amount: payoutInCents,
        currency: CURRENCY.USD,
        destination: transaction.stripeAccountId,
        description,
        source_transaction: transaction.stripeChargeId,
      });

      await StripeConnectTransactions.findByIdAndUpdate(transaction._id, {
        $set: {
          transferStatus: TRANSFER_STATUS.SUCCEEDED,
        },
      });

      console.log(
        `Transfer completed for Transaction Id: ${transaction._id}, account: ${transaction.stripeAccountId}`,
      );
    } catch (error) {
      let message = "Transfer failed";

      if (error instanceof Error) {
        message = error.message;
      }
      console.error(
        `Transfer failed for Transaction Id: ${transaction._id}, account: ${transaction.stripeAccountId}\n`,
        message,
      );

      // update the transfer status in DB if it fails
      await StripeConnectTransactions.findByIdAndUpdate(transaction._id, {
        $set: {
          transferStatus: TRANSFER_STATUS.FAILED,
        },
      });
    }
  }

  private static async updateRefundableOrders() {
    // Step 1: Find eligible orders
    const ordersToUpdate = await StripeConnectTransactions.aggregate([
      // Match documents where `isRefundable is true`.
      {
        $match: {
          isRefundable: true,
        },
      },
      // Add a new field with the difference in days
      {
        $addFields: {
          daysPassed: {
            $divide: [
              { $subtract: [new Date(), "$orderPlacedAt"] },
              1000 * 60 * 60 * 24, // Convert milliseconds to days
            ],
          },
        },
      },
      {
        $match: {
          daysPassed: { $gt: this.REFUND_PERIOD_DAYS },
        },
      },
    ]);

    // Step 2: Update the orders
    return StripeConnectTransactions.updateMany(
      { _id: { $in: ordersToUpdate.map((order) => order._id) } },
      { $set: { isRefundable: false } },
    );
  }

  // Get all the data where refund period is over.
  private static async findAllEligibleTransactions() {
    return StripeConnectTransactions.find({
      isRefundable: false,
      refunded: false,
      transferStatus: TRANSFER_STATUS.PENDING,
      paymentStatus: PAYMENT_STATUS.PAID,
      // Written by a different event than paymentStatus, so it can be absent.
      stripeChargeId: { $exists: true, $ne: null },
    });
  }
}
