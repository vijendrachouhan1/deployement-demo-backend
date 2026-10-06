import * as dotenv from "dotenv";
import * as path from "path";
import { z } from "zod";
import { SERVER_ENV } from "@/enums";

// Env files are loaded in layers: the NODE_ENV-specific file first
// (.env.development / .env.staging), then .env fills any remaining gaps.
// On deployed servers no env file exists — values are injected by the
// platform — so these calls simply do nothing there.
if (
  process.env.NODE_ENV === SERVER_ENV.DEVELOPMENT ||
  process.env.NODE_ENV === SERVER_ENV.TEST // tests reuse the local dev env
) {
  dotenv.config({ path: path.resolve(".", ".env.development") });
} else if (process.env.NODE_ENV === SERVER_ENV.STAGING) {
  dotenv.config({ path: path.resolve(".", ".env.staging") });
}
dotenv.config();

// Zod schema for environment variables
const envSchema = z.object({
  // Database Configuration
  DB_PATH: z.url().default("mongodb://localhost:27017/boilerplate"),

  // Server Configuration
  NODE_ENV: z.enum(SERVER_ENV),
  PORT: z.string().regex(/^\d+$/).default("8000"),
  WORKER_PORT: z.string().regex(/^\d+$/).default("8001"),
  FRONTEND_HOST: z.url().default("http://localhost:3000"),
  FRONTEND_INVITE_URL: z.url().default("http://localhost:3000/signup"),
  JWT_SECRET: z.string().min(8).default("i am a tea pot"),
  MFA_JWT_TOKEN_SECRET: z.string().min(8).default("default-mfa-jwt-secret"),
  OTP_HASH_SECRET: z.string().min(8).default("default-otp-secret"),
  ALLOWED_ORIGINS: z.string().default("http://localhost:3000"),

  // Number of test data
  NUM_TEST_DATA: z.coerce.number().int().positive().default(10),

  // Twilio Keys
  TWILIO_NUMBER: z.string(),
  TWILIO_ACCOUNTSID: z.string(),
  TWILIO_AUTHTOKEN: z.string(),

  // Stripe Keys
  STRIPE_SECRET_KEY: z.string(),
  STRIPE_WEBHOOK_SECRET: z.string(),
  STRIPE_CONNECT_WEBHOOK_SECRET: z.string(),
  STRIPE_PAYMENT_WEBHOOK_SECRET: z.string(),

  // AWS credentials — one IAM identity shared by S3, SES and Athena
  AWS_USER_KEY: z.string(),
  AWS_USER_SECRET: z.string(),
  S3_BUCKET_NAME: z.string().default("boilerplate-s3-upload"),
  S3_BUCKET_REGION: z.string().default("us-east-2"),
  SES_TEST_EMAIL: z.email(),
  SES_SENDER_EMAIL: z.email(),

  // Get Stream Keys
  GET_STREAM_MESSAGING_KEY: z.string(),
  GET_STREAM_MESSAGING_SECRET: z.string(),

  // OneSignal
  ONE_SIGNAL_APP_ID: z.string(),
  ONE_SIGNAL_REST_API_KEY: z.string(),

  // Cookie
  COOKIE_DOMAIN_NAME: z.string(),

  // WorkOs authkit
  WORKOS_CLIENT_ID: z.string(),
  WORKOS_API_KEY: z.string(),
  WORKOS_WEBHOOK_SECRET: z.string(),

  // Athena Configuration
  ATHENA_DATABASE: z.string().optional(),
  ATHENA_OUTPUT_LOCATION: z.string().optional(),
  ATHENA_REGION: z.string().optional(),

  AUDIT_HOT_WINDOW_DAYS: z.coerce.number().int().positive().default(90), //Cold Stroage (S3) Migration Days
  AUDIT_ARCHIVE_BUCKET: z.string().optional(),
  AUDIT_ARCHIVE_GLUE_DB: z.string().optional(),
});

// Parse and validate environment variables
const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  console.error("❌ Invalid environment variables:");
  console.error(parsedEnv.error);
  throw new Error("Environment validation failed");
}

// Export validated config
const envConfig = parsedEnv.data;

export default envConfig;
