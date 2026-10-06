import status from "http-status";

import { AUDIT_CONSTANTS } from "@/providers/audit-logs/utils/audit.constant";
import { ERROR_CODES } from "@/constants/error-codes";
import { SuccessResponse, ErrorResponse } from "@/helpers/api-response";
import { auditLogsHelper } from "@/modules/audit-logs/helpers/audit-log.helper";
import { ChainTooLargeError } from "@/modules/audit-logs/helpers/verify/chain-walker.helper";
import type { TAuditLogsSuperAdminController } from "@/modules/audit-logs/utils/audit-log.types";
import type {
  ExportAuditLogsSuperAdminQuery,
  GetAuditLogsSuperAdminQuery,
  VerifyChainQuery,
} from "@/modules/audit-logs/utils/audit-log.validation";

export class AuditLogsSuperAdminController {
  getAuditLogs: TAuditLogsSuperAdminController["getAuditLogs"] = async (
    req,
    res,
    next,
  ) => {
    try {
      const query = req.query as unknown as GetAuditLogsSuperAdminQuery;

      const data = await auditLogsHelper.getAuditLogs({
        ...query,
        actorEmailSearch: query.search,
      });

      return SuccessResponse(res, status.OK, {
        message: "Audit logs fetched successfully",
        data,
      });
    } catch (error) {
      next(error);
    }
  };

  exportAuditLogs: TAuditLogsSuperAdminController["exportAuditLogs"] = async (
    req,
    res,
    next,
  ) => {
    try {
      const userId = req.user?._id?.toString();
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

      const query = req.query as unknown as ExportAuditLogsSuperAdminQuery;

      // Super-admin honors ?companyRef when supplied, else exports cross-tenant.
      const scopeLabel = query.companyRef ?? "all";

      let data;
      try {
        data = await auditLogsHelper.runExport(
          { ...query, actorEmailSearch: query.search },
          query.format ?? "json",
          scopeLabel,
        );
      } catch (exportError) {
        // Infra/serialize failure shouldn't burn the user's quota window.
        await auditLogsHelper
          .decrementExportQuota(userId, windowStart)
          .catch(() => {});
        throw exportError;
      }

      await auditLogsHelper.emitExportRun({
        scopeLabel,
        format: data.format,
        filters: { ...query, actorEmailSearch: query.search },
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

  verifyChain: TAuditLogsSuperAdminController["verifyChain"] = async (
    req,
    res,
    next,
  ) => {
    try {
      const userId = req.user?._id?.toString();
      if (!userId) {
        return ErrorResponse(res, status.UNAUTHORIZED, {
          message: "Unauthorized",
        });
      }

      const { allowed, windowStart } =
        await auditLogsHelper.checkAndIncrementVerifyQuota(userId);
      if (!allowed) {
        return ErrorResponse(res, status.TOO_MANY_REQUESTS, {
          message: "Verify rate limit exceeded. Try again later.",
          messageCode: ERROR_CODES.RATE_LIMIT_EXCEEDED,
        });
      }

      const { companyRef } = req.query as unknown as VerifyChainQuery;

      let estimatedRows: number;
      try {
        if (await auditLogsHelper.isRetentionSweepActive()) {
          await auditLogsHelper
            .decrementVerifyQuota(userId, windowStart)
            .catch(() => {});
          return ErrorResponse(res, status.CONFLICT, {
            message:
              "Retention sweep in progress — retry once it completes (≤30 min).",
            messageCode: ERROR_CODES.VERIFY_RETENTION_SWEEP_ACTIVE,
          });
        }
        estimatedRows = await auditLogsHelper.estimateChainRows(companyRef);
      } catch (estimateError) {
        await auditLogsHelper
          .decrementVerifyQuota(userId, windowStart)
          .catch(() => {});
        throw estimateError;
      }

      if (estimatedRows > AUDIT_CONSTANTS.verifyMaxRows) {
        return ErrorResponse(res, status.REQUEST_ENTITY_TOO_LARGE, {
          message: `Chain too large to verify inline (${estimatedRows} rows; cap ${AUDIT_CONSTANTS.verifyMaxRows}). Offline verification is not available.`,
          messageCode: ERROR_CODES.VERIFY_ROW_LIMIT_EXCEEDED,
        });
      }

      let report;
      try {
        report = await auditLogsHelper.verifyChain(companyRef);
      } catch (walkError) {
        if (walkError instanceof ChainTooLargeError) {
          return ErrorResponse(res, status.REQUEST_ENTITY_TOO_LARGE, {
            message: walkError.message,
            messageCode: ERROR_CODES.VERIFY_ROW_LIMIT_EXCEEDED,
          });
        }

        await auditLogsHelper
          .decrementVerifyQuota(userId, windowStart)
          .catch(() => {});
        throw walkError;
      }

      return SuccessResponse(res, status.OK, {
        message: "Chain verification completed",
        data: report,
      });
    } catch (error) {
      next(error);
    }
  };

  getAuditLogById: TAuditLogsSuperAdminController["getAuditLogById"] = async (
    req,
    res,
    next,
  ) => {
    try {
      const id = req.params.id;
      const row = await auditLogsHelper.getAuditLogById(id, null);

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
