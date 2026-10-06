import type { Response } from "express";
import status from "http-status";
import { ValidationError } from "zod-express-validator";
import { ErrorResponse } from "@/helpers/api-response";

export function validationErrorHandler<P, Q, B>(
  { bodyError, paramsError, queryError }: ValidationError<P, Q, B>,
  res: Response,
) {
  const error = bodyError ?? paramsError ?? queryError;
  return ErrorResponse(res, status.BAD_REQUEST, {
    success: false,
    errors: error?.message ? JSON.parse(error.message) : {},
    message: "Validation error",
  });
}
