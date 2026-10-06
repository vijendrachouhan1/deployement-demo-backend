import mongoose from "mongoose";
import status from "http-status";

import { AppError } from "@/helpers/app-error";
import type { ITruncatable } from "@/db/plugins/audit/utils/audit.types";

const FIELD_LIMIT_BYTES = 1 * 1024 * 1024;
const DOC_LIMIT_BYTES = 15 * 1024 * 1024;

function byteSize(value: unknown): number {
  try {
    return mongoose.mongo.BSON.calculateObjectSize({ v: value });
  } catch {
    return Buffer.byteLength(JSON.stringify(value ?? null), "utf8");
  }
}

function metadataMarker(originalBytes: number): Record<string, number> {
  const originalKB = Math.ceil(originalBytes / 1024);
  return { [`[truncated, ${originalKB} KB original]`]: originalKB };
}

function changeMarker(originalBytes: number): {
  field: string;
  before: null;
  after: number;
} {
  const originalKB = Math.ceil(originalBytes / 1024);
  return { field: "[truncated]", before: null, after: originalKB };
}

/*
 * Mutates `event` in place — caller's object is modified to avoid an
 * extra deep clone on every emit. Don't retain references to the
 * input after passing it through.
 */
export function truncateOversized<T extends ITruncatable>(event: T): T {
  if (event.metadata) {
    const size = byteSize(event.metadata);
    if (size > FIELD_LIMIT_BYTES) {
      event.metadata = metadataMarker(size);
    }
  }
  if (event.changes) {
    const size = byteSize(event.changes);
    if (size > FIELD_LIMIT_BYTES) {
      (event as { changes: unknown }).changes = [changeMarker(size)];
    }
  }
  return event;
}

export function assertWithinBsonLimit(doc: Record<string, unknown>): void {
  const size = byteSize(doc);
  if (size > DOC_LIMIT_BYTES) {
    throw new AppError(
      `audit-logs: document size ${size} exceeds limit ${DOC_LIMIT_BYTES}`,
      status.REQUEST_ENTITY_TOO_LARGE,
    );
  }
}
