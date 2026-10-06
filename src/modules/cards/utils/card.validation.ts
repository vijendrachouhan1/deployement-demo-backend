import { validationErrorHandler } from "@/helpers/validation-error";
import z from "zod";
import { validate } from "zod-express-validator";

// ==================== Schemas ====================

export const SetDefaultCardBodySchema = z.object({
  // The controller reads null/absent as "clear the default", so both must pass
  // validation and "" must not.
  paymentMethodId: z.string().min(1).nullish(),
});

// ==================== Validators ====================

const setDefaultCardValidator = validate(
  { body: SetDefaultCardBodySchema },
  validationErrorHandler,
);

const emptyValidator = validate({}, validationErrorHandler);

export const cardValidators = {
  setDefaultCard: setDefaultCardValidator,
  listCards: emptyValidator,
  addCard: emptyValidator,
};
