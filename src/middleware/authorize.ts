import { PERMISSIONS } from "@/enums";
import { ErrorResponse } from "@/helpers/api-response";
import { stripQueryString } from "@/helpers/common";
import { emitAuditLog } from "@/modules/audit-logs/helpers/emit.helper";
import { AuditAction, AuditCategory, AuditStatus } from "@/enums/audit.enum";
import { NextFunction, Request, Response } from "express";
import httpStatus from "http-status";

const levels = {
  view: 1,
  write: 2,
  manage: 3,
};

type TAction = keyof typeof levels;

function parse(permission: string) {
  const parts = permission.split(":");
  const action = parts.pop() as TAction; // last part
  const domain = parts.join(":"); // everything else
  return { domain, action };
}

export function canAccess(permissions: string[], requiredPermission: string) {
  if (!permissions?.length) return false;

  const { domain: reqDomain, action: reqAction } = parse(requiredPermission);

  if (!reqAction) return false;

  return permissions.some((userPerm) => {
    const { domain: userDomain, action: userAction } = parse(userPerm);

    if (!userAction) return false;

    return userDomain === reqDomain && levels[userAction] >= levels[reqAction];
  });
}

export const authorize = (...permissions: PERMISSIONS[]) => {
  return <P, ResBody, ReqBody, ReqQuery>(
    req: Request<P, ResBody, ReqBody, ReqQuery>,
    res: Response,
    next: NextFunction,
  ) => {
    const userPermissions = req.user?.permissions || [];

    // Access is granted by the required permission directly, or by a stronger
    // permission within the same domain.
    if (
      permissions.some((permission) => canAccess(userPermissions, permission))
    ) {
      return next();
    }

    if (!req.user) {
      return ErrorResponse(res, httpStatus.FORBIDDEN, { message: "Forbidden" });
    }

    emitAuditLog({
      action: AuditAction.PERMISSION_DENIED,
      status: AuditStatus.FAILURE,
      category: AuditCategory.RBAC,
      metadata: {
        requiredPermission: permissions,
        userPermissions: req.user.permissions ?? [],
      },
      context: {
        path: stripQueryString(req.originalUrl),
        method: req.method,
      },
    });

    return ErrorResponse(res, httpStatus.FORBIDDEN, { message: "Forbidden" });
  };
};
