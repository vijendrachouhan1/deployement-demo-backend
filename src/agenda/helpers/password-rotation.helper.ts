import { Company } from "@/db/models/company";
import { User } from "@/db/models/user";
import { STATUS } from "@/enums";
import { emailService } from "@/providers/email";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";

dayjs.extend(utc);

// Reminder days before password expiry
// Send reminder email before 14, 7 and 1 day of password expiry
const REMINDER_DAYS = new Set([14, 7, 1]);

/**
 * Sends password rotation reminders to users (runs as a scheduled job).
 * @returns {Promise<void>}
 */
export const sendPasswordRotationReminders = async () => {
  const dayStart = dayjs.utc().startOf("day");

  // 1. Get all companies that have password rotation enabled
  const companies = await Company.find({
    rotatePassword: true,
    companyStatus: STATUS.ACTIVE,
  }).select("_id");

  // 2. For each company, get all users that have password rotation enabled
  for (const company of companies) {
    const users = await User.find({
      companyRef: company._id,
      hasPassword: true,
      status: STATUS.ACTIVE,
      email: { $exists: true, $ne: null },
      passwordExpiresAt: { $exists: true, $ne: null },
    }).select("email name passwordExpiresAt");

    // 3. For each user, check if password expiry reminder needs to be sent
    for (const user of users) {
      if (!user.passwordExpiresAt) {
        continue;
      }

      const expiryDayStart = dayjs(user.passwordExpiresAt).utc().startOf("day");
      const daysUntilExpiry = expiryDayStart.diff(dayStart, "day");

      if (!REMINDER_DAYS.has(daysUntilExpiry)) {
        continue;
      }

      await emailService.sendEmail({
        to: user.email,
        subject: "Password expiry reminder",
        text: `Your password will expire in ${daysUntilExpiry} day(s). Please update it to avoid login disruption.`,
      });
    }
  }
};
