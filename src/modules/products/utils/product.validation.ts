import { validationErrorHandler } from "@/helpers/validation-error";
import z from "zod";
import { validate } from "zod-express-validator";

// ==================== Schemas ====================

export const GetProductsQuerySchema = z.object({
  page: z.coerce.number().optional(),
  pageSize: z.coerce.number().optional(),
  searchValue: z.string().optional(),
  sortBy: z.string().optional(),
});

const GetProductByIdParamsSchema = z.object({
  id: z.string().min(1, "Product ID is required"),
});

export const CreateProductBodySchema = z.object({
  title: z.string().min(3).max(100),
  description: z.string().max(500),
  price: z.coerce.number().min(0),
  costPrice: z.coerce.number().min(0).optional(),
  retailPrice: z.coerce.number().min(0).optional(),
  salePrice: z.coerce.number().min(0).optional(),
  companyRef: z.string().optional(),
});

export const UpdateProductBodySchema = CreateProductBodySchema.partial();

// ==================== Validation Schemas ====================

const GetProductsValidationSchema = {
  query: GetProductsQuerySchema,
} as const;

const GetProductByIdValidationSchema = {
  params: GetProductByIdParamsSchema,
} as const;

export const CreateProductValidationSchema = {
  body: CreateProductBodySchema,
  query: z.object({
    notifySubscribers: z
      .string()
      .optional()
      .transform((value) => value === "true"),
  }),
} as const;

const UpdateProductValidationSchema = {
  body: UpdateProductBodySchema,
  params: z.object({ id: z.string() }),
} as const;

const DeleteProductValidationSchema = {
  params: z.object({ id: z.string() }),
} as const;

// ==================== Validators ====================

const getProductsValidator = validate(
  GetProductsValidationSchema,
  validationErrorHandler,
);

const getProductByIdValidator = validate(
  GetProductByIdValidationSchema,
  validationErrorHandler,
);

const createProductValidator = validate(
  CreateProductValidationSchema,
  validationErrorHandler,
);

const updateProductValidator = validate(
  UpdateProductValidationSchema,
  validationErrorHandler,
);

const deleteProductValidator = validate(
  DeleteProductValidationSchema,
  validationErrorHandler,
);

export const productValidators = {
  getProducts: getProductsValidator,
  getProductById: getProductByIdValidator,
  createProduct: createProductValidator,
  updateProduct: updateProductValidator,
  deleteProduct: deleteProductValidator,
};
