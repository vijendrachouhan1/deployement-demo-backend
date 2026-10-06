import { PERMISSIONS } from "@/enums";
import { validationErrorHandler } from "@/helpers/validation-error";
import z from "zod";
import { validate } from "zod-express-validator";

const permissionValues = Object.values(PERMISSIONS) as [
  PERMISSIONS,
  ...PERMISSIONS[],
];

const PermissionSchema = z.enum(permissionValues);

const RoleSlugSchema = z.string().min(1, "Role slug is required.");

export const CreateRoleBodySchema = z.object({
  slug: RoleSlugSchema,
  name: z.string().min(1, "Role name is required."),
  description: z.string().optional(),
  permissions: z
    .array(PermissionSchema)
    .default([])
    .refine((permissions) => new Set(permissions).size === permissions.length, {
      message: "Permissions must not contain duplicates.",
    }),
});

export const UpdateRoleBodySchema = z
  .object({
    name: z.string().min(1, "Role name is required.").optional(),
    description: z.string().optional(),
    permissions: z
      .array(PermissionSchema)
      .optional()
      .refine(
        (permissions) =>
          permissions === undefined ||
          new Set(permissions).size === permissions.length,
        {
          message: "Permissions must not contain duplicates.",
        },
      ),
  })
  .refine(
    (body) =>
      body.name !== undefined ||
      body.description !== undefined ||
      body.permissions !== undefined,
    {
      message: "Provide at least one field to update.",
    },
  );

const RoleSlugParamSchema = z.object({
  slug: RoleSlugSchema,
});

const CreateRoleValidationSchema = {
  body: CreateRoleBodySchema,
} as const;

const UpdateRoleValidationSchema = {
  params: RoleSlugParamSchema,
  body: UpdateRoleBodySchema,
} as const;

const DeleteRoleValidationSchema = {
  params: RoleSlugParamSchema,
} as const;

export const rolesValidators = {
  create: validate(CreateRoleValidationSchema, validationErrorHandler),
  update: validate(UpdateRoleValidationSchema, validationErrorHandler),
  delete: validate(DeleteRoleValidationSchema, validationErrorHandler),
};
