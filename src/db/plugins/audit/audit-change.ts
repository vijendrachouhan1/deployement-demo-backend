import diff from "microdiff";

import type { Doc, FieldChange } from "@/db/plugins/audit/utils/audit.types";
import {
  isSensitiveKey,
  scrubSensitiveKeys,
} from "@/db/plugins/audit/utils/sensitive-keys";

const ALWAYS_EXCLUDE = ["_id", "__v", "createdAt", "updatedAt"];

export function buildExclusionSet(extra: string[] = []): Set<string> {
  return new Set([...ALWAYS_EXCLUDE, ...extra]);
}

function normalize(obj: Doc): Doc {
  return JSON.parse(JSON.stringify(obj)) as Doc;
}

export function computeChanges(
  before: Doc,
  after: Doc,
  exclude: Set<string>,
): FieldChange[] {
  const changes: FieldChange[] = [];
  for (const change of diff(normalize(before), normalize(after))) {
    if (
      change.path.some(
        (seg) => exclude.has(String(seg)) || isSensitiveKey(String(seg)),
      )
    ) {
      continue;
    }
    changes.push({
      field: change.path.join("."),
      before: change.type === "CREATE" ? null : (change.oldValue ?? null),
      after: change.type === "REMOVE" ? null : (change.value ?? null),
    });
  }
  return changes;
}

export function redactSnapshot(obj: Doc, exclude: Set<string>): Doc {
  const topLevel = Object.fromEntries(
    Object.entries(obj).filter(([key]) => !exclude.has(key)),
  );
  return scrubSensitiveKeys(topLevel) as Doc;
}

export function resolveLabel(obj: Doc, labelField?: string): string | null {
  const val = labelField ? obj[labelField] : null;
  return val == null ? null : String(val);
}
