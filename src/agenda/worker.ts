import express from "express";
import http from "http";
import mongoose from "mongoose";
import type { Job } from "agenda";
import envConfig from "@/config/env";
import { connectDB, disconnectDB } from "@/db";
import { agendaService } from "@/agenda/agenda.service";
import { registerAllJobs } from "@/agenda/register";
import { syncRecurringJobs } from "@/agenda/schedule";

/*
Long-running background-job process: connect DB, register definitions, start
processing, then install recurring triggers. 
*/
async function startWorker(): Promise<void> {
  try {
    await connectDB();
    // verify the db connection is up. (1 === connected.)
    if (mongoose.connection.readyState !== 1) {
      throw new Error("DB connection is not ready — aborting worker start.");
    }

    const agenda = agendaService.init();
    registerAllJobs(agenda);

    agenda.on("fail", (err: Error, job: Job) =>
      console.error(
        `fail   ${job.attrs.name} (attempt ${job.attrs.failCount ?? 1}): ${err.message}`,
      ),
    );

    await syncRecurringJobs();
    await agenda.start();

    // Minimal health server on WORKER_PORT.
    const app = express();
    app.get("/health", (_req, res) => res.status(200).json({ ok: true }));

    const server = http.createServer(app);
    server.listen(envConfig.WORKER_PORT, () =>
      console.info(
        `Agenda worker running on localhost:${envConfig.WORKER_PORT}`,
      ),
    );

    const shutdown = async (): Promise<void> => {
      console.info("Stopping worker (releasing job locks)...");
      server.close();
      await agenda.stop(); // graceful: in-flight jobs release their locks
      await disconnectDB();
      process.exit(0);
    };
    process.on("SIGTERM", shutdown);
    process.on("SIGINT", shutdown);
  } catch (err) {
    console.error("Worker boot failed:", err);
    await disconnectDB();
    process.exit(1);
  }
}

startWorker();
