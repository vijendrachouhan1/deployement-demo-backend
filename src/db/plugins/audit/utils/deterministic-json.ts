import mongoose from "mongoose";
import status from "http-status";

import { AppError } from "@/helpers/app-error";

const EXCLUDED_KEYS = new Set([
  "_sig",
  "_prevSig",
  "signedSnapshot",
  "_id",
  "__v",
  "createdAt",
  "updatedAt",
]);

export function deterministicJson(input: unknown): string {
  const seen = new WeakSet<object>();
  const out = normalize(input, seen);
  return JSON.stringify(out ?? null);
}

function badPayload(reason: string): never {
  throw new AppError(
    `audit-logs: ${reason} in audit payload`,
    status.BAD_REQUEST,
  );
}

function normalize(value: unknown, seen: WeakSet<object>): unknown {
  if (value === null) return null;
  if (value === undefined) return undefined;

  if (typeof value === "number") {
    if (Number.isNaN(value)) badPayload("NaN");
    if (!Number.isFinite(value)) badPayload("Infinity");
    return value;
  }

  if (typeof value === "bigint") return { $bigint: value.toString() };
  if (typeof value === "symbol") badPayload("Symbol");
  if (typeof value === "function") badPayload("Function");

  if (value instanceof Date) return { $date: value.toISOString() };
  if (value instanceof mongoose.Types.ObjectId)
    return { $oid: value.toHexString() };

  if (Buffer.isBuffer(value)) badPayload("Buffer");
  if (value instanceof Map) badPayload("Map");
  if (value instanceof Set) badPayload("Set");
  if (value instanceof RegExp) badPayload("RegExp");

  if (typeof value === "object") {
    if (seen.has(value as object)) badPayload("circular reference");
    seen.add(value as object);

    if (Array.isArray(value)) return value.map((v) => normalize(v, seen));

    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    const keys = Object.keys(obj)
      .filter((k) => !EXCLUDED_KEYS.has(k) && obj[k] !== undefined)
      .sort();
    for (const key of keys) {
      const normalized = normalize(obj[key], seen);
      if (normalized !== undefined) out[key] = normalized;
    }
    return out;
  }

  return value;
}
