import { validationErrorHandler } from "@/helpers/validation-error";
import { DURATION } from "@/modules/stripe-payment/utils/stripe-payment.enum";
import { isValidObjectId } from "mongoose";
import z from "zod";
import { validate } from "zod-express-validator";

// ==================== Schemas ====================

const ProductQuerySchema = z.object({
  page: z.string().optional(),
  pageSize: z.string().optional(),
  search: z.string().optional(),
});

const PastOrdersQuerySchema = z.object({
  page: z.string().optional(),
  pageSize: z.string().optional(),
  search: z.string().optional(),
});

const RefundParamSchema = z.object({
  id: z
    .string()
    .min(1, "ID is required")
    .refine(isValidObjectId, "ID must be a valid ObjectId"),
});

// Cast straight to an ObjectId downstream; a non-hex string throws a 500.
const CreateCheckoutSessionBodySchema = z.object({
  productId: z
    .string()
    .min(1, "Product ID is required")
    .refine(isValidObjectId, "Product ID must be a valid ObjectId"),
});

const SessionStatusQuerySchema = z.object({
  sessionId: z.string().min(1, "Session ID is required"),
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
  price: z.union([z.number(), z.string()]).optional(),
});

const ParamIdSchema = z.object({
  id: z.string().min(1, "ID is required"),
});

const GetEarningChartQuerySchema = z.object({
  type: z.enum([DURATION.MONTHLY, DURATION.YEARLY, DURATION.WEEKLY]),
});

const CreateCouponBodySchema = z
  .object({
    name: z.string().min(1, "Name is required"),
    duration: z.enum(["forever", "once", "repeating"]),
    amount_off: z.number().int().min(1).optional(),
    currency: z.string().optional(),
    percent_off: z.number().int().min(1).max(100).optional(),
    duration_in_months: z.number().int().min(1).optional(),
    max_redemptions: z.number().int().min(1).optional(),
    redeem_by: z
      .number()
      .int()
      .min(Math.floor(Date.now() / 1000))
      .optional(),
  })
  .refine(
    (data) => {
      if (data.amount_off !== undefined && data.percent_off !== undefined) {
        return false;
      }
      return true;
    },
    {
      message: "Both Amount off and percent off cannot be present.",
      path: ["amount_off"],
    },
  )
  .refine(
    (data) => {
      if (data.amount_off !== undefined && !data.currency) {
        return false;
      }
      return true;
    },
    {
      message: "Currency is required with amount_off",
      path: ["currency"],
    },
  )
  .refine(
    (data) => {
      if (data.duration === "repeating" && !data.duration_in_months) {
        return false;
      }
      return true;
    },
    {
      message: "duration_in_months is required when duration is repeating",
      path: ["duration_in_months"],
    },
  );

const EditCouponBodySchema = z.object({
  name: z.string().min(1, "Name is required"),
});

const CouponIdParamSchema = z.object({
  couponId: z.string().min(1, "Coupon ID is required"),
});

const CreatePromotionCodeBodySchema = z.object({
  coupon: z.string().min(1, "Coupon ID is required"),
  code: z.string().min(1, "Code is required"),
  expires_at: z.number().int().optional(),
  max_redemptions: z.number().int().optional(),
});

const PromotionCodeIdParamSchema = z.object({
  promotionCodeId: z.string().min(1, "Promotion Code ID is required"),
});

const UpdatePromotionCodeBodySchema = z.object({
  active: z.boolean().optional(),
});

const PaginationQuerySchema = z.object({
  limit: z.string().optional(),
  starting_after: z.string().optional(),
  ending_before: z.string().optional(),
  page: z.string().optional(),
  pageSize: z.string().optional(),
  search: z.string().optional(),
});

// ==================== Validators ====================

const productValidator = validate(
  { query: ProductQuerySchema },
  validationErrorHandler,
);

const pastOrdersValidator = validate(
  { query: PastOrdersQuerySchema },
  validationErrorHandler,
);

const refundValidator = validate(
  { params: RefundParamSchema },
  validationErrorHandler,
);

const createCheckoutSessionValidator = validate(
  { body: CreateCheckoutSessionBodySchema },
  validationErrorHandler,
);

const sessionStatusValidator = validate(
  { query: SessionStatusQuerySchema },
  validationErrorHandler,
);

const emptyValidator = validate({}, validationErrorHandler);

const createProductValidator = validate(
  { body: CreateProductBodySchema },
  validationErrorHandler,
);

const editProductValidator = validate(
  { params: ParamIdSchema, body: EditProductBodySchema },
  validationErrorHandler,
);

const deleteProductValidator = validate(
  { params: ParamIdSchema },
  validationErrorHandler,
);

const getEarningChartValidator = validate(
  { query: GetEarningChartQuerySchema },
  validationErrorHandler,
);

const createCouponValidator = validate(
  { body: CreateCouponBodySchema },
  validationErrorHandler,
);

const listCouponsValidator = validate(
  { query: PaginationQuerySchema },
  validationErrorHandler,
);

const getCouponValidator = validate(
  { params: CouponIdParamSchema },
  validationErrorHandler,
);

const editCouponValidator = validate(
  { params: CouponIdParamSchema, body: EditCouponBodySchema },
  validationErrorHandler,
);

const deleteCouponValidator = validate(
  { params: CouponIdParamSchema },
  validationErrorHandler,
);

const createPromotionCodeValidator = validate(
  { body: CreatePromotionCodeBodySchema },
  validationErrorHandler,
);

const listPromotionCodesValidator = validate(
  { params: CouponIdParamSchema, query: PaginationQuerySchema },
  validationErrorHandler,
);

const updatePromotionCodeValidator = validate(
  { params: PromotionCodeIdParamSchema, body: UpdatePromotionCodeBodySchema },
  validationErrorHandler,
);

const getTransactionsValidator = validate(
  { query: PaginationQuerySchema },
  validationErrorHandler,
);

const countTransactionsValidator = validate({}, validationErrorHandler);
const exportTransactionsValidator = validate({}, validationErrorHandler);

export const stripePaymentValidators = {
  product: productValidator,
  pastOrders: pastOrdersValidator,
  refundOrder: refundValidator,
  createCheckoutSession: createCheckoutSessionValidator,
  sessionStatus: sessionStatusValidator,

  createProduct: createProductValidator,
  editProduct: editProductValidator,
  deleteProduct: deleteProductValidator,
  getEarningChart: getEarningChartValidator,
  createCoupon: createCouponValidator,
  listCoupons: listCouponsValidator,
  getCoupon: getCouponValidator,
  editCoupon: editCouponValidator,
  deleteCoupon: deleteCouponValidator,
  createPromotionCode: createPromotionCodeValidator,
  listPromotionCodes: listPromotionCodesValidator,
  updatePromotionCode: updatePromotionCodeValidator,
  getTransactions: getTransactionsValidator,
  countTransactions: countTransactionsValidator,
  exportTransactions: exportTransactionsValidator,
  ordersCount: emptyValidator,
};
