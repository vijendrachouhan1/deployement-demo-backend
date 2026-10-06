import { NextFunction, Request, Response, Router } from "express";
import httpStatus from "http-status";

import { PERMISSIONS } from "@/enums";
import { ErrorResponse } from "@/helpers/api-response";
import { Middleware } from "@/middleware/auth";
import { authorize } from "@/middleware/authorize";
import { AuditLogsAdminController } from "@/modules/audit-logs/audit-log-admin.controller";
import { AuditLogsSuperAdminController } from "@/modules/audit-logs/audit-log-super-admin.controller";
import { athenaController } from "@/modules/audit-logs/athena.controller";
import { athenaValidators } from "@/modules/audit-logs/utils/athena.validation";
import { auditLogValidators } from "@/modules/audit-logs/utils/audit-log.validation";

const middleware = new Middleware();

function rejectSubstringSearch(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  if (typeof req.query.search !== "undefined") {
    return ErrorResponse(res, httpStatus.BAD_REQUEST, {
      message: "Search isn't available here.",
    });
  }
  next();
}

export class AdminAuditLogsRouter {
  router: Router;

  constructor() {
    this.router = Router();
    const controller = new AuditLogsAdminController();

    this.router.use(middleware.adminMiddleware);
    this.router.use(authorize(PERMISSIONS.AUDIT_LOGS_VIEW));

    this.router.get(
      "/",
      rejectSubstringSearch,
      auditLogValidators.getAuditLogsAdmin,
      controller.getAuditLogs,
    );
    this.router.get(
      "/export",
      rejectSubstringSearch,
      auditLogValidators.exportAuditLogsAdmin,
      controller.exportAuditLogs,
    );
    this.router.get(
      "/:id",
      auditLogValidators.getAuditLogById,
      controller.getAuditLogById,
    );
  }
}

export class SuperAdminAuditLogsRouter {
  router: Router;

  constructor() {
    this.router = Router();
    const controller = new AuditLogsSuperAdminController();

    this.router.use(authorize(PERMISSIONS.AUDIT_LOGS_VIEW));

    this.router.get(
      "/",
      auditLogValidators.getAuditLogsSuperAdmin,
      controller.getAuditLogs,
    );
    this.router.get(
      "/export",
      auditLogValidators.exportAuditLogsSuperAdmin,
      controller.exportAuditLogs,
    );

    this.router.get(
      "/chain/verify",
      authorize(PERMISSIONS.AUDIT_LOGS_MANAGE),
      auditLogValidators.verifyChain,
      controller.verifyChain,
    );
    this.router.get(
      "/:id",
      auditLogValidators.getAuditLogById,
      controller.getAuditLogById,
    );

    this.router.post(
      "/athena",
      athenaValidators.runQuery,
      athenaController.runQuery,
    );
  }
}

export { SuperAdminAuditLogsRouter as AuditLogsRouter };
