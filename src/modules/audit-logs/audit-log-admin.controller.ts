import status from "http-status";

import { ERROR_CODES } from "@/constants/error-codes";
import { ErrorResponse, SuccessResponse } from "@/helpers/api-response";
import { auditLogsHelper } from "@/modules/audit-logs/helpers/audit-log.helper";
import type { TAuditLogsAdminController } from "@/modules/audit-logs/utils/audit-log.types";
import type {
  ExportAuditLogsAdminQuery,
  GetAuditLogsAdminQuery,
} from "@/modules/audit-logs/utils/audit-log.validation";

export class AuditLogsAdminController {
  getAuditLogs: TAuditLogsAdminController["getAuditLogs"] = async (
    req,
    res,
    next,
  ) => {
    try {
      const user = req.user;
      if (!user?.companyRef) {
        return ErrorResponse(res, status.BAD_REQUEST, {
          message: "Your account isn't linked to a company.",
        });
      }

      const query = req.query as unknown as GetAuditLogsAdminQuery;

      const data = await auditLogsHelper.getAuditLogs({
        ...query,
        companyRef: user.companyRef.toString(),
      });

      return SuccessResponse(res, status.OK, {
        message: "Audit logs fetched successfully",
        data,
      });
    } catch (error) {
      next(error);
    }
  };

  exportAuditLogs: TAuditLogsAdminController["exportAuditLogs"] = async (
    req,
    res,
    next,
  ) => {
    try {
      const user = req.user;
      if (!user?.companyRef) {
        return ErrorResponse(res, status.BAD_REQUEST, {
          message: "Your account isn't linked to a company.",
        });
      }

      const userId = user._id?.toString();
      if (!userId) {
        return ErrorResponse(res, status.UNAUTHORIZED, {
          message: "Unauthorized",
        });
      }

      const { allowed, windowStart } =
        await auditLogsHelper.checkAndIncrementExportQuota(userId);
      if (!allowed) {
        return ErrorResponse(res, status.TOO_MANY_REQUESTS, {
          message: "Export rate limit exceeded. Try again later.",
          messageCode: ERROR_CODES.RATE_LIMIT_EXCEEDED,
        });
      }

      const query = req.query as unknown as ExportAuditLogsAdminQuery;
      const companyRef = user.companyRef.toString();

      let data;
      try {
        data = await auditLogsHelper.runExport(
          { ...query, companyRef },
          query.format ?? "json",
          companyRef,
        );
      } catch (exportError) {
        // Infra/serialize failure shouldn't burn the user's quota window.
        await auditLogsHelper
          .decrementExportQuota(userId, windowStart)
          .catch(() => {});
        throw exportError;
      }

      await auditLogsHelper.emitExportRun({
        scopeLabel: companyRef,
        format: data.format,
        filters: { ...query, companyRef },
        rowCount: data.rowCount,
        truncated: data.truncated,
      });

      return SuccessResponse(res, status.OK, {
        message: "Audit logs exported successfully",
        data,
      });
    } catch (error) {
      next(error);
    }
  };

  getAuditLogById: TAuditLogsAdminController["getAuditLogById"] = async (
    req,
    res,
    next,
  ) => {
    try {
      const user = req.user;
      if (!user?.companyRef) {
        return ErrorResponse(res, status.BAD_REQUEST, {
          message: "Your account isn't linked to a company.",
        });
      }

      const id = req.params.id;
      const row = await auditLogsHelper.getAuditLogById(id, user.companyRef);

      if (!row) {
        return ErrorResponse(res, status.NOT_FOUND, {
          message: "Audit log not found",
        });
      }

      return SuccessResponse(res, status.OK, {
        message: "Audit log fetched successfully",
        data: row,
      });
    } catch (error) {
      next(error);
    }
  };
}
