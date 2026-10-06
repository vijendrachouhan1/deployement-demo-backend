import dayjs from "dayjs";
import { DURATION } from "@/modules/referrals/utils/referrals.enum";

export function fillTimeSeries(
  start: dayjs.Dayjs,
  timeframe: DURATION,
  data: { _id: { year: number; month: number; week: number }; value: number }[],
) {
  const lookup = new Map<string, number>();

  data.forEach((item) => {
    if (timeframe === DURATION.MONTHLY) {
      lookup.set(`${item._id.year}-${item._id.month}`, item.value);
    } else if (timeframe === DURATION.YEARLY) {
      lookup.set(`${item._id.year}`, item.value);
    } else {
      lookup.set(`${item._id.year}-${item._id.week}`, item.value);
    }
  });

  if (timeframe === DURATION.MONTHLY) {
    const months: dayjs.Dayjs[] = [];
    for (let i = 0; i < 12; i++) {
      months.push(start.add(i, "month"));
    }
    return months.map((d) => ({
      label: d.format("MMM"),
      value: lookup.get(`${d.year()}-${d.month() + 1}`) ?? 0,
    }));
  }

  if (timeframe === DURATION.YEARLY) {
    const years: number[] = [];
    for (let i = 0; i < 5; i++) {
      years.push(start.year() + i);
    }
    return years.map((y) => ({
      label: String(y),
      value: lookup.get(`${y}`) ?? 0,
    }));
  }

  if (timeframe === DURATION.WEEKLY) {
    const weeks: dayjs.Dayjs[] = [];
    for (let i = 0; i < 8; i++) {
      weeks.push(start.add(i, "week"));
    }
    return weeks.map((d, idx) => {
      const weekNum = d.isoWeek(); // ISO week number
      return {
        label: `Week ${idx + 1}`,
        value: lookup.get(`${d.year()}-${weekNum}`) ?? 0,
      };
    });
  }
}

export function getChartDateRange(timeframe: DURATION) {
  const endDate = dayjs();
  let startDate = dayjs();

  switch (timeframe) {
    case DURATION.WEEKLY:
      // last 12 weeks (current week + 11 back)
      startDate = startDate.subtract(7 * 11, "day");
      break;

    case DURATION.YEARLY:
      // last 4 years, starting Jan 1
      startDate = startDate.subtract(4, "year").month(0).date(1);
      break;

    case DURATION.MONTHLY:
    default:
      // last 12 months, starting from 1st of the month
      startDate = startDate.subtract(11, "month").date(1);
      break;
  }

  startDate = startDate.startOf("day");

  return {
    startDate,
    endDate,
  };
}

export function getTimeGrouping(timeframe: DURATION) {
  switch (timeframe) {
    case DURATION.WEEKLY:
      return {
        week: { $week: "$createdAt" },
        year: { $year: "$createdAt" },
      };

    case DURATION.YEARLY:
      return {
        year: { $year: "$createdAt" },
      };

    case DURATION.MONTHLY:
    default:
      return {
        month: { $month: "$createdAt" },
        year: { $year: "$createdAt" },
      };
  }
}

export function getSortOptions(timeframe: DURATION) {
  let sortOptions: Record<string, 1 | -1>;

  switch (timeframe) {
    case DURATION.WEEKLY:
      sortOptions = { "_id.year": 1, "_id.week": 1 };
      break;
    case DURATION.YEARLY:
      sortOptions = { "_id.year": 1 };
      break;
    case DURATION.MONTHLY:
    default:
      sortOptions = { "_id.year": 1, "_id.month": 1 };
      break;
  }
  return sortOptions;
}
