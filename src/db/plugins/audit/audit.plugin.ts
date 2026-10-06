import { type Document, type Schema } from "mongoose";

import {
  buildExclusionSet,
  computeChanges,
  redactSnapshot,
  resolveLabel,
} from "@/db/plugins/audit/audit-change";
import { ChangeType } from "@/db/plugins/audit/utils/audit-change.enum";
import {
  appendBulkSummary,
  appendDocumentChange,
} from "@/db/plugins/audit/append-document-change";
import type {
  Doc,
  AuditQuery,
  BulkReadResult,
  IAuditPluginOptions,
} from "@/db/plugins/audit/utils/audit.types";

const BULK_AUDIT_LIMIT = 1000;

function toPlainObject(doc: unknown): Doc {
  if (doc && typeof doc === "object" && "toObject" in doc) {
    return (doc as Document).toObject() as Doc;
  }
  return (doc ?? {}) as Doc;
}

function extractUpsertedId(res: unknown): unknown {
  if (!res || typeof res !== "object") return null;
  const record = res as Record<string, unknown>;
  if (record.upsertedId) {
    const upserted = record.upsertedId as Record<string, unknown>;
    return upserted._id ?? record.upsertedId;
  }
  if (record._id) return record._id;
  return null;
}

function findCurrent(query: AuditQuery): Promise<Doc | null> {
  return query.model.findOne(query.getFilter()).lean<Doc>().exec();
}

async function readMatchedDocs(
  query: AuditQuery,
  model: string,
  op: string,
): Promise<BulkReadResult> {
  const docs = await query.model
    .find(query.getFilter())
    .limit(BULK_AUDIT_LIMIT + 1)
    .lean<Doc[]>()
    .exec();
  if (docs.length > BULK_AUDIT_LIMIT) {
    const matchedCount = await query.model
      .countDocuments(query.getFilter())
      .exec();
    console.warn(
      `[audit-plugin] ${model}.${op} matched ${matchedCount} documents (> ${BULK_AUDIT_LIMIT}) — exceeds the per-record audit cap`,
    );
    return { overflow: true, matchedCount };
  }
  return { overflow: false, docs };
}

export function auditPlugin(
  schema: Schema,
  options: IAuditPluginOptions,
): void {
  const { model, labelField } = options;
  const exclude = buildExclusionSet(options.exclude);

  const logCreate = (doc: Doc): void =>
    appendDocumentChange({
      model,
      recordId: String(doc._id),
      changeType: ChangeType.Create,
      snapshot: redactSnapshot(doc, exclude),
      label: resolveLabel(doc, labelField),
    });

  const logUpdate = (before: Doc, after: Doc): void => {
    const changes = computeChanges(before, after, exclude);
    if (!changes.length) return;
    appendDocumentChange({
      model,
      recordId: String(before._id),
      changeType: ChangeType.Update,
      changes,
      label: resolveLabel(after, labelField),
    });
  };

  const logDelete = (doc: Doc): void =>
    appendDocumentChange({
      model,
      recordId: String(doc._id),
      changeType: ChangeType.Delete,
      snapshot: redactSnapshot(doc, exclude),
      label: resolveLabel(doc, labelField),
    });

  //For document instance methods (save, remove, etc.)
  schema.post("init", function (this: Document) {
    this.$locals.auditOriginal = this.toObject();
  });

  schema.pre("save", function (this: Document) {
    this.$locals.auditWasNew = this.isNew;
  });

  schema.post("save", function (this: Document) {
    const obj = this.toObject() as Doc;
    if (this.$locals.auditWasNew) {
      logCreate(obj);
    } else {
      const original = this.$locals.auditOriginal as Doc | undefined;
      if (original) logUpdate(original, obj);
    }
    this.$locals.auditOriginal = obj;
  });

  //For single-document operations (findOneAndUpdate, findOneAndDelete, etc.)
  schema.pre(
    ["findOneAndUpdate", "updateOne", "replaceOne", "findOneAndReplace"],
    async function (this: AuditQuery) {
      this.auditBefore = (await findCurrent(this)) ?? undefined;
    },
  );

  schema.post(
    ["findOneAndUpdate", "updateOne", "replaceOne", "findOneAndReplace"],
    async function (this: AuditQuery, res: unknown) {
      const before = this.auditBefore;
      if (before) {
        const after = await this.model
          .findOne({ _id: before._id })
          .lean<Doc>()
          .exec();
        if (after) logUpdate(before, after);
        return;
      }

      if (!this.getOptions().upsert) return;
      const upsertedId = extractUpsertedId(res);
      const inserted = upsertedId
        ? await this.model.findOne({ _id: upsertedId }).lean<Doc>().exec()
        : await this.model.findOne(this.getFilter()).lean<Doc>().exec();
      if (inserted) logCreate(inserted);
    },
  );

  schema.pre(
    ["findOneAndDelete", "deleteOne"],
    async function (this: AuditQuery) {
      this.auditDeleted = (await findCurrent(this)) ?? undefined;
    },
  );

  schema.post(["findOneAndDelete", "deleteOne"], function (this: AuditQuery) {
    if (this.auditDeleted) logDelete(this.auditDeleted);
  });

  // For bulk operations (updateMany, deleteMany, insertMany)
  schema.post("insertMany", function (docs: unknown) {
    if (!Array.isArray(docs)) return;
    if (docs.length > BULK_AUDIT_LIMIT) {
      console.warn(
        `[audit-plugin] ${model}.insertMany inserted more than ${BULK_AUDIT_LIMIT} documents — skipping audit`,
      );
      return;
    }
    for (const doc of docs) logCreate(toPlainObject(doc));
  });

  schema.pre("updateMany", async function (this: AuditQuery) {
    this.auditBulkPlan = await readMatchedDocs(this, model, "updateMany");
  });

  schema.post("updateMany", async function (this: AuditQuery) {
    const plan = this.auditBulkPlan;
    if (!plan) return;

    if (plan.overflow) {
      appendBulkSummary({
        model,
        op: "updateMany",
        matchedCount: plan.matchedCount,
        filter: this.getFilter(),
        update: this.getUpdate(),
      });
      return;
    }

    const before = plan.docs;
    if (!before.length) return;
    const afterDocs = await this.model
      .find({ _id: { $in: before.map((doc) => doc._id) } })
      .lean<Doc[]>()
      .exec();
    const afterById = new Map(
      afterDocs.map((doc) => [String(doc._id), doc] as const),
    );
    for (const beforeDoc of before) {
      const afterDoc = afterById.get(String(beforeDoc._id));
      if (afterDoc) logUpdate(beforeDoc, afterDoc);
    }
  });

  schema.pre("deleteMany", async function (this: AuditQuery) {
    const plan = await readMatchedDocs(this, model, "deleteMany");
    this.auditDeletedMany = plan.overflow ? undefined : plan.docs;
  });

  schema.post("deleteMany", function (this: AuditQuery) {
    for (const doc of this.auditDeletedMany ?? []) logDelete(doc);
  });
}
