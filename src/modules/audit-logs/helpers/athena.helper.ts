import {
  athenaProvider,
  ATHENA_RESULT_ROW_CAP,
} from "@/providers/audit-logs/athena.provider";
import { assertReadOnlySelect } from "@/modules/audit-logs/utils/athena-sql-guard.util";
import type { IAthenaFilters } from "@/modules/audit-logs/utils/athena.types";

export class AthenaHelper {
  async runQuery(query?: string, filters?: IAthenaFilters) {
    let finalQuery = query;

    if (!finalQuery && filters) {
      finalQuery = this.buildQueryFromFilters(filters);
    }

    if (!finalQuery) {
      throw new Error("No query or filters provided");
    }

    finalQuery = assertReadOnlySelect(finalQuery);

    return await athenaProvider.runQuery(finalQuery);
  }

  private buildQueryFromFilters(filters: IAthenaFilters): string {
    const escapeSqlQuotes = (value: string) => value.replace(/'/g, "''");

    const escapeLikePattern = (value: string) =>
      escapeSqlQuotes(value).replace(/[\\%_]/g, "\\$&");

    let sql = "SELECT * FROM audit_archive\nWHERE 1=1";

    if (filters.action) {
      sql += `\n  AND action LIKE '${escapeLikePattern(filters.action)}%' ESCAPE '\\'`;
    }
    if (filters.resource) {
      sql += `\n  AND targetType = '${escapeSqlQuotes(filters.resource)}'`;
    }
    if (filters.resourceId) {
      sql += `\n  AND targetId = '${escapeSqlQuotes(filters.resourceId)}'`;
    }
    if (filters.status) {
      sql += `\n  AND status = '${filters.status}'`;
    }
    if (filters.actor) {
      const actorLike = escapeLikePattern(filters.actor);
      const actorId = escapeSqlQuotes(filters.actor);
      sql += `\n  AND (actor_name LIKE '%${actorLike}%' ESCAPE '\\' OR actorEmail LIKE '%${actorLike}%' ESCAPE '\\' OR actorId = '${actorId}')`;
    }
    if (filters.startDate) {
      sql += `\n  AND timestamp >= CAST('${escapeSqlQuotes(filters.startDate)}' AS TIMESTAMP)`;
    }
    if (filters.endDate) {
      sql += `\n  AND timestamp <= CAST('${escapeSqlQuotes(filters.endDate)}' AS TIMESTAMP)`;
    }

    sql += `\nLIMIT ${ATHENA_RESULT_ROW_CAP};`;
    return sql;
  }
}

export const athenaHelper = new AthenaHelper();
