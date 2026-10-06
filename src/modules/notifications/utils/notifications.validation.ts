import { validationErrorHandler } from "@/helpers/validation-error";
import z from "zod";
import { validate } from "zod-express-validator";
import { NOTIFICATION_TYPE } from "@/enums";

// ==================== Schemas ====================

const ParamIdSchema = z.object({
  id: z.string().min(1, "ID is required"),
});

const CreateNotificationBodySchema = z.object({
  message: z.string().min(1, "Message is required"),
  title: z.string().min(1, "Title is required"),
});

const UpdateNotificationBodySchema = z.object({
  update: z.record(z.string(), z.any()),
});

const UpdatePreferenceBodySchema = z.object({
  type: z.enum(NOTIFICATION_TYPE),
  channels: z.record(z.string(), z.boolean()),
});

const GetNotificationsQuerySchema = z
  .object({
    page: z.coerce.number().optional(),
    pageSize: z.coerce.number().optional(),
  })
  .passthrough();

// ==================== Validation Schemas ====================

const CreateNotificationValidationSchema = {
  body: CreateNotificationBodySchema,
} as const;

const UpdateNotificationValidationSchema = {
  params: ParamIdSchema,
  body: UpdateNotificationBodySchema,
} as const;

const UpdatePreferenceValidationSchema = {
  body: UpdatePreferenceBodySchema,
} as const;

const GetNotificationsValidationSchema = {
  query: GetNotificationsQuerySchema,
} as const;

const ParamIdValidationSchema = {
  params: ParamIdSchema,
} as const;

// ==================== Validators ====================

const createNotificationValidator = validate(
  CreateNotificationValidationSchema,
  validationErrorHandler,
);

const updateNotificationValidator = validate(
  UpdateNotificationValidationSchema,
  validationErrorHandler,
);

const updatePreferenceValidator = validate(
  UpdatePreferenceValidationSchema,
  validationErrorHandler,
);

const getNotificationsValidator = validate(
  GetNotificationsValidationSchema,
  validationErrorHandler,
);

const paramIdValidator = validate(
  ParamIdValidationSchema,
  validationErrorHandler,
);

export const notificationsValidators = {
  createNotification: createNotificationValidator,
  updateNotification: updateNotificationValidator,
  updatePreference: updatePreferenceValidator,
  getNotifications: getNotificationsValidator,
  paramId: paramIdValidator,
};
