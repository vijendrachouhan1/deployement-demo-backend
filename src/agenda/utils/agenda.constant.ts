// Agenda tuning constants. Fixed across environments and non-secret, so kept in code.
export const AGENDA_CONFIG = {
  COLLECTION: "agendaJobs",
  // Fallback poll interval; change streams are the primary dispatch path.
  PROCESS_EVERY: "30 seconds",
  // Max jobs running in parallel per worker.
  MAX_CONCURRENCY: 20,
  // Lock lifetime before a picked-up job is considered dead (10 minutes).
  DEFAULT_LOCK_MS: 10 * 60 * 1000,
  /*
  Controls how quickly the worker notices a new job.

  When this is set to true, MongoDB instantly tells the worker the moment a job
  is added, so the job starts running right away. When it is set to false, the
  worker instead checks the database on a timer (every PROCESS_EVERY, set above),
  so a new job can wait up to that long before it starts. Either way every job
  still runs reliably — the only thing that changes is how soon it begins.

  The catch: these instant notifications (MongoDB calls them "change streams")
  only work when MongoDB is running as a replica set. MongoDB Atlas already runs
  that way, so staging and production are fine. A plain MongoDB installed on your
  own machine is usually NOT a replica set, so while this is set to true the
  worker will fail to start there.

  To run the worker locally, do any one of these:
    - point DB_PATH at Atlas, or
    - run your local MongoDB as a single-node replica set, or
    - set this to false to fall back to the timer-based checking above.
  */
  USE_CHANGE_STREAMS: true,
} as const;
