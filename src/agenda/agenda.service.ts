import { Agenda, type NotificationChannel } from "agenda";
import {
  MongoBackend,
  MongoChangeStreamNotificationChannel,
} from "@agendajs/mongo-backend";
import mongoose from "mongoose";
import type { Db } from "mongodb";
import { AGENDA_CONFIG } from "@/agenda/utils/agenda.constant";

/*
Singleton service for the Agenda background-job platform. 
Producers enqueue through this typed service; only the worker calls start(). 
Bound to the existing Mongoose connection, so there is a single Mongo pool.
*/
class AgendaService {
  private agenda: Agenda | null = null;

  // Build (once) and return the Agenda instance. Call after connectDB().
  public init(options: { enableNotifications?: boolean } = {}): Agenda {
    if (this.agenda) return this.agenda;

    const { enableNotifications = true } = options;

    const nativeDb = mongoose.connection.db;
    if (!nativeDb) {
      throw new Error(
        "Agenda init() called before the Mongoose connection was ready. Call connectDB() first.",
      );
    }
    /*
    Mongoose's bundled mongodb Db type is nominally distinct from the one
    @agendajs/mongo-backend uses (same driver, runtime-identical). Cast here.
    */
    const db = nativeDb as unknown as Db;

    const backend = new MongoBackend({
      mongo: db,
      collection: AGENDA_CONFIG.COLLECTION,
    });

    /*
    Change-stream channel for near-instant dispatch. It's an EventEmitter at
    runtime; the cast bridges a cross-package typings gap (no runtime effect).
    */
    const notificationChannel =
      enableNotifications && AGENDA_CONFIG.USE_CHANGE_STREAMS
        ? (new MongoChangeStreamNotificationChannel({
            db,
            collection: AGENDA_CONFIG.COLLECTION,
          }) as unknown as NotificationChannel)
        : undefined;

    this.agenda = new Agenda({
      backend,
      notificationChannel,
      processEvery: AGENDA_CONFIG.PROCESS_EVERY,
      maxConcurrency: AGENDA_CONFIG.MAX_CONCURRENCY,
      defaultLockLifetime: AGENDA_CONFIG.DEFAULT_LOCK_MS,
    });

    return this.agenda;
  }

  // The live engine, for producer methods. Throws if init() has not run.
  private get engine(): Agenda {
    if (!this.agenda) {
      throw new Error(
        "Agenda is not initialized. Call agendaService.init() after connectDB().",
      );
    }
    return this.agenda;
  }

  // ---- Producers (safe to call from the API process after init) ----

  // Enqueue for immediate processing.
  public async now<T extends object>(name: string, data: T) {
    return this.engine.now(name, data);
  }

  // Enqueue for a future time (Date or string like "in 2 hours").
  public async schedule<T extends object>(
    when: string | Date,
    name: string,
    data: T,
  ) {
    return this.engine.schedule(when, name, data);
  }

  /*
  Idempotent enqueue — at most one pending job per uniqueKey (e.g. a webhook
  event id, so a redelivered webhook does not double-process).
  */
  public async enqueueUnique<T extends object>(
    name: string,
    data: T,
    uniqueKey: Record<string, unknown>,
  ) {
    return this.engine.create(name, data).unique(uniqueKey).save();
  }

  // Register a recurring (cron/interval) job. Idempotent per job name.
  public async every(interval: string, name: string, data: object = {}) {
    return this.engine.every(interval, name, data);
  }
}

export const agendaService = new AgendaService();
