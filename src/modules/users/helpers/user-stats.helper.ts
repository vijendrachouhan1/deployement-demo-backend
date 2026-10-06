import { User } from "@/db/models/user";
import { STATUS } from "@/enums";
import { ObjectId } from "@/helpers/common";
import {
  USER_ANALYTICS_DURATION,
  USER_ANALYTICS_TYPE,
} from "@/modules/users/utils/users.enum";
import dayjs from "dayjs";
import { PipelineStage } from "mongoose";
import { IUserGrowthResult } from "@/modules/users/utils/users.types";

export async function evaluateUserGrowthStats(
  filter: object = {},
  includeNewUsers: boolean,
) {
  const now = dayjs();

  const startOfThisMonth = now.startOf("month").toDate();
  const startOfLastMonth = now.subtract(1, "month").startOf("month").toDate();
  const endOfLastMonth = now.subtract(1, "month").endOf("month").toDate();

  const [totalUsers, lastMonthUserCount, thisMonthUserCount] =
    await Promise.all([
      User.countDocuments(filter),
      User.countDocuments({
        ...filter,
        createdAt: { $gte: startOfLastMonth, $lte: endOfLastMonth },
      }),
      User.countDocuments({
        ...filter,
        createdAt: { $gte: startOfThisMonth },
      }),
    ]);

  const percentageGrowth = calculatePercentageChange(
    thisMonthUserCount,
    lastMonthUserCount,
  );

  const result: IUserGrowthResult = {
    totalUsers,
    percentageGrowth,
  };

  if (includeNewUsers) {
    result.newSignUpsThisMonth = thisMonthUserCount;
  }

  return result;
}

export async function evaluateUserAnalytics(
  type: USER_ANALYTICS_TYPE,
  duration: USER_ANALYTICS_DURATION,
  year?: number,
) {
  const currentYear = year || dayjs().year();
  const lastYear = currentYear - 1;

  // Map duration → Mongo group format
  const groupFormat: Record<USER_ANALYTICS_DURATION, any> = {
    [USER_ANALYTICS_DURATION.DAILY]: {
      $dateToString: { format: "%Y-%m-%d", date: "$createdAt" },
    },
    [USER_ANALYTICS_DURATION.WEEKLY]: {
      $dateToString: { format: "%Y-%U", date: "$createdAt" },
    },
    [USER_ANALYTICS_DURATION.MONTHLY]: {
      $dateToString: { format: "%Y-%m", date: "$createdAt" },
    },
  };

  const groupBy = groupFormat[duration];

  const buildMatch = (y: number) => ({
    createdAt: {
      $gte: dayjs().year(y).startOf("year").toDate(),
      $lte: dayjs().year(y).endOf("year").toDate(),
    },
  });

  let pipeline: PipelineStage[] = [];

  switch (type) {
    case USER_ANALYTICS_TYPE.TOTAL:
    case USER_ANALYTICS_TYPE.NEW:
      pipeline = [
        { $group: { _id: groupBy, count: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ];
      break;
    case USER_ANALYTICS_TYPE.ACTIVE:
      pipeline = [
        { $match: { status: STATUS.ACTIVE } },
        { $group: { _id: groupBy, count: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ];
      break;
  }

  const [thisYearData, lastYearData] = await Promise.all([
    User.aggregate([{ $match: buildMatch(currentYear) }, ...pipeline]),
    User.aggregate([{ $match: buildMatch(lastYear) }, ...pipeline]),
  ]);

  const formatKey = (dateStr: string) => {
    if (duration === USER_ANALYTICS_DURATION.WEEKLY)
      return `W${dateStr.split("-")[1]}`;

    if (duration === USER_ANALYTICS_DURATION.MONTHLY) {
      const [year, month] = dateStr.split("-").map(Number);
      return dayjs()
        .year(year)
        .month(month - 1)
        .format("MMM");
    }

    const d = dayjs(dateStr);

    if (duration === USER_ANALYTICS_DURATION.DAILY) return d.format("DD MMM");

    return d.format("MMM");
  };

  const mapData = (arr: any[]) =>
    arr.reduce(
      (acc, cur) => {
        acc[formatKey(cur._id)] = cur.count;
        return acc;
      },
      {} as Record<string, number>,
    );

  const thisMap = mapData(thisYearData);
  const lastMap = mapData(lastYearData);

  // Generate only past months or weeks up to now
  let allKeys: string[] = [];
  if (duration === USER_ANALYTICS_DURATION.MONTHLY) {
    const currentMonth = dayjs().month();
    for (let m = 0; m <= currentMonth; m++) {
      allKeys.push(dayjs().month(m).format("MMM"));
    }
  } else if (duration === USER_ANALYTICS_DURATION.WEEKLY) {
    const currentWeek = dayjs().isoWeek();
    for (let w = 1; w <= currentWeek; w++) {
      allKeys.push(`W${w}`);
    }
  } else {
    allKeys = Array.from(
      new Set([...Object.keys(thisMap), ...Object.keys(lastMap)]),
    );
    allKeys.sort();
  }

  return allKeys.map((key) => ({
    key,
    thisYear: thisMap[key] || 0,
    lastYear: lastMap[key] || 0,
  }));
}

export async function evaluateUserDashboardStats(companyRef: string) {
  const now = dayjs();

  const ranges = {
    last7Days: now.subtract(7, "day").toDate(),
    last14Days: now.subtract(14, "day").toDate(),
    last30DaysTs: now.subtract(30, "day").valueOf(),
    last60DaysTs: now.subtract(60, "day").valueOf(),
  };

  const [result] = await User.aggregate([
    { $match: { companyRef: ObjectId(companyRef) } },

    {
      $facet: {
        totalUsers: [{ $count: "count" }],

        usersLast7Days: [
          { $match: { createdAt: { $gte: ranges.last7Days } } },
          { $count: "count" },
        ],

        usersPrevious7Days: [
          {
            $match: {
              createdAt: {
                $gte: ranges.last14Days,
                $lt: ranges.last7Days,
              },
            },
          },
          { $count: "count" },
        ],

        activeUsers: [
          {
            $match: {
              status: STATUS.ACTIVE,
              lastActivity: { $gte: ranges.last30DaysTs },
            },
          },
          { $count: "count" },
        ],

        previousActiveUsers: [
          {
            $match: {
              status: STATUS.ACTIVE,
              lastActivity: {
                $gte: ranges.last60DaysTs,
                $lt: ranges.last30DaysTs,
              },
            },
          },
          { $count: "count" },
        ],

        churnedUsers: [
          {
            $match: {
              $or: [
                { status: { $ne: STATUS.ACTIVE } },
                { lastActivity: { $lt: ranges.last30DaysTs } },
                {
                  lastActivity: { $exists: false },
                  createdAt: { $lt: dayjs(ranges.last30DaysTs).toDate() },
                },
              ],
            },
          },
          { $count: "count" },
        ],

        previousChurnedUsers: [
          {
            $match: {
              $or: [
                { status: { $ne: STATUS.ACTIVE } },
                { lastActivity: { $lt: ranges.last60DaysTs } },
                {
                  lastActivity: { $exists: false },
                  createdAt: { $lt: dayjs(ranges.last60DaysTs).toDate() },
                },
              ],
            },
          },
          { $count: "count" },
        ],
      },
    },
  ]);

  const getCount = (key: keyof typeof result) => result[key]?.[0]?.count ?? 0;

  const totals = {
    totalUsers: getCount("totalUsers"),
    usersLast7Days: getCount("usersLast7Days"),
    usersPrevious7Days: getCount("usersPrevious7Days"),
    activeUsers: getCount("activeUsers"),
    previousActiveUsers: getCount("previousActiveUsers"),
    churnedUsers: getCount("churnedUsers"),
    previousChurnedUsers: getCount("previousChurnedUsers"),
  };

  return {
    all: {
      totalUsers: totals.totalUsers,
      percentageGrowth: calculatePercentageChange(
        totals.totalUsers,
        totals.totalUsers - totals.usersLast7Days,
      ),
    },

    active: {
      totalUsers: totals.activeUsers,
      percentageGrowth: calculatePercentageChange(
        totals.activeUsers,
        totals.previousActiveUsers,
      ),
    },

    churned: {
      totalUsers: totals.churnedUsers,
      percentageGrowth: calculatePercentageChange(
        totals.churnedUsers,
        totals.previousChurnedUsers,
      ),
    },

    new: {
      totalUsers: totals.usersLast7Days,
      percentageGrowth: calculatePercentageChange(
        totals.usersLast7Days,
        totals.usersPrevious7Days,
      ),
    },
  };
}

function calculatePercentageChange(current: number, previous: number): number {
  if (previous === 0) {
    return current > 0 ? 100 : 0;
  }
  return parseFloat((((current - previous) / previous) * 100).toFixed(2));
}
