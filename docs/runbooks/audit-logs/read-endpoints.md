# Audit Logs — Read Endpoints

There are two read surfaces, both gated on the `audit-logs:view` permission. One
is scoped to the caller's tenant; the other spans all tenants.

## Endpoints

### Admin (tenant-scoped)

```
GET  /api/admin/audit-logs           # list, paginated
GET  /api/admin/audit-logs/:id       # single row
```

- Role gate: `ADMIN` or `SUPER_ADMIN` via `adminMiddleware`
- Permission gate: `audit-logs:view`
- **Scope:** `companyRef` is server-forced to `req.user.companyRef`. Any
  caller-supplied `?companyRef=` is silently dropped (no error, just ignored).
- **Cross-tenant `/:id`:** returns **404 (not 403)** if the row belongs to a
  different tenant — this prevents probing which row IDs exist in other tenants.
- **`?search=` rejected:** substring search on `actorEmail` is super-admin-only.
  Admin attempts return HTTP 400 from a pre-validator middleware.

### Super-admin (cross-tenant)

```
GET  /api/super-admin/audit-logs           # list, paginated, all tenants
GET  /api/super-admin/audit-logs/:id       # single row, any tenant
POST /api/super-admin/audit-logs/athena    # Athena query (separate surface)
```

- Role gate: `superAdminMiddleware` (parent router)
- Permission gate: `audit-logs:view` (gained via the wildcard `"*"` permission
  on the super_admin role — see [permissions.md](./permissions.md))
- **Scope:** optional `?companyRef=` is regex-validated
  (`/^[a-zA-Z0-9_-]{1,64}$|^SYSTEM:[a-z]{1,32}$/`) and applied verbatim. Omit it
  to read across all tenants.
- **`?search=`:** allowed. Case-insensitive substring match against
  `actorEmail` (regex-escaped).

## Query parameters (both endpoints, unless noted)

| Param        | Type                | Notes                                                                            |
| ------------ | ------------------- | -------------------------------------------------------------------------------- |
| `page`       | int ≥ 1             | default 1                                                                        |
| `pageSize`   | int 1-100           | default 25                                                                       |
| `category`   | string              | exact match against `AuditCategory`                                              |
| `action`     | string              | exact match (e.g. `user.status_updated`)                                         |
| `actorId`    | ObjectId hex        | 24-char hex                                                                      |
| `actorEmail` | email               | exact match                                                                      |
| `search`     | string              | **super-admin only** — substring on `actorEmail`                                 |
| `status`     | `success`/`failure` |                                                                                  |
| `targetType` | string              | e.g. `users`, `companies`                                                        |
| `targetId`   | ObjectId hex        |                                                                                  |
| `companyRef` | string regex        | admin: ignored. super-admin: scopes the query                                    |
| `from`       | ISO date            | inclusive lower bound on `timestamp`                                             |
| `to`         | ISO date            | inclusive upper bound on `timestamp`                                             |
| `sortBy`     | enum                | `timestamp` (default), `createdAt`, `action`, `category`, `actorEmail`, `status` |
| `sortDir`    | `asc`/`desc`        | default `desc`                                                                   |

Any unknown query parameter is silently stripped during validation.

## Request ID — server controlled

Every `/api` request gets a server-generated UUID v4 `requestId` from
`auditContextMiddleware` (mounted before `jwtDecoder`). The middleware:

- **Ignores** any incoming `X-Request-Id` header — client-supplied values are
  not honored.
- Echoes the generated UUID back as the `X-Request-Id` response header, so logs
  can be correlated.
- Stamps the value into `AuditContext`, so any audit-log emit inside the request
  picks it up automatically.

This means audit-log entries created mid-request are traceable to the request
that produced them, and the value can't be forged from outside.

## Tenant scoping (admin route)

Scoping happens in the admin controller, after validation but before the query:

```ts
query.companyRef = user.companyRef.toString();
```

A caller-supplied `?companyRef=` is silently dropped — no error is returned, and
the request behaves as if the param was never sent. This is intentional:
returning a 400 would reveal that scoping exists and that other tenants have
rows, creating a side channel for tenant-existence probing.

```sh
grep -n "companyRef" src/modules/audit-logs/audit-log-admin.controller.ts
```

## Adding a new audit-log route

Gate write-like or management routes with `authorize(PERMISSIONS.AUDIT_LOGS_MANAGE)`
rather than the view permission. The admin role doesn't carry `:manage` — only
super-admin does (via the wildcard `"*"`).

## Errors

- `400 Bad Request` — validation failure, malformed ObjectId, `?search=` on
  admin, or `companyRef` regex mismatch
- `401 Unauthorized` — unauthenticated, or wrong role for the route
- `403 Forbidden` — authenticated but missing `audit-logs:view`
- `404 Not Found` — `/:id` row doesn't exist, or (admin) belongs to another
  tenant
- `500 Internal Server Error` — provider error, propagates via `next(error)`

## Manual verification

```sh
# Admin lists own tenant only
curl -s -b "token=$ADMIN_TOKEN" http://localhost:8000/api/admin/audit-logs | jq '.data.data | length'

# Admin attempts cross-tenant scope — silently dropped
curl -s -b "token=$ADMIN_TOKEN" "http://localhost:8000/api/admin/audit-logs?companyRef=$OTHER_TENANT_ID"

# Super-admin scopes to one tenant
curl -s -b "token=$SUPER_ADMIN_TOKEN" "http://localhost:8000/api/super-admin/audit-logs?companyRef=$TENANT_ID"

# Confirm X-Request-Id is server-generated, not client-supplied
curl -sI -b "token=$ADMIN_TOKEN" -H "X-Request-Id: client-spoof" http://localhost:8000/api/admin/audit-logs | grep -i x-request-id
```

The last command should return a UUID v4, NOT `client-spoof`.
