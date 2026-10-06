import { ErrorLogs } from "@/db/models/errorLogs";

export async function deletePreviousMonthEntries() {
  // Get the first day of the current month
  const startOfCurrentMonth = new Date();
  startOfCurrentMonth.setUTCDate(1);
  startOfCurrentMonth.setUTCHours(0, 0, 0, 0);

  // Delete documents where `createdAt` is before the first day of the current month.
  const result = await ErrorLogs.deleteMany({
    createdAt: { $lt: startOfCurrentMonth },
  });
  console.log(`${result.deletedCount} entries from previous months deleted.`);
}
