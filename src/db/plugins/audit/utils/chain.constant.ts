/*
 * Chain-signing constants shared by the emit path (append-audit-log.ts), the
 * verifier (verify-chain.ts), and the Mongo provider. Defined once so the
 * upsert decision and the signature recompute can never silently disagree — a
 * re-typed sentinel or separator would verify nothing.
 */

// Stand-in "previous signature" for the very first entry in a chain.
export const ROOT_SIG = "ROOT";

/*
 * Sits between `prevSig` and the deterministic event bytes when computing
 * `_sig`, so the two pieces fed into the hash can't blur together. Prevents a
 * crafted `prevSig` ending in a JSON prefix from colliding with a different
 * (prevSig, event) pair.
 */
export const HASH_INPUT_SEPARATOR = "\x1f";
