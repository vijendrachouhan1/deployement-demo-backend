import mongoose from "mongoose";

import envConfig from "@/config/env";

// ------------
// Dev/Prod DB
// ------------
const connectDB = async () => {
  try {
    await mongoose.connect(envConfig.DB_PATH);
    console.log(`Connected to DB ${envConfig.DB_PATH}`);
  } catch (err) {
    console.log(`Error connecting to DB ${err}`);
  }
};

const disconnectDB = async () => {
  try {
    await mongoose.disconnect();
    console.log(`Disconnected!`);
  } catch (err) {
    console.log(`Error disconnecting from DB ${err}`);
  }
};

/* Test DB — the in-memory mongod is booted once per run by the Vitest globalSetup
   (src/tests/global-setup.ts). Each worker connects to that shared server using its
   own database name so parallel test files never clobber each other's data. */
const connectTestDB = async (uri: string, dbName: string) => {
  await mongoose.connect(uri, { dbName });
};

const clearTestDB = async () => {
  const collections = mongoose.connection.collections;
  await Promise.all(
    Object.values(collections).map((collection) => collection.deleteMany({})),
  );
};

const disconnectTestDB = async () => {
  await mongoose.disconnect();
};

export {
  clearTestDB,
  connectDB,
  connectTestDB,
  disconnectDB,
  disconnectTestDB,
};
