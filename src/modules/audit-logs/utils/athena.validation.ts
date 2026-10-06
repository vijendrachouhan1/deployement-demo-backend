import { z } from "zod";
import { validate } from "zod-express-validator";
import { validationErrorHandler } from "@/helpers/validation-error";
import { AuditStatus } from "@/enums/audit.enum";

export const RunQueryBodySchema = z
  .object({
    query: z.string().optional(),
    filters: z
      .object({
        action: z.string().optional(),
        resource: z.string().optional(),
        resourceId: z.string().optional(),
        actor: z.string().optional(),
        status: z.enum(AuditStatus).optional(),
        startDate: z.iso.datetime({ offset: true }).optional(),
        endDate: z.iso.datetime({ offset: true }).optional(),
      })
      .optional(),
  })
  .refine((data) => data.query || data.filters, {
    message: "Either query or filters must be provided",
  });

export const RunQueryValidationSchema = {
  body: RunQueryBodySchema,
} as const;

export const athenaValidators = {
  runQuery: validate(RunQueryValidationSchema, validationErrorHandler),
};

export type RunQueryBody = z.infer<typeof RunQueryBodySchema>;
