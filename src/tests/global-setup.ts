import { MongoMemoryReplSet } from "mongodb-memory-server";

/* Boots a single in-memory mongod for the entire test run and hands its URI to every
   worker via `provide`. Workers read it with `inject("MONGO_URI")` and connect to their
   own database name, so we pay the mongod binary boot once instead of once per file.

   It runs as a single-node REPLICA SET (not a standalone) because the audit emit engine
   commits its chain-head CAS and row append inside a Mongo transaction, and transactions
   require a replica set. Prod uses Atlas, which is always a replica set. */

declare module "vitest" {
  interface ProvidedContext {
    MONGO_URI: string;
  }
}

let mongoServer: MongoMemoryReplSet;

export default async function setup({
  provide,
}: {
  provide: (key: "MONGO_URI", value: string) => void;
}) {
  mongoServer = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  provide("MONGO_URI", mongoServer.getUri());

  return async () => {
    await mongoServer.stop();
  };
}
