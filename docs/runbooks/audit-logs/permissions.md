# Audit Logs — Permissions and Role Grants

Access to audit-log endpoints is controlled by permission slugs granted to
roles. Super-admin authority is modeled as an explicit, enumerated permission
list on the role rather than a hardcoded role check in middleware.

## Permission slugs

| Slug                | Enum member                     | Purpose                                                                                                                                                                             |
| ------------------- | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `audit-logs:view`   | `PERMISSIONS.AUDIT_LOGS_VIEW`   | List and read individual audit-log entries through the read endpoints.                                                                                                              |
| `audit-logs:manage` | `PERMISSIONS.AUDIT_LOGS_MANAGE` | Required by `GET /super-admin/audit-logs/chain/verify` (`src/modules/audit-logs/index.ts:81`). Only the super-admin role holds it — the admin grant filter excludes `audit-logs:*`. |

There is intentionally **no** `audit-logs:write` slug. Audit logs are
append-only by chain construction, so there is no admin mutation surface to
authorize.

## Role grants

| Role          | Audit-log grants                          | Other grants                                                              |
| ------------- | ----------------------------------------- | ------------------------------------------------------------------------- |
| `super-admin` | `audit-logs:view` and `audit-logs:manage` | `Object.values(PERMISSIONS)` — every slug in the enum, listed explicitly. |
| `admin`       | `audit-logs:view` (explicit entry)        | All `*:manage` permissions except `error-logs:*` and `audit-logs:*`.      |
| `user`        | none                                      | Existing curated set (cards, chat, products, rag, etc.).                  |
| `system`      | none                                      | Whatever the SYSTEM role's WorkOS-side configuration says.                |

`audit-logs:view` is added to the admin role as an explicit entry, because the
admin grant filter matches `*:manage` slugs and would otherwise skip a `:view`
slug.

## Why super-admin uses an explicit list instead of a role bypass

`authorize()` does not short-circuit authorization on the role name. The
`super-admin` role carries every slug in the `PERMISSIONS` enum
(`src/modules/roles/utils/roles.constant.ts`), those slugs ride in the JWT, and
`canAccess()` evaluates them like any other role's. Two reasons:

1. **WorkOS stays the single source of truth.** Auditing "who has god-mode" is a
   matter of checking the role's permissions, not grepping middleware code.
2. **Role renames don't silently break security.** With a hardcoded role check,
   renaming the super-admin role would require a middleware change; missing it
   would leave a hole. A permission-based check has no such coupling.

There is no wildcard slug. `canAccess()` has no `"*"` branch, and adding one
would put the escape hatch back where it cannot be enumerated.

### There is no override

A super-admin whose role is missing a required permission is denied like anyone
else, and there is no flag or emergency route that changes that. The realistic
cause is drift — a slug added to the enum and used on a route, with
`npm run roles:sync` not yet run, so WorkOS and the JWT don't carry it.

**The recovery is to run the sync**, then re-login or wait for the token to
refresh. Nothing in the codebase will let a super-admin past `canAccess()` in
the meantime, so treat the run order below as mandatory rather than routine: a
route whose permission has not reached WorkOS is unreachable by everyone,
including super-admins, until it does.

`src/modules/roles/__tests__/default-roles.test.ts` is what keeps this from
being a surprise. It fails the moment a slug exists in `PERMISSIONS` without
being in the super-admin grant, which is the state that would otherwise reach
production and lock the route.

## Deploy step — sync roles to WorkOS

After changing role/permission mappings, sync them to WorkOS:

```sh
npm run roles:sync
```

This runs `src/scripts/create-roles-and-permissions.ts`, which upserts every
`PERMISSIONS` enum entry into WorkOS and sets the permission list for each
default role. Without it, WorkOS roles still carry the old permission list and
the JWT `permissions` claim issued at login won't include the new audit-log
entries.

**Run order:**

1. Deploy the backend code with the new enum and role constants.
2. Run `npm run roles:sync` once per environment that has its own WorkOS
   workspace (dev, staging, prod).
3. Sessions issued before the sync won't have the new permissions in their JWT —
   users must re-login or wait for the access token to refresh (~15 min by
   default).

`roles:sync` is idempotent — re-running just re-issues the same upserts.

## What NOT to do

- Do not re-introduce a role-based shortcut in `authorize()` or any other
  middleware. There is deliberately no escape hatch — the fix for a missing
  permission is to grant it and sync, not to bypass the check.
- Do not introduce a wildcard slug (e.g. `PERMISSIONS.WILDCARD = "*"`) or a `"*"`
  branch in `canAccess()`. A permission that cannot be enumerated cannot be
  reviewed, which is the whole point of the explicit list.
- Do not add a slug to `PERMISSIONS` without adding it to the super-admin grant.
  `src/modules/roles/__tests__/default-roles.test.ts` fails if you do.
- Do not run `roles:sync` from CI, `postinstall`, or any automated hook. It is a
  deliberate operator action.

## Verification

After `roles:sync` runs cleanly, confirm in WorkOS (dashboard or API) that:

- `audit-logs:view` and `audit-logs:manage` permissions exist
- the `super-admin` role lists every permission in the enum
- the `admin` role's permission set includes `audit-logs:view`

Then log in as an admin, decode the JWT `permissions` claim, and confirm
`audit-logs:view` is present. Repeat as super-admin and confirm the claim
carries the full list.

The sharpest single check is `GET /super-admin/audit-logs/chain/verify`: it
requires `audit-logs:manage`, which only the super-admin role holds, so it is the
first route to break if a sync is stale.
