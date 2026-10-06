import { USER_TYPE } from "@/enums";
import { ChangeUserRoleBodySchema } from "@/modules/users/utils/users.validation";
import { describe, expect, it } from "vitest";

const USER_ID = "68b1f0c2a1d4e5f6a7b8c9d0";

describe("ChangeUserRoleBodySchema", () => {
  it.each([USER_TYPE.SUPER_ADMIN, USER_TYPE.SYSTEM])(
    "rejects the privileged role %s",
    (role) => {
      const result = ChangeUserRoleBodySchema.safeParse({
        role,
        userId: USER_ID,
      });

      expect(result.success).toBe(false);
    },
  );

  it.each([USER_TYPE.ADMIN, USER_TYPE.USER])(
    "accepts the default role %s",
    (role) => {
      const result = ChangeUserRoleBodySchema.safeParse({
        role,
        userId: USER_ID,
      });

      expect(result.success).toBe(true);
    },
  );

  // GET /admin/roles offers every org role, so an enum here would 400 a slug
  // the picker just listed. Whether it exists is the controller's question.
  it("accepts a role slug the organization defined itself", () => {
    const result = ChangeUserRoleBodySchema.safeParse({
      role: "org-billing-manager",
      userId: USER_ID,
    });

    expect(result.success).toBe(true);
  });

  it("rejects an empty role", () => {
    const result = ChangeUserRoleBodySchema.safeParse({
      role: "",
      userId: USER_ID,
    });

    expect(result.success).toBe(false);
  });
});
