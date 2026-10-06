# Project Structure

How this Express + TypeScript backend is organized: the folder layout, the patterns every module follows, and how a request flows through the system.

> Setup instructions, scripts, and environment variables live in the [README](../README.md) and [`.env.example`](../.env.example) — this doc only covers architecture.

---

## Table of Contents

- [High-Level Overview](#high-level-overview)
- [Root Directory](#root-directory)
- [Source Directory (`src/`)](#source-directory-src)
  - [Entry Points](#entry-points)
  - [Config (`config/`)](#config-config)
  - [Database Layer (`db/`)](#database-layer-db)
  - [Modules (`modules/`)](#modules-modules)
  - [Middleware (`middleware/`)](#middleware-middleware)
  - [Providers (`providers/`)](#providers-providers)
  - [Webhooks (`webhooks/`)](#webhooks-webhooks)
  - [Background Jobs (`agenda/`)](#background-jobs-agenda)
  - [Helpers (`helpers/`)](#helpers-helpers)
  - [Types, Enums & Constants](#types-enums--constants)
  - [Tests (`tests/`)](#tests-tests)
- [Request Lifecycle](#request-lifecycle)
- [Module Deep-Dive: Anatomy of a Module](#module-deep-dive-anatomy-of-a-module)
- [Routing & Role-Based Access](#routing--role-based-access)
- [API Response Format](#api-response-format)
- [Path Aliases](#path-aliases)

---

## High-Level Overview

```
boilerplate-backend/
│
├── src/                    # All application source code
│   ├── app.ts              # Express app factory (middleware + routes)
│   ├── server.ts           # HTTP server bootstrap (DB + Socket.IO)
│   ├── config/             # App & env configuration
│   ├── constants/          # Shared constant values
│   ├── agenda/             # Background & scheduled jobs (Agenda worker)
│   ├── db/                 # Database connection & Mongoose models
│   ├── enums/              # Shared enumerations
│   ├── helpers/            # Reusable utility functions
│   ├── middleware/         # Express middleware (auth, rate-limit, etc.)
│   ├── modules/            # Feature modules (routes + controllers + helpers)
│   ├── providers/          # Third-party SDK wrappers and services
│   ├── scripts/            # One-off maintenance scripts (e.g. roles sync)
│   ├── tests/              # Test infrastructure (mocks, setup)
│   ├── types/              # Shared TypeScript type definitions
│   └── webhooks/           # Inbound webhook handlers
│
├── @types/                 # Global TypeScript declaration overrides
├── docs/                   # Project documentation
├── scripts/                # Build & dev helper scripts
├── server/                 # Compiled JS output (build artifact)
├── Dockerfile              # Multi-stage Docker build
├── package.json            # Dependencies & scripts
├── tsconfig.json           # TypeScript configuration
├── vitest.config.mts       # Test runner configuration
└── eslint.config.mjs       # Linting rules
```

---

## Tech Stack

| Layer                  | Technology                                             |
| ---------------------- | ------------------------------------------------------ |
| **Runtime**            | Node.js ^22.13 \|\| >=24                               |
| **Language**           | TypeScript ~5.9                                        |
| **Framework**          | Express 5                                              |
| **Database**           | MongoDB via Mongoose 8                                 |
| **Validation**         | Zod 4 + zod-express-validator                          |
| **Auth**               | WorkOS AuthKit / Supabase, JWT (access + refresh), MFA |
| **Authorization**      | Role- & permission-based (RBAC)                        |
| **Payments**           | Stripe (Connect + Payments + Subscriptions)            |
| **Real-time**          | Socket.IO 4                                            |
| **Chat**               | GetStream                                              |
| **Email**              | AWS SES (+ SendGrid stub)                              |
| **File Storage**       | AWS S3 (+ Azure/GCP stubs)                             |
| **SMS**                | Twilio (+ AWS SNS / Vonage stubs)                      |
| **Push Notifications** | OneSignal (+ FCM stub)                                 |
| **Testing**            | Vitest + mongodb-memory-server + Supertest             |
| **Linting**            | ESLint 10 + Prettier                                   |
| **CI/CD**              | Docker, GitHub Workflows                               |

---

## Root Directory

| File / Folder               | Purpose                                                                       |
| --------------------------- | ----------------------------------------------------------------------------- |
| `package.json`              | Dependencies, scripts, engine constraints                                     |
| `tsconfig.json`             | TypeScript compiler options, path aliases, base configuration (`@/` → `src/`) |
| `tsconfig.build.json`       | Build-specific TS config (extends base)                                       |
| `vitest.config.mts`         | Vitest test runner configuration                                              |
| `eslint.config.mjs`         | ESLint flat-config rules                                                      |
| `.prettierrc`               | Prettier formatting options                                                   |
| `.commitlintrc.json`        | Conventional commit message enforcement                                       |
| `lint-staged.config.mjs`    | Pre-commit lint-staged rules                                                  |
| `.husky/`                   | Git hooks (commit-msg, pre-commit)                                            |
| `nodemon.json`              | Dev server auto-reload configuration                                          |
| `.env.example`              | Template for required environment variables                                   |
| `.env` / `.env.development` | Environment variables (git-ignored)                                           |
| `Dockerfile`                | Multi-stage production Docker image                                           |
| `@types/`                   | Global TS declaration merges (`express`, `jwt`, `vitest`)                     |
| `scripts/`                  | Utility scripts (e.g. `verifyEnvBackEnd.js`)                                  |
| `server/`                   | Compiled JavaScript output from `tsc`                                         |

---

## Source Directory (`src/`)

### Entry Points

#### `server.ts` — Bootstrap

The main entry point. It:

1. Creates the Express app via `createApp()`
2. Connects to MongoDB via `connectDB()`
3. Creates an HTTP server
4. Initializes Socket.IO via `SocketService`
5. Starts listening on the configured `PORT`

```typescript
// Simplified flow
async function bootstrap() {
  const app = createApp();
  await connectDB();
  const server = http.createServer(app);
  const socketService = new SocketService(server);
  app.set("socketService", socketService);
  server.listen(PORT);
}
```

#### `app.ts` — Express App Factory

Configures the Express application with this middleware pipeline:

```
Request ──► trust proxy
        ──► helmet (security headers)
        ──► CORS
        ──► URL-encoded parser
        ──► rate limiter
        ──► client platform detector
        ──► /webhook routes (raw body)
        ──► cookie parser
        ──► JSON parser
        ──► compression (gzip)
        ──► /api routes (all feature modules)
        ──► 404 catch-all
        ──► global error handler
```

---

### Config (`config/`)

```
config/
├── api.ts        # Rate-limiting & payload size limits
├── cookies.ts    # Cookie configuration
├── cors.ts       # CORS allowed origins & methods
└── env.ts        # Zod-validated environment variables
```

**`env.ts`** is the most critical config file. It:

- Loads the right env file based on `NODE_ENV` (see the [README](../README.md#environment-variables) for the loading rules)
- Defines a **Zod schema** for every environment variable with types, defaults, and constraints
- Validates all variables at startup — the server **will not start** if validation fails
- Exports a strongly-typed `envConfig` object used throughout the app

**`api.ts`** centralises rate-limiting and payload size settings:

| Setting                    | Default              |
| -------------------------- | -------------------- |
| `RATE_LIMIT_WINDOW_MS`     | 60,000 ms (1 minute) |
| `RATE_LIMIT_MAX_REQUESTS`  | 100 requests/window  |
| `API_MAX_PAYLOAD_SIZE`     | 100kb                |
| `API_MAX_URL_ENCODED_SIZE` | 100kb                |

---

### Database Layer (`db/`)

```
db/
├── index.ts          # Connection helpers (dev/prod + in-memory test DB)
├── models/           # Mongoose model definitions
│   ├── user.ts
│   ├── company.ts
│   ├── products.ts
│   ├── subscription.ts
│   ├── notifications.ts
│   ├── referrals.ts
│   ├── referral-reward.ts
│   ├── recoveryCodes.ts          # MFA recovery codes
│   ├── refreshToken.ts           # Rotating JWT refresh tokens
│   ├── errorLogs.ts
│   ├── invitedUsers.ts
│   ├── otpVerification.ts
│   ├── userQuery.ts
│   ├── userNotificationPreference.ts
│   ├── stripeConnect/    # Stripe Connect models (vendor, customer, products, transactions)
│   ├── stripePayment/    # Stripe Payment models (customer, products, transactions)
│   └── audit-logs/       # Audit models (log, DLQ, chain-head, quotas, export/migration state)
├── plugins/          # Mongoose plugins attached by models
│   └── audit/        # Audit write/sign engine + audit.plugin.ts (the 5 audited models attach this)
│       ├── audit.plugin.ts         # The plugin the audited models attach
│       ├── append-audit-log.ts     # Build → sign → CAS → append / DLQ
│       ├── ...                      # Diff, tenant/company resolution, verify mirror
│       ├── utils/                   # Hashing, deterministic JSON, subsystem refs, chain constants
│       └── __tests__/               # Write-engine tests
└── seeders/          # Database seed scripts
    ├── product.ts
    ├── stripe-connect-products.ts
    └── user-queries.ts
```

**Key patterns:**

- Each model file exports a Mongoose schema, model, and TypeScript interface
- `index.ts` provides `connectDB()` / `disconnectDB()` for dev/prod and `connectTestDB()` / `clearTestDB()` / `disconnectTestDB()` for in-memory test databases

---

### Modules (`modules/`)

This is where **all feature code** lives. Modules are the core building blocks.

```
modules/
├── api.ts              # Main API router — mounts all feature routes under /api
├── admin.ts            # Admin router — mounts admin-specific routes under /api/admin
├── super-admin.ts      # Super Admin router — mounts SA routes under /api/super-admin
├── system.ts           # System router — internal/system routes under /api/system
│
├── auth/               # Authentication (login, signup, OTP, magic link, MFA + recovery codes, token refresh)
├── users/              # User profile management + user stats
├── roles/              # Roles & permissions management (RBAC)
├── company/            # Company/org management
├── products/           # Product CRUD
├── cards/              # Card management
├── chat/               # GetStream chat integration
├── notifications/      # Push & in-app notifications
├── referrals/          # Referral program (+ chart data)
├── invite-user/        # User invitation flow
├── subscription/       # Subscription management
├── stripe-connect/     # Stripe Connect (marketplace payouts)
├── stripe-payment/     # Stripe Payments (one-time charges)
├── user-query/         # Support / help desk queries
├── error-logs/         # System error log management
├── audit-logs/         # Tamper-evident audit trail (read, verify, retention, emit front-door)
└── file-upload/        # File upload (S3 pre-signed URLs)
```

> 📖 See [Module Deep-Dive](#module-deep-dive-anatomy-of-a-module) for the internal structure of each module.

---

### Middleware (`middleware/`)

```
middleware/
├── audit-context.ts     # Stamps per-request audit context (subsystem/actor) for /api requests
├── auth.ts              # JWT decoding + role-based access guards
├── authorize.ts         # Fine-grained permission (RBAC) guard
├── client-platform.ts   # Detects mobile vs web clients
├── error-handler.ts     # Global error handler + DB error logging
└── rate-limiter.ts      # express-rate-limit configuration
```

**`auth.ts`** — The `Middleware` class provides these guards:

| Method                 | Purpose                                                                        |
| ---------------------- | ------------------------------------------------------------------------------ |
| `jwtDecoder`           | Extracts JWT from cookies (web) or Bearer token (mobile), populates `req.user` |
| `authMiddleware`       | Requires authenticated user (any role: User, Admin, Super Admin)               |
| `superAdminMiddleware` | Requires Super Admin role only                                                 |
| `systemMiddleware`     | Requires System role                                                           |
| `pendingMfaMiddleware` | Allows only the temporary token issued mid-login, for MFA setup/verify routes  |

Token handling is **platform-aware**: cookies for web clients, Bearer tokens for mobile.

**`authorize.ts`** — The `authorize(...permissions)` guard enforces **fine-grained, permission-based access** on individual routes (mainly under `/api/admin`). Permissions follow a `domain:action` convention (e.g. `products:write`) with hierarchical action levels — `view` < `write` < `manage` — so a higher level implies the lower ones. Super Admins bypass all permission checks. Permissions are defined in the `PERMISSIONS` enum (`enums/permissions.enum.ts`).

**`error-handler.ts`** — Logs errors to the `ErrorLogs` MongoDB collection with sanitized request context (passwords, tokens redacted), then returns a standardized error response.

---

### Providers (`providers/`)

Providers encapsulate external APIs and third-party SDKs (email, auth, payments, real-time, etc.) behind unified interfaces. Feature modules consume providers instead of talking to SDKs directly.

```
providers/
├── audit-logs/                   # Audit storage adapters (Mongo hot tier + Athena/S3 cold tier)
│   ├── index.ts                  # Active storage-provider factory
│   ├── mongo.provider.ts         # Mongo storage adapter (hot reads/writes)
│   ├── athena.provider.ts        # Athena query adapter (cold reads)
│   ├── athena-chain-reader.ts    # Athena cold-chain stream
│   ├── archive-setup.provider.ts # Athena/Glue table setup
│   ├── archive-upload.provider.ts# S3 upload + partition register
│   ├── parquet-archive.provider.ts # Parquet encoder
│   └── utils/                    # Storage interface + row/filter/cursor types & constants
│
├── auth/
│   ├── index.ts                  # AuthProvider factory
│   ├── authkit.provider.ts       # WorkOS AuthKit implementation
│   ├── supabase.provider.ts      # Supabase Auth implementation
│   └── utils/                    # Provider-specific types & enums
│
├── email/
│   ├── index.ts                  # EmailService factory
│   ├── ses.provider.ts           # AWS SES provider
│   ├── sendgrid.provider.ts      # SendGrid provider (stub)
│   ├── templates/                # Email HTML templates
│   └── utils/
│
├── file-storage/
│   ├── index.ts                  # FileStorage factory
│   ├── s3.provider.ts            # AWS S3 implementation
│   ├── azure.provider.ts         # Azure Blob (stub)
│   ├── gcp.provider.ts           # Google Cloud Storage (stub)
│   └── utils/
│
├── payment/
│   ├── index.ts                  # Payment provider factory
│   └── stripe/                   # Stripe SDK wrappers
│       ├── stripe-common.provider.ts
│       ├── stripe-connect.provider.ts
│       ├── stripe-payment.provider.ts
│       ├── stripe-subscription.provider.ts
│       └── stripe.types.ts
│
├── push-notification/
│   ├── index.ts                  # PushNotification factory
│   ├── onesignal.provider.ts     # OneSignal implementation
│   ├── fcm.provider.ts           # Firebase Cloud Messaging (stub)
│   └── utils/
│
├── sms/
│   ├── index.ts                  # SMS factory
│   ├── twilio.provider.ts        # Twilio implementation
│   ├── sns.provider.ts           # AWS SNS (stub)
│   ├── vonage.provider.ts        # Vonage (stub)
│   └── utils/
│
├── socket/
│   ├── index.ts                  # Socket.IO real-time service provider
│   └── utils/
│
└── stream-chat/
    ├── index.ts                  # GetStream chat provider
    └── utils/
```

**Design principle:** Each provider folder has an `index.ts` factory that returns the active implementation. Switching providers (e.g. SES → SendGrid) only requires changing the factory — no module code changes.

**`socket/index.ts`** — Typed Socket.IO service with room-based and user-specific event emission:

- `emit()` — Broadcast to all clients
- `emitToRoom()` — Emit to a specific room
- `emitToUser()` — Emit to a specific user's room (`user:{userId}`)

---

### Webhooks (`webhooks/`)

Inbound webhook handlers for third-party event processing.

```
webhooks/
├── index.ts                  # WebhookRouter — mounts all webhook routes under /webhook
├── authkit/                  # WorkOS AuthKit webhook events
├── getstream/                # GetStream chat webhook events
├── onesignal/                # OneSignal notification events
├── stripe-connect/           # Stripe Connect webhook events
├── stripe-payment/           # Stripe Payment webhook events
└── subscription/             # Stripe Subscription webhook events
```

**Important:** Stripe webhooks use `raw()` body parsing (required for signature verification), while others use `json()`.

```
/webhook/subscription      → raw body  → StripeSubscriptionWebhookRouter
/webhook/stripe-payment    → raw body  → StripePaymentWebhookRouter
/webhook/stripe-connect    → raw body  → StripeConnectWebhookRouter
/webhook/getstream         → json body → GetStreamWebhookRouter
/webhook/onesignal         → json body → OnesignalWebhookRouter
/webhook/authkit           → json body → AuthkitWebhookRouter
```

---

### Background Jobs (`agenda/`)

Background and scheduled jobs run on a dedicated **worker process** (`WORKER_PORT`),
backed by [Agenda](https://github.com/agenda/agenda) on MongoDB. Job definitions
and recurring triggers are separated so producers (the API) can enqueue jobs while
only the worker processes them.

```
agenda/
├── worker.ts                       # Worker bootstrap: connect DB → register → schedule → start
├── agenda.service.ts               # Singleton Agenda instance + typed producer methods
├── register.ts                     # Job definitions (agenda.define)
├── schedule.ts                     # Recurring triggers (agenda.every) — idempotent per name
├── helpers/
│   ├── stripe-connect.helper.ts    # Process pending Stripe Connect transfers
│   ├── error-logs.helper.ts        # Delete previous month's error logs
│   ├── password-rotation.helper.ts # Send password expiry reminders
│   └── audit-retention.helper.ts   # Sweep expired audit rows to the cold tier
└── utils/
    ├── agenda.constant.ts          # Engine tuning (collection, concurrency, change streams)
    └── job-names.constant.ts       # Single source of truth for job names
```

| Schedule                     | Job name                             | Description                            |
| ---------------------------- | ------------------------------------ | -------------------------------------- |
| `0 0 * * *` (daily midnight) | `stripe:process-transfers`           | Process pending Stripe Connect payouts |
| `0 0 1 * *` (1st of month)   | `logs:cleanup-prev-month`            | Clean up old error logs                |
| `0 9 * * *` (daily 9 AM)     | `security:password-expiry-reminders` | Email 14/7/1-day expiry warnings       |
| `0 2 * * *` (daily 2 AM)     | `audit:retention-sweep`              | Sweep expired audit rows to cold tier  |

**Start separately:** `npm run worker-dev` (development) or `npm run worker-start` (production)

---

### Helpers (`helpers/`)

Generic code shared across modules — some pure (`pagination`, `query`, `api-response`), some with side effects (`notification`, `cookie`). A **generic** utility owned by no single feature lives here. The module-level helpers-vs-utils purity rule ([Anatomy of a Module](#module-deep-dive-anatomy-of-a-module)) governs code _inside_ a module; this shared folder keeps the `helpers/` name regardless of whether a given file is pure.

```
helpers/
├── api-response.ts       # SuccessResponse() & ErrorResponse() wrappers
├── app-error.ts          # Custom AppError class
├── common.ts             # General utilities (ObjectId casting, isMobileRequest, etc.)
├── cookie.ts             # Cookie set/clear helpers
├── jwt.ts                # JWT sign/verify (singleton)
├── notification.ts       # Notification creation helpers
├── pagination.ts         # Pagination response builder
├── query.ts              # MongoDB aggregation pipeline helpers (facets, etc.)
└── validation-error.ts   # Validation error formatting
```

---

### Types, Enums & Constants

Only **truly shared** definitions live at the top level. Module-specific types stay in each module's `utils/` folder, and provider-specific types/enums in each provider's `utils/` folder.

```
types/
├── index.ts               # Barrel export
├── api-config.types.ts    # IApiConfig, IApiResponse
├── common.types.ts        # Shared common types
├── getstream.types.ts     # GetStream chat types
├── pagination.types.ts    # Pagination request/response types
└── query.types.ts         # MongoDB query builder types

enums/
├── index.ts               # Barrel export
├── audit.enum.ts          # Audit event contract: AuditAction, AuditStatus, AuditTargetType, AuditCategory
├── auth.enum.ts           # AUTH_PROVIDER enum
├── common.enum.ts         # STATUS, USER_TYPE, SERVER_ENV, ERROR_TYPE, etc.
├── email.enum.ts          # EMAIL_TEMPLATE_NAME
├── payment.enum.ts        # Payment-related enums
├── permissions.enum.ts    # PERMISSIONS (domain:action RBAC permissions)
└── push-notification.enum.ts

constants/
├── common.ts              # Shared constants
├── error-codes.ts         # Application error code definitions
└── pagination.ts          # DEFAULT_PAGE, DEFAULT_PAGE_SIZE
```

---

### Tests (`tests/`)

Test infrastructure only — individual test files live inside each module's `__tests__/` folder.

```
tests/
├── TESTING.md        # Testing guidelines documentation
├── global-setup.ts   # Vitest global setup (spins up the in-memory Mongo instance)
├── setup.ts          # Per-suite setup (DB connect/clear/disconnect, shared mocks)
├── mocks/            # Shared mock factories (authkit-provider, database, email-service, jwt)
└── utils/            # Test utility helpers (auth)
```

A test lives in a `__tests__/` folder next to the code it tests — for `modules/`, `providers/`, `middleware/`, `db/models/`, and `scripts/` alike. `src/tests/` is reserved for shared infra (`setup.ts`, `mocks/`, `utils/`) and cross-cutting integration tests that span multiple units and have no single owner.

```
modules/products/__tests__/
modules/auth/__tests__/
modules/audit-logs/__tests__/
```

---

## Request Lifecycle

Here's how a typical API request flows through the system:

```
Client Request
     │
     ▼
  ┌──────────────────┐
  │  Express App     │
  │  (app.ts)        │
  ├──────────────────┤
  │ 1. Helmet        │ ← Security headers
  │ 2. CORS          │ ← Origin validation
  │ 3. URL Parser    │ ← Parse URL-encoded
  │ 4. Rate Limiter  │ ← 100 req/min limit
  │ 5. Platform Det. │ ← Detect mobile/web
  │ 6. Cookie Parser │ ← Parse cookies
  │ 7. JSON Parser   │ ← Parse JSON body
  │ 8. Compression   │ ← gzip response
  └────────┬─────────┘
           │
     ┌─────▼─────┐         ┌───────────┐
     │  /webhook  │────────►│ Webhook   │ (raw/json body, no auth)
     └───────────┘         │ Handlers  │
           │               └───────────┘
     ┌─────▼─────┐
     │   /api     │
     └─────┬─────┘
           │
     ┌─────▼──────────┐
     │  JWT Decoder    │ ← Extracts & validates token, populates req.user
     └─────┬──────────┘
           │
     ┌─────▼──────────────────────────────────┐
     │  Route-Level Middleware                 │
     │  ┌────────────┐ ┌───────┐ ┌──────────┐ │
     │  │ authMiddle- │ │ admin │ │ super-   │ │
     │  │ ware       │ │ M.W.  │ │ admin MW │ │
     │  └────────────┘ └───────┘ └──────────┘ │
     └─────┬──────────────────────────────────┘
           │
     ┌─────▼──────────┐
     │  Zod Validator  │ ← Validates req.body / req.query / req.params
     └─────┬──────────┘
           │
     ┌─────▼──────────┐
     │  Controller     │ ← Handles request, calls Helper
     └─────┬──────────┘
           │
     ┌─────▼──────────┐
     │  Helper         │ ← Business logic + DB operations
     └─────┬──────────┘
           │
     ┌─────▼──────────┐
     │  Provider       │ ← External APIs (email, payment, etc.)
     └─────┬──────────┘
           │
     ┌─────▼──────────┐
     │  API Response   │ ← SuccessResponse() or ErrorResponse()
     └────────────────┘
```

---

## Module Deep-Dive: Anatomy of a Module

Every feature module follows the same internal shape. Using `auth/` — the fullest example in the codebase:

```
modules/auth/
├── index.ts                    # Router classes (one per role) — the module's entry point
├── auth.controller.ts          # Request handlers (role-split into multiple *.controller.ts where needed)
├── helpers/
│   ├── auth.helper.ts          # Front door — the ONLY helper a controller imports
│   ├── login.helper.ts         # Sub-helpers, each imported INTO auth.helper.ts
│   ├── otp.helper.ts
│   ├── mfa.helper.ts
│   └── …                       # register, password, token, magic-link, invite
├── utils/
│   ├── auth.types.ts           # TypeScript types
│   ├── auth.validation.ts      # Zod request schemas
│   ├── auth.constant.ts        # Message strings, config defaults
│   ├── auth.enum.ts            # Module-specific enums
│   └── auth.util.ts            # Pure, side-effect-free functions (optional)
└── __tests__/                  # Co-located tests
```

### The entry-point chain

Reading a module top to bottom, control flows through fixed entry points:

`index.ts` (router — mounts guards + validators) → `*.controller.ts` (parse request, format response) → **`helpers/<feature>.helper.ts`** (the single front door) → sub-helpers.

The **front-door rule** is what keeps every module predictable:

- A controller imports **only** `<feature>.helper.ts` from the module's own helpers — never a sub-helper directly.
- `<feature>.helper.ts` is where the module's logic starts. As it grows, carve a concern out into its own `*.helper.ts` **in the same folder** and import it back into the front door. The front door stays the one public face; the splits stay private to the module.

For example: `auth.controller.ts` imports only `authHelper`, and `auth.helper.ts` imports `login`, `otp`, `mfa`, `register`, `password`, `token`, and `magic-link`. One door in, everything else behind it.

### Flat helpers vs. a sub-folder

Most split helpers sit **flat** in `helpers/` as `<concern>.helper.ts` — they're peers, each called independently (auth's `login`, `otp`, `mfa`). Reach for a **sub-folder** only when a group of files forms one tight unit: **one public entry, plus files that exist only to serve it.** The folder name already says the topic, so files inside don't repeat it — `retention/sweep.helper.ts`, not `retention/retention-sweep.helper.ts`.

Two real cases in `audit-logs`:

- `helpers/retention/` (`sweep`, `processor`, `window`) — one archival pipeline. The retention job assembles them as a unit, and `window` has no caller outside retention.
- `helpers/verify/` (`verify-chain`, `chain-walker`) — `verify-chain` is the public entry; `chain-walker` is its private state machine, imported by nothing else.

The test: if the files ship and change together and the outer ones shield the inner ones, a folder earns its place. If they're independent peers, keep them flat.

### Helpers vs. utils — the rule

Both folders hold code, and the split is **not** "logic vs. types." It's **side effects**:

|                | `helpers/`                                                    | `utils/`                                                   |
| -------------- | ------------------------------------------------------------- | ---------------------------------------------------------- |
| Holds          | Business logic that touches the outside world                 | Declarations + pure functions                              |
| Typically      | `await`s the DB, calls a provider, reads `req` / writes `res` | takes arguments, returns a value, touches nothing external |
| You test it by | mocking the DB / providers                                    | calling it and asserting the return — no mocks             |

> **The test:** if you can unit-test it by passing arguments and checking the return with **no mocks**, it's a util. If it needs a mock to test, it's a helper.

"Util" does **not** mean "generic." A pure function can be deeply feature-specific (auth's `evaluatePasswordRotationState`) and still be a util — the line is _no side effects_, not _how feature-specific it is_.

### What goes in `utils/` — the closed list

A module's `utils/` folder holds exactly these five kinds, and nothing else:

| File                      | Holds                                           |
| ------------------------- | ----------------------------------------------- |
| `<feature>.types.ts`      | TypeScript types / interfaces                   |
| `<feature>.validation.ts` | Zod request schemas                             |
| `<feature>.constant.ts`   | Message strings, config defaults, magic numbers |
| `<feature>.enum.ts`       | Module-specific enums                           |
| `<feature>.util.ts`       | Pure, side-effect-free functions (optional)     |

If a file isn't one of these five, it doesn't belong in `utils/` — if it does real work (touches the DB, a provider, or `req`/`res`), it's a helper.

### When to add a `<feature>.util.ts`

Create one only for a **pure** function, and only when it earns its own name — either it repeats across several of the module's helper files, or it's a self-contained pure block worth lifting out so the helper reads as a clean story and the pure part is testable on its own.

Then decide **where** it lives by who owns it:

- **Owned by this feature** (even if another module borrows it) → `modules/<feature>/utils/<feature>.util.ts`.
- **Owned by no feature** — generic, any module could use it (capitalize a string, format a date) → the global `helpers/` folder, **not** a module.

### Layer Responsibilities

| Layer                   | File                          | Responsibility                                                   |
| ----------------------- | ----------------------------- | ---------------------------------------------------------------- |
| **Router**              | `index.ts`                    | Mount middleware guards, bind validators + controllers to routes |
| **Controller**          | `*.controller.ts`             | Parse request, call the front-door helper, format response       |
| **Helper (front door)** | `helpers/<feature>.helper.ts` | The one helper controllers call; orchestrates the module's logic |
| **Helper (split)**      | `helpers/*.helper.ts`         | A concern carved out of the front door, imported back into it    |
| **Validation**          | `utils/*.validation.ts`       | Zod schemas for request body/query/params                        |
| **Types**               | `utils/*.types.ts`            | Controller & helper TypeScript types                             |
| **Constants**           | `utils/*.constant.ts`         | Success/error message strings, config defaults                   |
| **Enums**               | `utils/*.enum.ts`             | Module-specific enumerations (present where needed)              |
| **Utils (pure)**        | `utils/*.util.ts`             | Pure, side-effect-free functions owned by the feature (optional) |

### Role-Based Controllers

Modules that serve multiple roles export **separate Router classes** from `index.ts`:

```typescript
// modules/products/index.ts exports:
export class ProductsRouter { ... }           // User-facing (GET only)
export class AdminProductsRouter { ... }      // Admin (CRUD)
export class SuperAdminProductsRouter { ... } // Super Admin (full CRUD)
```

Each router applies the appropriate middleware guard:

```typescript
// Authenticated routes
this.router.use(middleware.authMiddleware);

// Super Admin routes
this.router.use(middleware.superAdminMiddleware);
```

---

## Routing & Role-Based Access

The API has four top-level route groups:

```
/api
├── /auth              ← Public (login, signup, OTP, /auth/mfa for MFA flows)
├── /user              ← Authenticated users
├── /products          ← Authenticated users (read-only)
├── /referrals         ← Authenticated users
├── /notification      ← Authenticated users
├── /stripe-connect    ← Authenticated users
├── /stripe-payment    ← Authenticated users
├── /chat              ← Authenticated users
├── /help              ← Authenticated users
├── /aws               ← Authenticated users (file upload)
│
├── /admin             ← Per-route permission guards (authorize); Super Admin bypasses
│   ├── /user
│   ├── /products
│   ├── /invite-users
│   ├── /subscription
│   ├── /stripe-connect
│   ├── /stripe-payment
│   ├── /help
│   ├── /company
│   ├── /cards
│   ├── /roles
│   └── /audit-logs
│
├── /super-admin       ← Super Admin only
│   ├── /products
│   ├── /subscription
│   ├── /user
│   ├── /company
│   ├── /stripe
│   ├── /referrals
│   └── /audit-logs
│
└── /system            ← System role only
    └── /error-logs

/webhook               ← No auth (signature verification per provider)
├── /subscription
├── /stripe-payment
├── /stripe-connect
├── /getstream
├── /onesignal
└── /authkit
```

---

## API Response Format

All responses follow a consistent JSON structure:

```json
{
  "success": true,           // or false
  "message": "Products fetched successfully",
  "data": { ... },           // Response payload
  "errors": {},              // Validation or error details
  "messageCode": "OPTIONAL"  // Machine-readable error/success code
}
```

Built using `SuccessResponse()` and `ErrorResponse()` from `helpers/api-response.ts`.

---

## Environment Configuration

Environment variables are managed through three files:

| File               | Used When              |
| ------------------ | ---------------------- |
| `.env.development` | `NODE_ENV=development` |
| `.env.staging`     | `NODE_ENV=staging`     |
| `.env`             | Production / default   |

All variables are **validated with Zod** at startup. Key variable groups:

| Group         | Variables                                                                                              |
| ------------- | ------------------------------------------------------------------------------------------------------ |
| **Database**  | `DB_PATH`                                                                                              |
| **Server**    | `PORT`, `WORKER_PORT`, `FRONTEND_HOST`, `FRONTEND_INVITE_URL`, `ALLOWED_ORIGINS`, `COOKIE_DOMAIN_NAME` |
| **Auth**      | `JWT_SECRET`, `MFA_JWT_TOKEN_SECRET`, `OTP_HASH_SECRET`                                                |
| **AWS**       | `AWS_USER_KEY`, `AWS_USER_SECRET`, `S3_BUCKET_NAME`, `SES_SENDER_EMAIL`                                |
| **Stripe**    | `STRIPE_SECRET_KEY`, webhook secrets                                                                   |
| **Twilio**    | `TWILIO_NUMBER`, `TWILIO_ACCOUNTSID`, `TWILIO_AUTHTOKEN`                                               |
| **WorkOS**    | `WORKOS_CLIENT_ID`, `WORKOS_API_KEY`, `WORKOS_WEBHOOK_SECRET`                                          |
| **GetStream** | `GET_STREAM_MESSAGING_KEY`, `GET_STREAM_MESSAGING_SECRET`                                              |
| **OneSignal** | `ONE_SIGNAL_APP_ID`, `ONE_SIGNAL_REST_API_KEY`                                                         |

---

## Docker & Deployment

The `Dockerfile` uses a **multi-stage build**:

```
Stage 1 (base)    → Node 22 Alpine + system deps + Infisical CLI
Stage 2 (deps)    → Install npm dependencies
Stage 3 (builder) → Compile TypeScript → JavaScript
Stage 4 (runner)  → Final lean production image (port 8000)
```

```bash
# Build
docker build -t boilerplate-backend .

# Run with Docker Compose
docker-compose up
```

---

## Development Scripts

| Command                | Description                                |
| ---------------------- | ------------------------------------------ |
| `npm run dev`          | Start dev server with nodemon + hot reload |
| `npm run worker-dev`   | Start the Agenda job worker in development |
| `npm run build`        | Compile TypeScript to JavaScript           |
| `npm run build:dev`    | Build with development env validation      |
| `npm start`            | Run compiled production server             |
| `npm run worker-start` | Run the compiled Agenda job worker         |
| `npm run lint`         | Run ESLint                                 |
| `npm run format`       | Format code with Prettier                  |
| `npm test`             | Run tests with Vitest                      |
| `npm run ses-push`     | Push email templates to AWS SES            |
| `npm run roles:sync`   | Seed/sync default roles & permissions      |

---

## Path Aliases

The project uses TypeScript path aliases for clean imports:

```typescript
// Instead of:
import { User } from "../../../db/models/user";

// Use:
import { User } from "@/db/models/user";
```

Configured in `tsconfig.json` (`@/` → `src/`), resolved at build time by `tsc-alias`, and at dev time by `tsconfig-paths`.
