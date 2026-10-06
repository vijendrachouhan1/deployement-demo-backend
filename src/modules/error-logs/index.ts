import { Router } from "express";

import { Middleware } from "@/middleware/auth";
import { ErrorLogController } from "@/modules/error-logs/error-log.controller";
import { errorLogValidators } from "@/modules/error-logs/utils/error-log.validation";

const middleware = new Middleware();

export class ErrorLogsRouter {
  router: Router;

  constructor() {
    this.router = Router();
    this.initializeRoutes();
  }

  private initializeRoutes() {
    const controller = new ErrorLogController();

    this.router.post("/login", errorLogValidators.login, controller.login);
    this.router.use(middleware.systemMiddleware);
    this.router.get("/", errorLogValidators.getErrors, controller.getErrors);
    this.router.put(
      "/:id",
      errorLogValidators.updateImportantFlag,
      controller.updateIsImportantFlag,
    );
  }
}
