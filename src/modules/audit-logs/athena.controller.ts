import mongoose from "mongoose";
import { athenaHelper } from "@/modules/audit-logs/helpers/athena.helper";
import { SuccessResponse, ErrorResponse } from "@/helpers/api-response";
import httpStatus from "http-status";
import { ERROR_CODES } from "@/constants/error-codes";
import { AUDIT_CONSTANTS } from "@/providers/audit-logs/utils/audit.constant";
import { AthenaRunningModel } from "@/db/models/audit-logs/athena-running";
import { emitAuditLog } from "@/modules/audit-logs/helpers/emit.helper";
import { AuditAction, AuditCategory, AuditStatus } from "@/enums/audit.enum";
import {
  RunQueryBody,
  athenaValidators,
} from "@/modules/audit-logs/utils/athena.validation";
import { AthenaSqlNotAllowedError } from "@/modules/audit-logs/utils/athena-sql-guard.util";

export class AthenaController {
  runQuery: typeof athenaValidators.runQuery = async (req, res) => {
    const userId = String(req.user?._id ?? "");
    if (!userId) {
      return ErrorResponse(res, httpStatus.UNAUTHORIZED, {
        message: "Unauthorized",
      });
    }

    const cap = AUDIT_CONSTANTS.athenaMaxConcurrentPerUser;
    const ttlMs = AUDIT_CONSTANTS.athenaSlotTtlSeconds * 1000;
    const reservationId = new mongoose.Types.ObjectId().toString();
    const expiry = () => new Date(Date.now() + ttlMs);

    /*
     * Reserve first, then count: a concurrent burst can never admit more than
     * `cap` because every request inserts before counting its own live slots.
     */
    try {
      await AthenaRunningModel.create({
        _id: reservationId,
        userId,
        queryId: reservationId,
        expiresAt: expiry(),
      });
    } catch {
      return ErrorResponse(res, httpStatus.INTERNAL_SERVER_ERROR, {
        message: "Couldn't start your query. Please try again.",
      });
    }

    let live: number;
    try {
      live = await AthenaRunningModel.countDocuments({
        userId,
        expiresAt: { $gt: new Date() },
      });
    } catch {
      await AthenaRunningModel.deleteOne({ _id: reservationId }).catch(
        () => {},
      );
      return ErrorResponse(res, httpStatus.INTERNAL_SERVER_ERROR, {
        message: "Couldn't start your query. Please try again.",
      });
    }

    if (live > cap) {
      await AthenaRunningModel.deleteOne({ _id: reservationId }).catch(
        () => {},
      );
      return ErrorResponse(res, httpStatus.TOO_MANY_REQUESTS, {
        message:
          "You have too many queries running at once. Please wait a moment and try again.",
        messageCode: ERROR_CODES.TOO_MANY_CONCURRENT_QUERIES,
      });
    }

    const { query, filters } = req.body as RunQueryBody;

    /*
     * Heartbeat: keep this slot alive while the synchronous query polls, so a
     * long-running query never expires mid-flight (which would let the cap be
     * exceeded). A crashed request stops heartbeating → its slot expires via
     * TTL, keeping orphan cleanup fast. Interval kept well under the TTL.
     */
    const heartbeat = setInterval(
      () => {
        AthenaRunningModel.updateOne(
          { _id: reservationId },
          { expiresAt: expiry() },
        ).catch(() => {});
      },
      Math.max(1000, Math.floor(ttlMs / 3)),
    );

    let result: Awaited<ReturnType<typeof athenaHelper.runQuery>> | undefined;
    let queryError: unknown;
    try {
      result = await athenaHelper.runQuery(query, filters);
    } catch (error: unknown) {
      queryError = error;
    } finally {
      clearInterval(heartbeat);
      /*
       * Release before responding so the slot is freed deterministically
       * (no lingering reservation visible to the caller's next request).
       */
      await AthenaRunningModel.deleteOne({ _id: reservationId }).catch(
        () => {},
      );
    }

    emitAuditLog({
      action: AuditAction.ATHENA_QUERY_EXECUTED,
      status: queryError ? AuditStatus.FAILURE : AuditStatus.SUCCESS,
      category: AuditCategory.AUDIT_META,
      metadata: {
        query: query ?? null,
        filters: filters ?? null,
        targetTable: "audit_archive",
      },
    });

    if (queryError) {
      const isBlocked = queryError instanceof AthenaSqlNotAllowedError;
      return ErrorResponse(
        res,
        isBlocked ? httpStatus.BAD_REQUEST : httpStatus.INTERNAL_SERVER_ERROR,
        {
          message:
            queryError instanceof Error
              ? queryError.message
              : "Failed to execute query",
        },
      );
    }

    return SuccessResponse(res, httpStatus.OK, {
      message: "Query executed successfully",
      data: result,
    });
  };
}

export const athenaController = new AthenaController();
