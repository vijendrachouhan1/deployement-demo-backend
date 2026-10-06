import { validationErrorHandler } from "@/helpers/validation-error";
import { isValidObjectId } from "mongoose";
import { DURATION } from "@/modules/stripe-connect/utils/stripe-connect.enum";
import z from "zod";
import { validate } from "zod-express-validator";

// ==================== Schemas ====================

const ProductQuerySchema = z.object({
  page: z.string().optional(),
  pageSize: z.string().optional(),
  search: z.string().optional(),
});

const CreatePaymentIntentBodySchema = z.object({
  productId: z
    .string()
    .min(1, "Product ID is required")
    .refine(isValidObjectId, "Product ID must be a valid ObjectId"),
});

// Cast straight to an ObjectId downstream; a non-hex string throws a 500.
const RefundParamSchema = z.object({
  id: z
    .string()
    .min(1, "ID is required")
    .refine(isValidObjectId, "ID must be a valid ObjectId"),
});

const PastOrdersQuerySchema = z.object({
  page: z.string().optional(),
  pageSize: z.string().optional(),
  search: z.string().optional(),
});

const CreateAccountSessionBodySchema = z.object({
  accountId: z.string().min(1, "Account ID is required"),
});

const CreateProductBodySchema = z.object({
  title: z.string().min(1, "Title is required"),
  price: z
    .union([z.number(), z.string()])
    .refine((val) => !isNaN(Number(val)), {
      message: "Price must be a valid number",
    }),
});

const EditProductBodySchema = z.object({
  title: z.string().optional(),
  price: z
    .union([z.number(), z.string()])
    .optional()
    .refine((val) => val === undefined || !isNaN(Number(val)), {
      message: "Price must be a valid number",
    }),
});

const GetEarningsQuerySchema = z.object({
  type: z.enum(DURATION),
});

const PaginationQuerySchema = z.object({
  limit: z.coerce.number().optional(),
  starting_after: z.string().optional(),
  ending_before: z.string().optional(),
  page: z.coerce.number().optional(),
  pageSize: z.coerce.number().optional(),
  search: z.string().optional(),
});

const ParamIdSchema = z.object({
  id: z.string().min(1, "ID is required"),
});

// ==================== Validation Schemas ====================

const ProductValidationSchema = {
  query: ProductQuerySchema,
} as const;

const CreatePaymentIntentValidationSchema = {
  body: CreatePaymentIntentBodySchema,
} as const;

const RefundValidationSchema = {
  params: RefundParamSchema,
} as const;

const PastOrdersValidationSchema = {
  query: PastOrdersQuerySchema,
} as const;

const CreateAccountSessionValidationSchema = {
  body: CreateAccountSessionBodySchema,
} as const;

const CreateProductValidationSchema = {
  body: CreateProductBodySchema,
} as const;

const EditProductValidationSchema = {
  params: ParamIdSchema,
  body: EditProductBodySchema,
} as const;

const GetEarningsValidationSchema = {
  query: GetEarningsQuerySchema,
} as const;

const PaginationValidationSchema = {
  query: PaginationQuerySchema,
} as const;

const ParamIdValidationSchema = {
  params: ParamIdSchema,
} as const;

// ==================== Validators ====================
const productValidator = validate(
  ProductValidationSchema,
  validationErrorHandler,
);
const createPaymentIntentValidator = validate(
  CreatePaymentIntentValidationSchema,
  validationErrorHandler,
);
const refundOrderValidator = validate(
  RefundValidationSchema,
  validationErrorHandler,
);
const pastOrdersValidator = validate(
  PastOrdersValidationSchema,
  validationErrorHandler,
);
const createAccountSessionValidator = validate(
  CreateAccountSessionValidationSchema,
  validationErrorHandler,
);
const createProductValidator = validate(
  CreateProductValidationSchema,
  validationErrorHandler,
);
const editProductValidator = validate(
  EditProductValidationSchema,
  validationErrorHandler,
);
const getEarningsValidator = validate(
  GetEarningsValidationSchema,
  validationErrorHandler,
);
const paginationValidator = validate(
  PaginationValidationSchema,
  validationErrorHandler,
);
const paramIdValidator = validate(
  ParamIdValidationSchema,
  validationErrorHandler,
);
const emptyValidator = validate({}, validationErrorHandler);

export const stripeConnectValidators = {
  product: productValidator,
  createPaymentIntent: createPaymentIntentValidator,
  refundOrder: refundOrderValidator,
  pastOrders: pastOrdersValidator,
  pastOrdersCount: emptyValidator,
  createCustomer: emptyValidator,
  getCustomer: emptyValidator,

  vendorDetails: emptyValidator,
  createAccount: emptyValidator,
  createAccountSession: createAccountSessionValidator,
  createDashboardLink: emptyValidator,
  transferredTransactions: paginationValidator,
  getAllTransactions: paginationValidator,
  getEarningDetails: emptyValidator,
  getTransactionDetails: paginationValidator,
  createProduct: createProductValidator,
  editProduct: editProductValidator,
  deleteProduct: paramIdValidator,
  getEarnings: getEarningsValidator,
  countTransactionByStatus: emptyValidator,
  exportTransactions: emptyValidator,

  getTransactions: paginationValidator,
  countTransactions: emptyValidator,
  getAllVendors: paginationValidator,
};
