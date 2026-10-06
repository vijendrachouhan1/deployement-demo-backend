import { Router } from "express";
import status from "http-status";

import { ErrorResponse } from "@/helpers/api-response";
import { isDevEnvironment } from "@/helpers/common";
import { E2eSupportController } from "@/modules/e2e-support/e2e-support.controller";

/**
 * Support endpoints for the local E2E suite: reading captured emails and
 * tearing down test accounts. Mounted only in development.
 */
export class E2eSupportRouter {
  router: Router;

  constructor() {
    this.router = Router();
    this.initializeRoutes();
  }

  private initializeRoutes() {
    const controller = new E2eSupportController();

    this.router.use((_req, res, next) => {
      if (!isDevEnvironment()) {
        return ErrorResponse(res, status.NOT_FOUND, {
          message: "Route Not Found",
        });
      }
      next();
    });

    this.router.get("/emails", controller.getEmails);
    this.router.get("/stripe/checkout-sessions", (_req, res) =>
      ErrorResponse(res, status.BAD_REQUEST, {
        message: "A valid Stripe Checkout Session ID is required",
      }),
    );
    this.router.get(
      "/stripe/checkout-sessions/:sessionId",
      (req, res, next) => {
        const sessionId = req.params.sessionId;
        if (
          typeof sessionId !== "string" ||
          !/^cs_test_[A-Za-z0-9]{1,128}$/.test(sessionId)
        ) {
          return ErrorResponse(res, status.BAD_REQUEST, {
            message: "A valid Stripe Checkout Session ID is required",
          });
        }
        next();
      },
      controller.inspectCheckoutSession,
    );
    this.router.delete("/emails", controller.clearEmails);
    this.router.delete("/users/:email", controller.deleteTestUser);
  }
}
