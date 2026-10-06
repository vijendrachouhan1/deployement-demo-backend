import { Request, Response, NextFunction } from "express";
import { randomUUID } from "crypto";

import { AuditContext } from "@/db/plugins/audit/audit-context";

export const auditContextMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const requestId = randomUUID();

  AuditContext.run(
    {
      requestId,
      ip: req.ip,
      path: req.path,
      userAgent: req.headers["user-agent"],
    },
    () => {
      res.setHeader("x-request-id", requestId);
      next();
    },
  );
};
