# Boilerplate Backend

A production-ready Express + TypeScript backend with built-in authentication (including MFA), payments, real-time features, chat, and more.

🏗️ **Architecture & folder layout** → [docs/project-structure.md](./docs/project-structure.md)

> 📖 For a detailed breakdown of every folder and file, see [project-structure.md](./docs/project-structure.md).

---

## Tech Stack

- **Runtime:** Node.js (^22.13 || >=24)
- **Language:** TypeScript
- **Framework:** Express 5
- **Database:** MongoDB (Mongoose)
- **Validation:** Zod
- **Auth:** [WorkOS AuthKit](https://workos.com/docs/user-management) (or Supabase) + JWT access/refresh tokens, TOTP-based MFA
- **Authorization:** Role- & permission-based access control (RBAC)
- **Payments:** Stripe (Connect, Payments, Subscriptions)
- **Real-time:** Socket.IO
- **Email:** AWS SES (SendGrid stub)
- **File Storage:** AWS S3 (Azure / GCP stubs)
- **SMS:** Twilio (AWS SNS / Vonage stubs)
- **Push Notifications:** OneSignal (FCM stub)
- **Chat:** GetStream

---

## Prerequisites

- **Node.js** ^22.13 || >=24
- **MongoDB** — a local instance or a [MongoDB Atlas](https://www.mongodb.com/atlas) connection string.
- **API keys** for the third-party services you plan to use — [`.env.example`](./.env.example) lists every service and the keys it needs.

---

## Getting Started

### 1. Install dependencies

```bash
npm install
```

### 2. Create your env file

```bash
cp .env.example .env.development
```

Open `.env.development` and fill in your values. The file is self-documenting — every key is explained there, marked required or optional, and grouped by service. The server starts fine with placeholder values; a key only needs a real value when you actually use that feature.

### 3. Start the server

```bash
npm run dev
```

The API is now available at `http://localhost:8000`. If a key is missing, the startup check tells you exactly which one — fix it and rerun.

### 4. Start the job worker (optional)

Background and scheduled jobs (Stripe transfers, error log cleanup, password expiry reminders, audit retention) run on a separate Agenda worker process:

```bash
npm run worker-dev
```

---

## Available Scripts

| Command                | Description                          |
| ---------------------- | ------------------------------------ |
| `npm run dev`          | Start dev server with hot reload     |
| `npm run worker-dev`   | Start the Agenda job worker (dev)    |
| `npm run build`        | Compile TypeScript to JavaScript     |
| `npm run build:dev`    | Build using the development env file |
| `npm start`            | Run compiled production server       |
| `npm run worker-start` | Run the compiled Agenda job worker   |
| `npm test`             | Run tests with Vitest (watch mode)   |
| `npm run lint`         | Run ESLint                           |
| `npm run format`       | Format code with Prettier            |
| `npm run ses-push`     | Push email templates to AWS SES      |
| `npm run roles:sync`   | Sync default roles & permissions     |

---

## Environment Variables

[`.env.example`](./.env.example) is the single source of truth — every key, what it's for, and whether it's required is documented there.

### Which env file is loaded when

`NODE_ENV` is never read from an env file — it is set before the process starts (by `cross-env` in the npm scripts, `nodemon.json`, Vitest, or the hosting platform). Env files are then loaded in layers; a key set by an earlier file is never overridden by a later one:

| `NODE_ENV`           | Loaded first       | Fallback (fills gaps) |
| -------------------- | ------------------ | --------------------- |
| `development`        | `.env.development` | `.env`                |
| `staging`            | `.env.staging`     | `.env`                |
| `test` (Vitest)      | `.env.development` | `.env`                |
| `production` / unset | —                  | `.env`                |

In practice:

- **Local development** — a single `.env.development` file is all you need. `npm run dev`, `npm test`, and `npm run build:dev` all resolve to the same file.
- **Deployed environments** — no env file exists at all. Secrets are fetched from Infisical and injected as real environment variables by the platform (see `.github/workflows/ecr-image-deploy.yml`).
- **Validation** — `npm run dev` / `npm run build` first check your env file against `.env.example` (`scripts/verifyEnvBackEnd.js`), and `src/config/env.ts` validates all values with Zod at startup. Keep both in sync when adding a key.

---

## Production Build

```bash
npm run build   # compile to server/
npm start       # run the compiled server
```

## Docker

```bash
# Build image
docker build -t boilerplate-backend .

# Run the container
docker run -p 8000:8000 --env-file .env boilerplate-backend
```

---

## Running Tests

Tests use **Vitest** with an in-memory MongoDB instance (no real database needed).

```bash
npm test
```

Module tests are co-located inside each module's `__tests__/` folder. See [`src/tests/TESTING.md`](./src/tests/TESTING.md) for testing guidelines.

---

## Error Logging

Unhandled errors are captured by the global error handler and persisted to the `ErrorLogs` MongoDB collection with sanitized request context (passwords and tokens redacted). Old logs are pruned monthly by a scheduled background job.

---

## Project Structure

For the architecture, folder layout, module anatomy, request lifecycle, and routing conventions, see:

📄 **[project-structure.md](./docs/project-structure.md)**

---
