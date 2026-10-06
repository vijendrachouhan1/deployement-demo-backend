import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";

const EXAMPLE_ENV_PATH = path.resolve(".", ".env.example");

// Same layered resolution as src/config/env.ts: `.env.{NODE_ENV}` first (if
// present), then `.env` fills any remaining gaps.
const candidateFiles =
  process.env.NODE_ENV === "development"
    ? [".env.development", ".env"]
    : process.env.NODE_ENV === "staging"
      ? [".env.staging", ".env"]
      : [".env"];

const existingFiles = candidateFiles.filter((file) =>
  fs.existsSync(path.resolve(".", file)),
);

const loadEnv = () => {
  if (existingFiles.length === 0) {
    console.log("");
    console.log("\x1b[41m%s\x1b[0m", "  Env Check: Failed  ");
    console.log(
      "\x1b[33m%s\x1b[0m",
      `  No env file found. Create one of: ${candidateFiles.join(", ")}`,
    );
    console.log("\x1b[33m%s\x1b[0m", "  Start from the template:");
    console.log("\x1b[33m%s\x1b[0m", `  cp .env.example ${candidateFiles[0]}`);
    console.log("");
    throw new Error("Check env files!");
  }

  // Parsing the example env file
  const exampleEnv = dotenv.parse(fs.readFileSync(EXAMPLE_ENV_PATH));

  // Merging keys from all layered env files (env-specific file wins over .env)
  const env = Object.assign(
    {},
    ...existingFiles
      .slice()
      .reverse()
      .map((file) => dotenv.parse(fs.readFileSync(path.resolve(".", file)))),
  );

  // Checking missing values
  const missingFromEnv = difference(Object.keys(exampleEnv), Object.keys(env));
  const missingFromEnvExample = difference(
    Object.keys(env),
    Object.keys(exampleEnv),
  );

  showMessage(missingFromEnv, missingFromEnvExample);
};

const difference = (arrA, arrB) => {
  return arrA.filter((a) => arrB.indexOf(a) < 0);
};

const showMessage = (missingFromEnv, missingFromEnvExample) => {
  console.log("");
  if (missingFromEnv.length > 0 || missingFromEnvExample.length > 0) {
    console.log("\x1b[41m%s\x1b[0m", "  Env Check: Failed  ");
    if (missingFromEnvExample.length > 0) {
      console.log("\x1b[33m%s\x1b[0m", "  Missing:", missingFromEnvExample);
      console.log("\x1b[33m%s\x1b[0m", "  From:", EXAMPLE_ENV_PATH);
      console.log("");
    }
    if (missingFromEnv.length > 0) {
      console.log("\x1b[33m%s\x1b[0m", "  Missing:", missingFromEnv);
      console.log("\x1b[33m%s\x1b[0m", "  From:", existingFiles.join(" + "));
      console.log("");
    }
    throw new Error("Check env files!");
  } else {
    console.log("\x1b[42m%s\x1b[0m", "  Env Check: Passed  ");
    console.log("");
  }
};

loadEnv();
