import crypto from "crypto";

// Hex SHA-256 of a string — the hash behind every chain signature (`_sig`).
export function sha256(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}
