import { validationErrorHandler } from "@/helpers/validation-error";
import { PRIVILEGED_USER_ROLES } from "@/modules/roles/utils/roles.constant";
import {
  USER_ANALYTICS_DURATION,
  USER_ANALYTICS_TYPE,
} from "@/modules/users/utils/users.enum";
import { strongPasswordSchema } from "@/modules/auth/utils/auth.validation";
import z from "zod";
import { validate } from "zod-express-validator";

// ==================== Schemas ====================

export const NameSchema = z.object({
  first: z.string().optional(),
  last: z.string().optional(),
});

export const UpdateProfileBodySchema = z
  .object({
    name: NameSchema,
    images: z.string().optional(),
  })
  .refine((data) => data.name.first || data.name.last, {
    message: "At least first name or last name must be provided",
    path: ["name"],
  });

export const ChangePasswordBodySchema = z
  .object({
    currentPassword: z.string().min(1, "Current password is required"),
    newPassword: strongPasswordSchema,
    confirmedPassword: z.string().min(1, "Confirmed password is required"),
  })
  .refine((data) => data.newPassword === data.confirmedPassword, {
    message: "New password and confirmed password do not match",
    path: ["confirmedPassword"],
  });

export const GetUsersQuerySchema = z.object({
  page: z.coerce.number().optional(),
  pageSize: z.coerce.number().optional(),
  search: z.string().optional(),
});

export const ParamIdSchema = z.object({
  id: z.string().min(1, "ID is required"),
});

export const UpdateStatusBodySchema = z.object({
  status: z.string().min(1, "Status is required"),
});

export const ChangeUserRoleBodySchema = z.object({
  // Organizations define their own roles, so the slug cannot be enumerated
  // here — only the two nobody may grant themselves are refused up front.
  // The controller is what confirms the role exists for the company.
  role: z
    .string()
    .min(1, "Role is required")
    .refine((role) => !PRIVILEGED_USER_ROLES.includes(role), {
      message: "This role cannot be assigned.",
    }),
  userId: z.string().min(1, "User ID is required"),
});

export const UserAnalyticsQuerySchema = z.object({
  type: z.enum(USER_ANALYTICS_TYPE).optional(),
  duration: z.enum(USER_ANALYTICS_DURATION).optional(),
  year: z.coerce.number().optional(),
});

export const UpdateUserProfileBodySchema = z.object({
  update: z.object({
    name: z.object({
      first: z.string().min(1, "First name is required"),
      last: z.string().min(1, "Last name is required"),
    }),
  }),
  companyRef: z.string().min(1, "Company reference is required"),
});

export const ChangeUserPasswordBodySchema = z.object({
  currentPassword: z.string().min(1, "Current password is required"),
  newPassword: strongPasswordSchema,
  confirmedPassword: z.string().min(1, "Confirmed password is required"),
});

// ==================== Validation Schemas ====================

const UpdateProfileValidationSchema = {
  body: UpdateProfileBodySchema,
} as const;

const ChangePasswordValidationSchema = {
  body: ChangePasswordBodySchema,
} as const;

const MeValidationSchema = {} as const;

export const GetUsersValidationSchema = {
  query: GetUsersQuerySchema,
} as const;

export const GetOneValidationSchema = {
  params: ParamIdSchema,
} as const;

export const UpdateStatusValidationSchema = {
  params: ParamIdSchema,
  body: UpdateStatusBodySchema,
} as const;

export const ChangeUserRoleValidationSchema = {
  params: ParamIdSchema,
  body: ChangeUserRoleBodySchema,
} as const;

export const UserAnalyticsValidationSchema = {
  query: UserAnalyticsQuerySchema,
} as const;

export const ForcePasswordChangeValidationSchema = {
  params: ParamIdSchema,
} as const;

export const ForcePasswordChangeByCompanyValidationSchema = {
  params: ParamIdSchema,
} as const;

export const UpdateUserProfileValidationSchema = {
  params: ParamIdSchema,
  body: UpdateUserProfileBodySchema,
} as const;

export const ChangeUserPasswordValidationSchema = {
  params: ParamIdSchema,
  body: ChangeUserPasswordBodySchema,
} as const;

// ==================== Validators ====================

const updateProfileValidator = validate(
  UpdateProfileValidationSchema,
  validationErrorHandler,
);

const changePasswordValidator = validate(
  ChangePasswordValidationSchema,
  validationErrorHandler,
);

const meValidator = validate(MeValidationSchema, validationErrorHandler);

const getUsersValidator = validate(
  GetUsersValidationSchema,
  validationErrorHandler,
);

const getOneValidator = validate(
  GetOneValidationSchema,
  validationErrorHandler,
);

const updateStatusValidator = validate(
  UpdateStatusValidationSchema,
  validationErrorHandler,
);

const changeUserRoleValidator = validate(
  ChangeUserRoleValidationSchema,
  validationErrorHandler,
);

const userAnalyticsValidator = validate(
  UserAnalyticsValidationSchema,
  validationErrorHandler,
);

const emptyValidator = validate({}, validationErrorHandler);

const forcePasswordChangeValidator = validate(
  ForcePasswordChangeValidationSchema,
  validationErrorHandler,
);

const forcePasswordChangeByCompanyValidator = validate(
  ForcePasswordChangeByCompanyValidationSchema,
  validationErrorHandler,
);

const updateUserProfileValidator = validate(
  UpdateUserProfileValidationSchema,
  validationErrorHandler,
);

const changeUserPasswordValidator = validate(
  ChangeUserPasswordValidationSchema,
  validationErrorHandler,
);

export const userValidators = {
  updateProfile: updateProfileValidator,
  changePassword: changePasswordValidator,
  me: meValidator,
  getUsers: getUsersValidator,
  getOne: getOneValidator,
  updateStatus: updateStatusValidator,
  changeUserRole: changeUserRoleValidator,
  userAnalytics: userAnalyticsValidator,
  empty: emptyValidator,
  forcePasswordChange: forcePasswordChangeValidator,
  forcePasswordChangeByCompany: forcePasswordChangeByCompanyValidator,
  updateUserProfile: updateUserProfileValidator,
  changeUserPassword: changeUserPasswordValidator,
};
