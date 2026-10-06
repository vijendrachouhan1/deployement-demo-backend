import mongoose from "mongoose";

import { AuditLogModel, IAuditLog } from "@/db/models/audit-logs/audit-log";
import { AuditLogDlqModel } from "@/db/models/audit-logs/audit-log-dlq";
import { ChainHeadModel } from "@/db/models/audit-logs/chain-head";
import { ObjectId } from "@/helpers/common";
import { createFacetPipeline } from "@/helpers/query";
import { ROOT_SIG } from "@/db/plugins/audit/utils/chain.constant";
import { INTERNAL_FIELDS } from "@/db/plugins/audit/utils/internal-fields";
import { setActiveAuditStorageProvider } from "@/db/plugins/audit/provider-registry";
import type {
  IAuditLogPage,
  IAuditLogReadFilter,
  IAuditLogReadPagination,
  IAuditLogReadSort,
  IAuditLogRowInput,
  IAuditStorageProvider,
  ICasResult,
  IChainBatchCursor,
  IChainHeadSnapshot,
  IDlqRowInput,
} from "@/providers/audit-logs/utils/audit-provider.types";
import {
  parseSystemRefShortcut,
  SYSTEM_SUBSYSTEM_REFS,
  SystemSubsystem,
} from "@/db/plugins/audit/utils/subsystem";

const MONGO_DUPLICATE_KEY = 11000;

export class MongoAuditProvider implements IAuditStorageProvider {
  appendRow = async (
    row: IAuditLogRowInput,
    session?: mongoose.ClientSession | null,
  ): Promise<void> => {
    await AuditLogModel.create([row], session ? { session } : {});
  };

  getChainHead = async (
    chainId: mongoose.Types.ObjectId,
    session?: mongoose.ClientSession | null,
  ): Promise<IChainHeadSnapshot | null> => {
    const head = await ChainHeadModel.findOne({ _id: chainId })
      .select({ lastSig: 1 })
      .session(session ?? null)
      .lean();
    return head ? { lastSig: head.lastSig } : null;
  };

  casUpdateChainHead = async (
    chainId: mongoose.Types.ObjectId,
    prevSig: string,
    newSig: string,
    subsystem: SystemSubsystem | null,
    session?: mongoose.ClientSession | null,
  ): Promise<ICasResult> => {
    try {
      const swapped = await ChainHeadModel.findOneAndUpdate(
        { _id: chainId, lastSig: prevSig },
        {
          $set: { lastSig: newSig, updatedAt: new Date() },
          $setOnInsert: { subsystem },
        },
        {
          upsert: prevSig === ROOT_SIG,
          new: true,
          session: session ?? undefined,
        },
      );
      if (swapped) return { swapped: true };
      return { swapped: false, reason: "stale_prevsig" };
    } catch (err) {
      const code = (err as { code?: number } | null)?.code;
      if (code === MONGO_DUPLICATE_KEY) {
        return { swapped: false, reason: "head_missing" };
      }
      throw err;
    }
  };

  runInTransaction = async <T>(
    fn: (session: mongoose.ClientSession | null) => Promise<T>,
  ): Promise<T> => {
    const session = await mongoose.startSession();
    try {
      let result: T | undefined;
      await session.withTransaction(async () => {
        result = await fn(session);
      });
      return result as T;
    } finally {
      await session.endSession();
    }
  };

  writeDlq = async (
    row: IDlqRowInput,
    failureReason: string,
  ): Promise<void> => {
    await AuditLogDlqModel.create({
      ...row,
      _sig: null,
      _prevSig: null,
      failureReason,
      dlqAt: new Date(),
    });
  };

  findAuditLogs = async (
    filter: IAuditLogReadFilter,
    pagination: IAuditLogReadPagination,
    sort: IAuditLogReadSort,
  ): Promise<IAuditLogPage> => {
    const match = buildAuditLogMatch(filter);
    const sortStage = { [sort.field]: sort.direction } as Record<
      string,
      1 | -1
    >;

    const pipeline: mongoose.PipelineStage[] = [
      { $match: match },
      { $sort: sortStage },
      { $project: { signedSnapshot: 0 } },
      ...createFacetPipeline(
        pagination.page,
        pagination.skips,
        pagination.pageSize,
      ),
    ];

    const [result] = await AuditLogModel.aggregate(pipeline);

    return {
      items: (result?.items ?? []) as IAuditLog[],
      total: result?.total ?? 0,
      page: pagination.page,
      pageSize: pagination.pageSize,
    };
  };

  /*
   * Plain match→sort→limit (no facet/pagination). Reuses buildAuditLogMatch so
   * the export slice is identical to what the list endpoint returns — any
   * divergence is a tenant-isolation gap.
   */
  findAuditLogsForExport = async (
    filter: IAuditLogReadFilter,
    sort: IAuditLogReadSort,
    limit: number,
  ): Promise<IAuditLog[]> => {
    const match = buildAuditLogMatch(filter);
    /*
     * `_id` tiebreaker gives a total order, so rows sharing a sort value (e.g.
     * an identical timestamp) clip deterministically at the export cap.
     */
    const sortStage = {
      [sort.field]: sort.direction,
      _id: sort.direction,
    } as Record<string, 1 | -1>;

    return AuditLogModel.find(match)
      .select("-signedSnapshot")
      .sort(sortStage)
      .limit(limit)
      .lean<IAuditLog[]>();
  };

  /*
   * Count rows matching a read filter, reusing buildAuditLogMatch so the counted
   * set is exactly what the verifier would walk — any divergence is a
   * correctness gap. The { timestamp: -1 } index covers a companyRef-only count.
   * An optional limit bounds the scan (the count short-circuits once it reaches
   * the limit), so callers that only need a threshold answer don't pay O(n).
   */
  countAuditLogs = async (
    filter: IAuditLogReadFilter,
    options?: { limit?: number },
  ): Promise<number> => {
    return AuditLogModel.countDocuments(
      buildAuditLogMatch(filter),
      options?.limit ? { limit: options.limit } : undefined,
    );
  };

  /*
   * Seek-paginated batch read for the chain-verify walk, in (timestamp ASC,
   * _id ASC) chain order — not _id-only insertion order, which is the order the
   * verifier needs. Reuses buildAuditLogMatch so the walked set is exactly the
   * counted/listed set. Unlike the export/read paths, signedSnapshot is NOT
   * projected out: the verifier cross-checks the stored bytes against its
   * recompute.
   */
  findChainBatch = async (
    companyRef: string,
    after: IChainBatchCursor | null,
    limit: number,
  ): Promise<IAuditLog[]> => {
    const match = buildAuditLogMatch({ companyRef });
    const seek = after
      ? {
          $or: [
            { timestamp: { $gt: after.timestamp } },
            { timestamp: after.timestamp, _id: { $gt: after._id } },
          ],
        }
      : {};

    return AuditLogModel.find({ ...match, ...seek })
      .sort({ timestamp: 1, _id: 1 })
      .limit(limit)
      .lean<IAuditLog[]>();
  };

  findAuditLogById = async (
    id: mongoose.Types.ObjectId | string,
    companyRefScope: mongoose.Types.ObjectId | string | null,
  ): Promise<IAuditLog | null> => {
    const query: Record<string, unknown> = { _id: ObjectId(String(id)) };
    if (companyRefScope) {
      query.companyRef = ObjectId(String(companyRefScope));
    }
    const row = await AuditLogModel.findOne(query)
      .select("-signedSnapshot")
      .lean<IAuditLog>();
    return row ?? null;
  };
}

const escapeRegex = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function buildAuditLogMatch(
  filter: IAuditLogReadFilter,
): Record<string, unknown> {
  const match: Record<string, unknown> = {};

  if (filter.companyRef) {
    const raw = String(filter.companyRef);
    const subsystem = parseSystemRefShortcut(raw);
    if (subsystem) {
      match.companyRef = SYSTEM_SUBSYSTEM_REFS[subsystem];
    } else {
      match.companyRef = ObjectId(raw);
    }
  }

  if (filter.category) match.category = filter.category;
  if (filter.action) {
    match.action = { $regex: `^${escapeRegex(filter.action.toLowerCase())}` };
  }
  if (filter.actorId) match.actorId = ObjectId(String(filter.actorId));
  if (filter.actorEmail) match.actorEmail = filter.actorEmail;
  if (filter.actorEmailSearch) {
    match.actorEmail = {
      $regex: escapeRegex(filter.actorEmailSearch),
      $options: "i",
    };
  }
  if (filter.status) match.status = filter.status;
  if (filter.targetType) match.targetType = filter.targetType;
  if (filter.targetId) match.targetId = ObjectId(String(filter.targetId));

  if (filter.from || filter.to) {
    const ts: Record<string, Date> = {};
    if (filter.from) ts.$gte = filter.from;
    if (filter.to) ts.$lte = filter.to;
    match.timestamp = ts;
  }

  if (filter.hideInternalChanges) {
    match.$or = [
      { changes: { $exists: false } },
      { changes: { $size: 0 } },
      { changes: { $elemMatch: { field: { $nin: INTERNAL_FIELDS } } } },
    ];
  }

  return match;
}

export const mongoAuditProvider = new MongoAuditProvider();

// Registered here (not imported by the engine) to avoid a db <-> providers cycle.
setActiveAuditStorageProvider(mongoAuditProvider);
