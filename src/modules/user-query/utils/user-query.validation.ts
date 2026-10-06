import { USER_QUERY_SUBJECT } from "@/modules/user-query/utils/user-query.enum";
import { validationErrorHandler } from "@/helpers/validation-error";
import z from "zod";
import { validate } from "zod-express-validator";

const nameSchema = z.object({
  first: z.string().min(1, "First name is required"),
  last: z.string().min(1, "Last name is required"),
});

const CreateUserQueryBodySchema = z.object({
  name: nameSchema,
  email: z.email("Invalid email address"),
  subject: z.enum(USER_QUERY_SUBJECT),
  message: z.string().min(1, "Message is required"),
});

const ParamIdSchema = z.object({
  id: z.string().min(1, "ID is required"),
});

const QueryIdParamSchema = z.object({
  queryId: z.string().min(1, "Query ID is required"),
});

const UpdateQueryBodySchema = z.object({
  status: z.string().optional(),
});

const SendEmailBodySchema = z.object({
  message: z.string().min(1, "Message is required"),
  bccEmails: z.array(z.email()).optional(),
  ccEmails: z.array(z.email()).optional(),
  subject: z.string().optional(),
});

// ==================== Validation Schemas ====================

const CreateUserQueryValidationSchema = {
  body: CreateUserQueryBodySchema,
} as const;

export const GetAllUserQueriesValidationSchema = {
  query: z.object({
    page: z.string().optional(),
    size: z.string().optional(),
    search: z.string().optional(),
    subjects: z.string().optional(),
    status: z.string().optional(),
    dateFrom: z.string().optional(),
    dateTo: z.string().optional(),
    sortBy: z.string().optional(),
    sortOrder: z.enum(["asc", "desc"]).optional(),
  }),
} as const;

const GetUserQueryByIdValidationSchema = {
  params: z.object({
    id: z.string().min(1, "ID is required"),
  }),
} as const;

const UpdateValidationSchema = {
  params: ParamIdSchema,
  body: UpdateQueryBodySchema,
} as const;

const DeleteValidationSchema = {
  params: ParamIdSchema,
} as const;

const SendEmailValidationSchema = {
  params: QueryIdParamSchema,
  body: SendEmailBodySchema,
} as const;

// ==================== Validators ====================

export const createUserQueryValidator = validate(
  CreateUserQueryValidationSchema,
  validationErrorHandler,
);

export const getAllUserQueriesValidator = validate(
  GetAllUserQueriesValidationSchema,
  validationErrorHandler,
);

export const getUserQueryByIdValidator = validate(
  GetUserQueryByIdValidationSchema,
  validationErrorHandler,
);

export const updateValidator = validate(
  UpdateValidationSchema,
  validationErrorHandler,
);

export const deleteValidator = validate(
  DeleteValidationSchema,
  validationErrorHandler,
);

export const sendEmailValidator = validate(
  SendEmailValidationSchema,
  validationErrorHandler,
);

export const userQueryValidators = {
  createUserQuery: createUserQueryValidator,
  getAllUserQueries: getAllUserQueriesValidator,
  getUserQueryById: getUserQueryByIdValidator,
  update: updateValidator,
  delete: deleteValidator,
  sendEmail: sendEmailValidator,
};
