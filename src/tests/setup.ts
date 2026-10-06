// Global test setup: registers mocks for the database and external services.
// Tests read env vars from .env.development (loaded by src/config/env.ts).
import "./mocks/database.mock";
import "./mocks/authkit-provider.mock";
import "./mocks/email-service.mock";
import "./mocks/athena-provider.mock";
import "./mocks/stripe.mock";
import "@/providers/audit-logs";
