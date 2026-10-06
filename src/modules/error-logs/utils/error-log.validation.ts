import { ERROR_TYPE } from "@/enums";
import { SORT_BY } from "@/modules/error-logs/utils/error-log.enum";
import { validationErrorHandler } from "@/helpers/validation-error";
import z from "zod";
import { validate } from "zod-express-validator";

// ==================== Schemas ====================

export const ParamIdSchema = z.object({
  id: z.string().min(1, "ID is required"),
});

export const GetErrorsQuerySchema = z
  .object({
    errorType: z.enum([ERROR_TYPE.GENERIC, ERROR_TYPE.EMAIL]),
    sortBy: z.enum([SORT_BY.OLDEST, SORT_BY.NEWEST]),
    page: z.coerce.number().optional(),
    pageSize: z.coerce.number().optional(),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
  })
  .passthrough();

export const UpdateImportantFlagBodySchema = z.object({
  isImportantFlag: z.boolean(),
});

export const LoginBodySchema = z.object({
  email: z.string().email("Invalid email format"),
  password: z.string().min(1, "Password is required"),
});

// ==================== Validation Schemas ====================

export const GetErrorsValidationSchema = {
  query: GetErrorsQuerySchema,
} as const;

export const UpdateImportantFlagValidationSchema = {
  params: ParamIdSchema,
  body: UpdateImportantFlagBodySchema,
} as const;

export const LoginValidationSchema = {
  body: LoginBodySchema,
} as const;

// ==================== Validators ====================

const getErrorsValidator = validate(
  GetErrorsValidationSchema,
  validationErrorHandler,
);

const updateImportantFlagValidator = validate(
  UpdateImportantFlagValidationSchema,
  validationErrorHandler,
);

const loginValidator = validate(LoginValidationSchema, validationErrorHandler);

export const errorLogValidators = {
  getErrors: getErrorsValidator,
  updateImportantFlag: updateImportantFlagValidator,
  login: loginValidator,
};
