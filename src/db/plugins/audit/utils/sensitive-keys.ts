/*
 * Independent safety net against secrets leaking into audit records, layered on
 * top of each model's own `exclude` config. Shared by the capture path
 * (redactSnapshot / computeChanges) and the export serializer so the two can't
 * drift. Matches keys at ANY nesting depth.
 */
const SENSITIVE_KEY_PATTERNS = [/password/i, /secret/i, /token/i, /hash/i];

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERNS.some((re) => re.test(key));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/*
 * Deep-copy `value`, dropping any key matching the sensitive-key deny-list at any
 * depth. Special objects (Date, ObjectId, Buffer, …) aren't plain objects, so
 * they're treated as leaves and passed through untouched.
 */
export function scrubSensitiveKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(scrubSensitiveKeys);
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) {
      if (isSensitiveKey(key)) continue;
      out[key] = scrubSensitiveKeys(nested);
    }
    return out;
  }
  return value;
}
