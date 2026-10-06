import { describe, expect, it } from "vitest";

import { PERMISSIONS, USER_TYPE } from "@/enums";
import { DEFAULT_ENVIRONMENT_ROLES } from "@/modules/roles/utils/roles.constant";

describe("DEFAULT_ENVIRONMENT_ROLES", () => {
  // authorize() no longer waves super-admin through on its role name, so the
  // role's own permission list is the only thing standing between a super-admin
  // and a 403. A slug added to the enum but not to the role would lock them out
  // of that route once WorkOS is synced.
  it("grants super-admin every permission in the enum", () => {
    const superAdmin = DEFAULT_ENVIRONMENT_ROLES.find(
      (role) => role.slug === USER_TYPE.SUPER_ADMIN,
    );

    expect(superAdmin).toBeDefined();

    const granted = new Set<string>(superAdmin?.permissions ?? []);
    const missing = Object.values(PERMISSIONS).filter(
      (permission) => !granted.has(permission),
    );

    expect(missing).toEqual([]);
  });

  it("does not grant admin the audit-log or error-log permissions beyond view", () => {
    const admin = DEFAULT_ENVIRONMENT_ROLES.find(
      (role) => role.slug === USER_TYPE.ADMIN,
    );

    const granted = new Set<string>(admin?.permissions ?? []);

    expect(granted.has(PERMISSIONS.AUDIT_LOGS_VIEW)).toBe(true);
    expect(granted.has(PERMISSIONS.AUDIT_LOGS_MANAGE)).toBe(false);
    expect(granted.has(PERMISSIONS.ERROR_LOGS_MANAGE)).toBe(false);
  });
});
