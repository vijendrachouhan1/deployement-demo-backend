import { validationErrorHandler } from "@/helpers/validation-error";
import { USER_TYPE } from "@/enums";
import z from "zod";
import { validate } from "zod-express-validator";

// ==================== Schemas ====================

export const ParamIdSchema = z.object({
  id: z.string().min(1, "ID is required"),
});

export const EditCompanyBodySchema = z.record(z.string(), z.any());

export const UpdateCompanyBodySchema = z.record(z.string(), z.any());

export const ChangeUserRoleBodySchema = z.object({
  roles: z.enum(USER_TYPE),
  userId: z.string().min(1, "User ID is required"),
});

export const GetCompaniesQuerySchema = z
  .object({
    page: z.coerce.number().optional(),
    pageSize: z.coerce.number().optional(),
    searchValue: z.string().optional(),
  })
  .loose();

// ==================== Validation Schemas ====================

export const EditCompanyValidationSchema = {
  params: ParamIdSchema,
  body: EditCompanyBodySchema,
} as const;

export const UpdateCompanyValidationSchema = {
  params: ParamIdSchema,
  body: UpdateCompanyBodySchema,
} as const;

export const ChangeUserRoleValidationSchema = {
  params: ParamIdSchema,
  body: ChangeUserRoleBodySchema,
} as const;

export const GetCompaniesValidationSchema = {
  query: GetCompaniesQuerySchema,
} as const;

export const GetCompanyUsersValidationSchema = {
  params: ParamIdSchema,
  query: GetCompaniesQuerySchema,
} as const;

export const GetCompanyDetailsValidationSchema = {
  params: ParamIdSchema,
} as const;

// ==================== Validators ====================

const editCompanyValidator = validate(
  EditCompanyValidationSchema,
  validationErrorHandler,
);

const updateCompanyValidator = validate(
  UpdateCompanyValidationSchema,
  validationErrorHandler,
);

const changeUserRoleValidator = validate(
  ChangeUserRoleValidationSchema,
  validationErrorHandler,
);

const getCompaniesValidator = validate(
  GetCompaniesValidationSchema,
  validationErrorHandler,
);

const getCompanyUsersValidator = validate(
  GetCompanyUsersValidationSchema,
  validationErrorHandler,
);

const getCompanyDetailsValidator = validate(
  GetCompanyDetailsValidationSchema,
  validationErrorHandler,
);

export const companyValidators = {
  editCompany: editCompanyValidator,
  updateCompany: updateCompanyValidator,
  changeUserRole: changeUserRoleValidator,
  getCompanies: getCompaniesValidator,
  getCompanyUsers: getCompanyUsersValidator,
  getCompanyDetails: getCompanyDetailsValidator,
};
