# Audit Logs — Emitting on Critical Mutations

This runbook covers how sensitive mutations (user status/role changes, password
operations, role management, auth events) write an audit-log entry, and the
rules to follow when adding a new one.

## Audited routes

| Route                                                   | Action                                 | targetType | Notes                                                                                                                                                              |
| ------------------------------------------------------- | -------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `PUT /api/admin/user/status/:id`                        | `user.status.changed`                  | `User`     | `changes: [{ field: "status", before, after }]`                                                                                                                    |
| `PUT /api/admin/user/user-role/:id`                     | `user.role.changed`                    | `User`     | `changes: [{ field: "roles", before, after }]`                                                                                                                     |
| `PUT /api/admin/user/force-password-change/:id`         | `user.password.force_change`           | `User`     | `changes: [{ field: "forcePasswordChange", before: false, after: true }]`                                                                                          |
| `PUT /api/admin/user/force-password-change/company/:id` | `company.force_password_change`        | `Company`  | `metadata: { affectedUserCount: n }`                                                                                                                               |
| `PUT /api/super-admin/users/user-profile/:id`           | `user.profile.updated`                 | `User`     | `changes` excludes `password*`/`secret*`/`token*`/`hash*`                                                                                                          |
| `POST /api/super-admin/users/change-password/:id`       | `user.password.changed_by_super_admin` | `User`     | `targetId` only — NO body content                                                                                                                                  |
| `PUT /api/super-admin/company/change-user-role/:id`     | `company.user.role.changed`            | `User`     | `changes: [{ field: "roles", before, after }]`                                                                                                                     |
| `POST /api/admin/roles`                                 | `role.created`                         | `Role`     | `metadata: { slug, name, permissionCount }`                                                                                                                        |
| `PUT /api/admin/roles/:slug`                            | `role.updated`                         | `Role`     | `metadata: { slug }`                                                                                                                                               |
| `DELETE /api/admin/roles/:slug`                         | `role.deleted`                         | `Role`     | `metadata: { slug }`                                                                                                                                               |
| `POST /api/auth/login` (success)                        | `user.login.success`                   | —          | category `authentication`, tenant chain                                                                                                                            |
| `POST /api/auth/login` (failure)                        | `user.login.failure`                   | —          | category `authentication`, AUTH sentinel chain, `failureReason` sanitized to one of: `Invalid credentials`, `Account inactive`, `Company inactive`, `MFA required` |
| `POST /api/auth/login` (MFA challenge)                  | `user.login.mfa_required`              | —          | informational success; tenant chain                                                                                                                                |
| `POST /api/auth/logout`                                 | `user.logout`                          | —          | category `authentication`, tenant chain                                                                                                                            |

## Emit pattern (template)

```ts
import { safeEmit, summarizeFailureReason } from "@/providers/audit-logs";

try {
  const oldRow = await Model.findById(id).lean(); // for "before" if needed
  const data = await someHelper.mutate(id, body);
  safeEmit({
    action: "resource.verb",
    status: "success",
    targetType: "Model",
    targetId: id,
    changes: [
      { field: "fieldName", before: oldRow?.fieldName, after: body.fieldName },
    ],
  });
  return SuccessResponse(res, status.OK, { data });
} catch (error) {
  safeEmit({
    action: "resource.verb",
    status: "failure",
    targetType: "Model",
    targetId: id,
    failureReason: summarizeFailureReason(error),
  });
  next(error);
}
```

## Rules

1. **Success emit AFTER the DB write succeeds**, BEFORE `SuccessResponse`.
2. **Failure emit INSIDE the catch**, BEFORE `next(error)`.
3. **NEVER serialize a password** (raw or hashed) into `metadata`, `changes`, or
   `failureReason`. For password-related actions, emit `targetId` only.
4. **NEVER differentiate `failureReason` between "user not found" and "wrong
   password"** in the auth flow. Both → `"Invalid credentials"`. This prevents
   attackers from discovering which emails have accounts (user enumeration).
5. **Login-failure emits wrap in `runWithSubsystem(SystemSubsystem.AUTH, ...)`**
   because there is no authenticated user yet. The wrap routes the entry to the
   AUTH sentinel chain (`SYSTEM_SUBSYSTEM_REFS[AUTH]`).
6. **`targetType` uses PascalCase model names** (`"User"`, `"Role"`,
   `"Company"`) — matching the Mongo model names.
7. **`safeEmit` is fire-and-forget.** It never blocks or fails the response. A
   bad `targetId` cast is logged to `console.error` and the request continues
   normally.

## Verification

```sh
# every audited controller has at least one safeEmit
grep -rn "safeEmit(" src/modules/users/admin.controller.ts \
  src/modules/users/super-admin.controller.ts \
  src/modules/company/company-super-admin.controller.ts \
  src/modules/roles/roles.controller.ts \
  src/modules/auth/auth.controller.ts

# login failure paths wrap in the AUTH subsystem
grep -rn "runWithSubsystem(SystemSubsystem.AUTH" src/modules/auth/auth.controller.ts
```

## Not yet audited

These surfaces don't emit audit entries yet. Add them with the pattern above
when they become relevant:

- General company updates (`company/admin.controller.ts` → `updateCompany`)
- Athena query POST (`audit-log-super-admin.controller.ts`)
- Commerce surfaces: products, stripe-connect, subscription
- Sign-up and password-reset flows
- MFA enrollment / disable / recovery
- Cron and system mutation events
- Webhook-driven mutations (e.g. Stripe Connect renewals)
- Tenant-admin self-mutations (an admin editing their own profile)
