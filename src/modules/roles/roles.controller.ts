import { ErrorResponse, SuccessResponse } from "@/helpers/api-response";
import { rolesHelper } from "@/modules/roles/helpers/roles.helper";
import { ROLES_MESSAGES } from "@/modules/roles/utils/roles.constant";
import { TRoleController } from "@/modules/roles/utils/roles.types";
import {
  safeEmit,
  summarizeFailureReason,
} from "@/modules/audit-logs/helpers/emit.helper";
import { AuditAction, AuditStatus, AuditTargetType } from "@/enums/audit.enum";
import { Request, Response } from "express";
import status from "http-status";

function getCompanyRef(user: Request["user"]) {
  const companyRef = user?.companyRef;

  if (!companyRef) {
    return null;
  }

  if (typeof companyRef === "string") {
    return companyRef;
  }

  if (typeof companyRef === "object" && "_id" in companyRef) {
    return companyRef._id.toString();
  }

  return String(companyRef);
}

function handleRolesError(res: Response, error: any) {
  const statusCode =
    error?.statusCode || error?.status || status.INTERNAL_SERVER_ERROR;
  const errorCode = error?.rawData?.code || error?.code;

  const errorMessage = error.message;

  if (
    errorMessage.includes(
      "cannot be deleted because it has user role assignments.",
    )
  ) {
    return ErrorResponse(res, status.CONFLICT, {
      message: ROLES_MESSAGES.ROLE_HAS_ASSIGNMENTS,
    });
  }

  if (
    errorMessage.includes(
      "cannot be deleted because it has group role mappings.",
    )
  ) {
    return ErrorResponse(res, status.CONFLICT, {
      message: ROLES_MESSAGES.ROLE_HAS_GROUP_ROLE_MAPPINGS,
    });
  }
  if (errorCode === "role_has_assignments") {
    return ErrorResponse(res, status.CONFLICT, {
      message: ROLES_MESSAGES.ROLE_HAS_ASSIGNMENTS,
    });
  }

  if (errorCode === "role_has_group_role_mappings") {
    return ErrorResponse(res, status.CONFLICT, {
      message: ROLES_MESSAGES.ROLE_HAS_GROUP_ROLE_MAPPINGS,
    });
  }

  return ErrorResponse(res, statusCode, {
    message: error?.message || ROLES_MESSAGES.ROLE_SYNC_FAILED,
  });
}

export class RolesAdminController {
  list: TRoleController["delete"] = async (req, res, _next) => {
    try {
      const companyRef = getCompanyRef(req.user);

      if (!companyRef) {
        return ErrorResponse(res, status.BAD_REQUEST, {
          message: ROLES_MESSAGES.COMPANY_NOT_FOUND,
        });
      }
      const organizationId = req.user?.company?.externalId;

      const roles = await rolesHelper.listAssignableRoles(companyRef);

      return SuccessResponse(res, status.OK, {
        message: ROLES_MESSAGES.ROLE_FETCHED,
        data: roles,
      });
    } catch (error) {
      console.log(error);
      return handleRolesError(res, error);
    }
  };

  create: TRoleController["create"] = async (req, res, _next) => {
    try {
      const companyRef = getCompanyRef(req.user);

      if (!companyRef) {
        return ErrorResponse(res, status.BAD_REQUEST, {
          message: ROLES_MESSAGES.COMPANY_NOT_FOUND,
        });
      }

      const role = await rolesHelper.createRole(companyRef, req.body);

      safeEmit({
        action: AuditAction.ROLE_CREATED,
        status: AuditStatus.SUCCESS,
        targetType: AuditTargetType.ROLE,
        metadata: {
          slug: req.body?.slug,
          name: req.body?.name,
          permissionCount: Array.isArray(req.body?.permissions)
            ? req.body.permissions.length
            : undefined,
        },
      });

      return SuccessResponse(res, status.CREATED, {
        message: ROLES_MESSAGES.ROLE_CREATED,
        data: role,
      });
    } catch (error) {
      safeEmit({
        action: AuditAction.ROLE_CREATED,
        status: AuditStatus.FAILURE,
        targetType: AuditTargetType.ROLE,
        metadata: { slug: req.body?.slug },
        failureReason: summarizeFailureReason(error),
      });
      console.log(error);
      return handleRolesError(res, error);
    }
  };

  update: TRoleController["update"] = async (req, res, _next) => {
    try {
      const companyRef = getCompanyRef(req.user);

      if (!companyRef) {
        return ErrorResponse(res, status.BAD_REQUEST, {
          message: ROLES_MESSAGES.COMPANY_NOT_FOUND,
        });
      }

      const role = await rolesHelper.updateRole(
        companyRef,
        req.params.slug,
        req.body,
      );

      safeEmit({
        action: AuditAction.ROLE_UPDATED,
        status: AuditStatus.SUCCESS,
        targetType: AuditTargetType.ROLE,
        metadata: { slug: req.params.slug },
      });

      return SuccessResponse(res, status.OK, {
        message: ROLES_MESSAGES.ROLE_UPDATED,
        data: role,
      });
    } catch (error) {
      safeEmit({
        action: AuditAction.ROLE_UPDATED,
        status: AuditStatus.FAILURE,
        targetType: AuditTargetType.ROLE,
        metadata: { slug: req.params.slug },
        failureReason: summarizeFailureReason(error),
      });
      return handleRolesError(res, error);
    }
  };

  delete: TRoleController["delete"] = async (req, res, _next) => {
    try {
      const companyRef = getCompanyRef(req.user);

      if (!companyRef) {
        return ErrorResponse(res, status.BAD_REQUEST, {
          message: ROLES_MESSAGES.COMPANY_NOT_FOUND,
        });
      }

      await rolesHelper.deleteRole(companyRef, req.params.slug);

      safeEmit({
        action: AuditAction.ROLE_DELETED,
        status: AuditStatus.SUCCESS,
        targetType: AuditTargetType.ROLE,
        metadata: { slug: req.params.slug },
      });

      return SuccessResponse(res, status.OK, {
        message: ROLES_MESSAGES.ROLE_DELETED,
      });
    } catch (error) {
      safeEmit({
        action: AuditAction.ROLE_DELETED,
        status: AuditStatus.FAILURE,
        targetType: AuditTargetType.ROLE,
        metadata: { slug: req.params.slug },
        failureReason: summarizeFailureReason(error),
      });
      console.log(error);
      return handleRolesError(res, error);
    }
  };

  listPermissions: TRoleController["delete"] = async (req, res, _next) => {
    try {
      const permissions = await rolesHelper.listPermissions();

      return SuccessResponse(res, status.OK, {
        message: ROLES_MESSAGES.PERMISSIONS_FETCHED,
        data: permissions.data,
      });
    } catch (error) {
      return handleRolesError(res, error);
    }
  };
}
