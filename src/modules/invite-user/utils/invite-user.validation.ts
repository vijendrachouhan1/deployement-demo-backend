import { validationErrorHandler } from "@/helpers/validation-error";
import z from "zod";
import { validate } from "zod-express-validator";

// ==================== Schemas ====================

const InviteMultipleUsersBodySchema = z.object({
  users: z
    .array(
      z.object({
        email: z.email("Invalid email address"),
        firstName: z.string().min(1, "First name is required"),
        lastName: z.string().min(1, "Last name is required"),
      }),
    )
    .min(1, "At least one user is required"),
});

const ResendInvitesBodySchema = z.object({
  email: z.email("Invalid email address"),
});

const SoftDeleteUsersBodySchema = z.object({
  Status: z.string().min(1, "Status is required"),
  companyRef: z.string().min(1, "Company reference is required"),
});

const ParamIdSchema = z.object({
  id: z.string().min(1, "ID is required"),
});

const GetInvitedUsersQuerySchema = z.object({
  page: z.string().optional(),
  pageSize: z.string().optional(),
  search: z.string().optional(),
  status: z.string().optional(),
  companyRef: z.string().optional(),
});

// ==================== Validation Schemas ====================

const InviteMultipleUsersValidationSchema = {
  body: InviteMultipleUsersBodySchema,
} as const;

const ResendInvitesValidationSchema = {
  body: ResendInvitesBodySchema,
} as const;

const SoftDeleteUsersValidationSchema = {
  params: ParamIdSchema,
  body: SoftDeleteUsersBodySchema,
} as const;

const ParamIdValidationSchema = {
  params: ParamIdSchema,
} as const;

const GetInvitedUsersValidationSchema = {
  query: GetInvitedUsersQuerySchema,
} as const;

// ==================== Validators ====================

const inviteMultipleUsersValidator = validate(
  InviteMultipleUsersValidationSchema,
  validationErrorHandler,
);

const resendInvitesValidator = validate(
  ResendInvitesValidationSchema,
  validationErrorHandler,
);

const softDeleteUsersValidator = validate(
  SoftDeleteUsersValidationSchema,
  validationErrorHandler,
);

const cancelInviteValidator = validate(
  ParamIdValidationSchema,
  validationErrorHandler,
);

const getInvitedUsersValidator = validate(
  GetInvitedUsersValidationSchema,
  validationErrorHandler,
);

const getUsersWithAcceptedInvitationValidator = validate(
  GetInvitedUsersValidationSchema,
  validationErrorHandler,
);

const getUsersCountValidator = validate({}, validationErrorHandler);

export const inviteUserValidators = {
  inviteMultipleUsers: inviteMultipleUsersValidator,
  resendInvites: resendInvitesValidator,
  softDeleteUsers: softDeleteUsersValidator,
  cancelInvite: cancelInviteValidator,
  getInvitedUsers: getInvitedUsersValidator,
  getUsersWithAcceptedInvitation: getUsersWithAcceptedInvitationValidator,
  getUsersCount: getUsersCountValidator,
};
