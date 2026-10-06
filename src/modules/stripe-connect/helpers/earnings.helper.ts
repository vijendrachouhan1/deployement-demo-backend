import { StripeConnectTransactions } from "@/db/models/stripeConnect/transactions";
import {
  DURATION,
  PLATFORM_FEE_PERCENTAGE,
  TRANSFER_STATUS,
} from "@/modules/stripe-connect/utils/stripe-connect.enum";
import { PAYMENT_STATUS } from "@/providers/payment/stripe/stripe.types";
import dayjs from "dayjs";
import advancedFormat from "dayjs/plugin/advancedFormat.js";
import isoWeek from "dayjs/plugin/isoWeek.js";
import weekday from "dayjs/plugin/weekday.js";

dayjs.extend(isoWeek);
dayjs.extend(weekday);
dayjs.extend(advancedFormat);

/**
 * Calculate net amount after platform fee
 */
export function calculateNetAmount(grossAmount: number): number {
  if (grossAmount <= 0) return grossAmount;

  const netAmount = grossAmount * (1 - PLATFORM_FEE_PERCENTAGE.PERCENTAGE);

  return Number.isInteger(netAmount)
    ? netAmount // Return the number as-is if it's an integer
    : Math.round(netAmount * 10) / 10; // If it's not an integer, round it to one decimal place
}

/**
 * Get earning details for a vendor
 */
export async function getEarningDetails(stripeAccountId: string) {
  const aggregationResult = await StripeConnectTransactions.aggregate([
    {
      $match: {
        stripeAccountId,
      },
    },
    {
      $group: {
        _id: null,

        // Total earning: all paid & not refunded
        totalEarning: {
          $sum: {
            $multiply: [
              {
                $cond: [
                  {
                    $and: [
                      { $eq: ["$refunded", false] },
                      { $eq: ["$paymentStatus", PAYMENT_STATUS.PAID] },
                    ],
                  },
                  {
                    $multiply: [
                      "$amountPaid",
                      1 - PLATFORM_FEE_PERCENTAGE.PERCENTAGE,
                    ],
                  },
                  0,
                ],
              },
              1,
            ],
          },
        },

        // Total transferred: only SUCCEEDED transfers
        totalTransferred: {
          $sum: {
            $cond: [
              { $eq: ["$transferStatus", TRANSFER_STATUS.SUCCEEDED] },
              "$amountPaid",
              0,
            ],
          },
        },

        // Total pending: PENDING or FAILED, not refunded, paid
        totalPending: {
          $sum: {
            $cond: [
              {
                $and: [
                  {
                    $in: [
                      "$transferStatus",
                      [TRANSFER_STATUS.PENDING, TRANSFER_STATUS.FAILED],
                    ],
                  },
                  { $eq: ["$refunded", false] },
                  { $eq: ["$paymentStatus", PAYMENT_STATUS.PAID] },
                ],
              },
              "$amountPaid",
              0,
            ],
          },
        },
      },
    },
  ]);

  const result = aggregationResult[0] || {
    totalEarning: 0,
    totalTransferred: 0,
    totalPending: 0,
  };

  return {
    totalEarning: result.totalEarning,
    totalTransferred: result.totalTransferred,
    totalPending: result.totalPending,
  };
}

/**
 * Get earnings by type (monthly, yearly, or weekly)
 */
export async function getEarningsByType(
  stripeAccountId: string,
  type: DURATION,
) {
  const now = dayjs();

  const matchStage: Record<string, unknown> = {
    stripeAccountId,
    refunded: false,
  };

  let groupStage: Record<string, any>;
  let sortOptions: Record<string, 1 | -1>;
  let start: dayjs.Dayjs;

  switch (type) {
    case DURATION.MONTHLY:
      start = now.subtract(11, "month").startOf("month"); // last 12 months
      matchStage.orderPlacedAt = { $gte: start.toDate(), $lte: now.toDate() };
      groupStage = {
        _id: {
          month: { $month: "$orderPlacedAt" },
          year: { $year: "$orderPlacedAt" },
        },
        totalEarnings: { $sum: "$amountPaid" },
      };
      sortOptions = { "_id.year": 1, "_id.month": 1 };
      break;

    case DURATION.YEARLY:
      start = now.subtract(4, "year").startOf("year"); // last 5 years
      matchStage.orderPlacedAt = { $gte: start.toDate(), $lte: now.toDate() };
      groupStage = {
        _id: { year: { $year: "$orderPlacedAt" } },
        totalEarnings: { $sum: "$amountPaid" },
      };
      sortOptions = { "_id.year": 1 };
      break;

    case DURATION.WEEKLY:
      start = now.subtract(7, "week").startOf("week"); // last 8 weeks
      matchStage.orderPlacedAt = { $gte: start.toDate(), $lte: now.toDate() };
      groupStage = {
        _id: {
          week: { $week: "$orderPlacedAt" },
          year: { $year: "$orderPlacedAt" },
        },
        totalEarnings: { $sum: "$amountPaid" },
      };
      sortOptions = { "_id.year": 1, "_id.week": 1 };
      break;

    default:
      throw new Error(`Invalid duration type: ${type}`);
  }

  const earnings = await StripeConnectTransactions.aggregate([
    { $match: matchStage },
    { $group: groupStage },
    { $sort: sortOptions },
  ]);

  // Build lookup
  const lookup = new Map<string, number>();
  earnings.forEach((item) => {
    if (type === DURATION.MONTHLY) {
      lookup.set(
        `${item._id.year}-${item._id.month}`,
        calculateNetAmount(item.totalEarnings),
      );
    } else if (type === DURATION.YEARLY) {
      lookup.set(`${item._id.year}`, calculateNetAmount(item.totalEarnings));
    } else {
      lookup.set(
        `${item._id.year}-${item._id.week}`,
        calculateNetAmount(item.totalEarnings),
      );
    }
  });

  // Fill missing slots with null
  if (type === DURATION.MONTHLY) {
    const months: dayjs.Dayjs[] = [];
    for (let i = 0; i < 12; i++) {
      months.push(start.add(i, "month"));
    }
    return months.map((d) => ({
      month: d.format("MMM"),
      earnings: lookup.get(`${d.year()}-${d.month() + 1}`) ?? 0,
    }));
  }

  if (type === DURATION.YEARLY) {
    const years: number[] = [];
    for (let i = 0; i < 5; i++) {
      years.push(start.year() + i);
    }
    return years.map((y) => ({
      month: String(y),
      earnings: lookup.get(`${y}`) ?? 0,
    }));
  }

  if (type === DURATION.WEEKLY) {
    const weeks: dayjs.Dayjs[] = [];
    for (let i = 0; i < 8; i++) {
      weeks.push(start.add(i, "week"));
    }
    return weeks.map((d, idx) => {
      const weekNum = d.isoWeek(); // ISO week number
      return {
        month: `Week ${idx + 1}`,
        earnings: lookup.get(`${d.year()}-${weekNum}`) ?? 0,
      };
    });
  }
}
