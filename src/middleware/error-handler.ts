import { ErrorLogs } from "@/db/models/errorLogs";
import { ErrorResponse } from "@/helpers/api-response";
import { AppError } from "@/helpers/app-error";
import { ERROR_TYPE } from "@/enums";
import { NextFunction, Response, Request } from "express";
import status from "http-status";
import Stripe from "stripe";

const SENSITIVE_FIELDS = ["password", "token", "authorization"];

// Function to sanitize data
function sanitizeData(data: any): any {
  if (!data) return data;

  const sanitized = { ...data };

  // Hide common sensitive fields
  SENSITIVE_FIELDS.forEach((field) => {
    if (field in sanitized) {
      sanitized[field] = "[REDACTED]";
    }
  });

  return sanitized;
}

// Async function to log error
export async function logError(err: any, errorType: ERROR_TYPE, req?: Request) {
  try {
    const stackTrace = err.stack?.split("\n").slice(0, 100).join("\n");
    const statusCode = status.INTERNAL_SERVER_ERROR;

    // Create error document
    const errorLog = new ErrorLogs({
      // Basic Error Information
      name: err.name,
      message: err.message,
      stackTrace,
      type: errorType,

      // Request Context
      ...(req && {
        request: {
          method: req.method,
          statusCode,
          url: req.originalUrl,
          path: req.route?.path,
          headers: sanitizeData(req.headers),
          query: sanitizeData(req.query),
          params: sanitizeData(req.params),
          body: sanitizeData(req.body),
        },
      }),

      // User Context
      ...(req?.user && {
        context: {
          userRef: req.user._id,
          userAgent: req.get("user-agent"),
          ip: req.ip,
        },
      }),
    });

    errorLog.save().catch((saveErr) => {
      console.error("Error saving error log:", saveErr);
    });
  } catch (loggingError) {
    console.error("Error in error logging:", loggingError);
  }
}

const STRIPE_ERROR_RESPONSES: Record<
  string,
  { statusCode: number; message: string }
> = {
  StripeCardError: {
    statusCode: status.PAYMENT_REQUIRED,
    message: "Your card was declined.",
  },
  StripeInvalidRequestError: {
    statusCode: status.BAD_REQUEST,
    message: "The payment request was rejected.",
  },
  StripeRateLimitError: {
    statusCode: status.TOO_MANY_REQUESTS,
    message: "Too many payment requests. Try again shortly.",
  },
  StripeIdempotencyError: {
    statusCode: status.CONFLICT,
    message: "This payment request was already submitted.",
  },
};

const STRIPE_UPSTREAM_FAILURE = {
  statusCode: status.BAD_GATEWAY,
  message: "The payment provider is unavailable. Try again shortly.",
};

function resolveErrorResponse(err: Error): {
  statusCode: number;
  message: string;
} {
  if (err instanceof Stripe.errors.StripeError) {
    const mapped = STRIPE_ERROR_RESPONSES[err.type];

    if (!mapped) return STRIPE_UPSTREAM_FAILURE;

    return err.type === "StripeCardError"
      ? {
          statusCode: mapped.statusCode,
          message: err.message || mapped.message,
        }
      : mapped;
  }

  if (err instanceof AppError) {
    return { statusCode: err.statusCode, message: err.message };
  }

  return {
    statusCode: status.INTERNAL_SERVER_ERROR,
    message: err.message,
  };
}

export function globalErrorHandler(
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction,
) {
  // Start error logging asynchronously
  logError(err, ERROR_TYPE.GENERIC, req);

  const { statusCode, message } = resolveErrorResponse(err);

  return ErrorResponse(res, statusCode, { message });
}
