import { agendaService } from "@/agenda/agenda.service";
import { JOBS } from "@/agenda/utils/job-names.constant";
/*
Install the recurring cron triggers. Idempotent per job name, so safe to run
on every worker boot. Call after agenda.start().
*/
export async function syncRecurringJobs(): Promise<void> {
  await agendaService.every("0 0 * * *", JOBS.STRIPE.PROCESS_TRANSFERS); // daily 00:00
  await agendaService.every("0 0 1 * *", JOBS.LOGS.CLEANUP_PREV_MONTH); // monthly 1st
  await agendaService.every(
    "0 9 * * *",
    JOBS.SECURITY.PASSWORD_EXPIRY_REMINDERS,
  ); // daily 09:00
  await agendaService.every("0 2 * * *", JOBS.AUDIT.RETENTION_SWEEP); // daily 02:00
}
