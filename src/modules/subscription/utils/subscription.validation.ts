import { validationErrorHandler } from "@/helpers/validation-error";
import z from "zod";
import { validate } from "zod-express-validator";

// ==================== Schemas ====================

const CreateSubscriptionBodySchema = z.object({
  priceId: z.string().min(1, "Price ID is required"),
});

const CancelSubscriptionBodySchema = z.object({
  subId: z.string().min(1, "Subscription ID is required"),
});

const ChangeSubscriptionBodySchema = z.object({
  newPriceId: z.string().min(1, "New price ID is required"),
});

const GetAllSubscribedUsersQuerySchema = z.object({
  page: z.coerce.number().optional(),
  pageSize: z.coerce.number().optional(),
  searchValue: z.string().optional(),
});

const GetAllSubscribedUsersValidationSchema = {
  query: GetAllSubscribedUsersQuerySchema,
} as const;

// ==================== Validators ====================

const createSubscriptionValidator = validate(
  { body: CreateSubscriptionBodySchema },
  validationErrorHandler,
);

const cancelSubscriptionValidator = validate(
  { body: CancelSubscriptionBodySchema },
  validationErrorHandler,
);

const changeSubscriptionValidator = validate(
  { body: ChangeSubscriptionBodySchema },
  validationErrorHandler,
);

const getAllSubscribedUsersValidator = validate(
  { query: GetAllSubscribedUsersQuerySchema },
  validationErrorHandler,
);

export const subscriptionValidators = {
  createSubscription: createSubscriptionValidator,
  cancelSubscription: cancelSubscriptionValidator,
  changeSubscription: changeSubscriptionValidator,
  getAllSubscribedUsers: getAllSubscribedUsersValidator,
};
