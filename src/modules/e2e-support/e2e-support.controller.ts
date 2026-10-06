import { Request, Response } from "express";
import status from "http-status";

import { ErrorResponse, SuccessResponse } from "@/helpers/api-response";
import { deleteTestUserCompletely } from "@/modules/e2e-support/helpers/delete-test-user.helper";
import {
  isTestAccountEmail,
  listCapturedEmails,
  normalizeEmail,
} from "@/modules/e2e-support/helpers/e2e-support.helper";
import { TEST_USER_EMAIL_SUFFIX } from "@/modules/e2e-support/utils/e2e-support.constant";
import { clearCapturedEmails } from "@/providers/email/local-email.store";
import { paymentGateway } from "@/providers/payment";
import type { E2eCheckoutSessionDetails } from "@/modules/e2e-support/utils/e2e-support.types";

export class E2eSupportController {
  public inspectCheckoutSession = async (req: Request, res: Response) => {
    try {
      const session = await paymentGateway.retrieveCheckoutSession(
        req.params.sessionId as string,
        ["payment_intent.latest_charge"],
      );

      const paymentIntent =
        typeof session.payment_intent === "object"
          ? session.payment_intent
          : null;
      const latestCharge = paymentIntent?.latest_charge;

      const data: E2eCheckoutSessionDetails = {
        sessionId:
          typeof session.id === "string"
            ? session.id
            : (req.params.sessionId as string),
        paymentIntentId:
          typeof session.payment_intent === "string"
            ? session.payment_intent
            : (paymentIntent?.id ?? null),
        chargeId:
          typeof latestCharge === "string"
            ? latestCharge
            : (latestCharge?.id ?? null),
        amountTotal:
          typeof session.amount_total === "number"
            ? session.amount_total
            : null,
      };

      return SuccessResponse(res, status.OK, {
        message: "Checkout session fetched successfully",
        data,
      });
    } catch (error) {
      return ErrorResponse(res, status.INTERNAL_SERVER_ERROR, {
        message: "Failed to retrieve checkout session",
      });
    }
  };

  public getEmails = (req: Request, res: Response) => {
    const to = typeof req.query.to === "string" ? req.query.to : undefined;
    const limit = Number.parseInt(String(req.query.limit), 10);

    return SuccessResponse(res, status.OK, {
      message: "Captured emails fetched successfully",
      data: { emails: listCapturedEmails(to, limit) },
    });
  };

  public clearEmails = (_req: Request, res: Response) => {
    clearCapturedEmails();

    return SuccessResponse(res, status.OK, {
      message: "Captured emails cleared successfully",
    });
  };

  public deleteTestUser = async (req: Request, res: Response) => {
    const email = normalizeEmail(req.params.email);

    if (!isTestAccountEmail(email)) {
      return ErrorResponse(res, status.FORBIDDEN, {
        message: `Only ${TEST_USER_EMAIL_SUFFIX} accounts can be deleted through the E2E API`,
      });
    }

    try {
      const result = await deleteTestUserCompletely({ email });

      return SuccessResponse(res, status.OK, {
        message: result.deleted
          ? "Test user deleted successfully"
          : "Test user not found (nothing to delete)",
        data: result,
      });
    } catch (error) {
      return ErrorResponse(res, status.INTERNAL_SERVER_ERROR, {
        message: `Failed to delete test user: ${
          error instanceof Error ? error.message : String(error)
        }`,
      });
    }
  };
}
