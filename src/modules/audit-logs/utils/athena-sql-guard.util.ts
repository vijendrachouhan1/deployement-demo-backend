export class AthenaSqlNotAllowedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AthenaSqlNotAllowedError";
  }
}

const FORBIDDEN_LEADING = new Set([
  "INSERT",
  "UPDATE",
  "DELETE",
  "MERGE",
  "DROP",
  "ALTER",
  "CREATE",
  "TRUNCATE",
  "GRANT",
  "REVOKE",
  "MSCK",
  "UNLOAD",
  "CALL",
  "DESCRIBE",
  "SHOW",
  "USE",
  "SET",
  "EXPLAIN",
]);

interface ScannedSql {
  normalized: string;
  multipleStatements: boolean;
}

/*
 * Scans the SQL once, tracking whether we're inside a quote so a ';' or comment
 * inside a string counts as data, not syntax. Quotes are escaped by doubling
 * them (''), the Presto/Athena way. Outside quotes, comments are stripped and
 * only a single trailing ';' is allowed.
 */
function scanSingleStatement(sql: string): ScannedSql {
  let out = "";
  let quote: "'" | '"' | "`" | null = null;
  let pendingSemicolon = false;
  let multipleStatements = false;

  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    const next = sql[i + 1];

    if (quote) {
      out += ch;
      if (ch === quote) {
        if (next === quote) {
          out += next;
          i += 1;
        } else {
          quote = null;
        }
      }
      continue;
    }

    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      out += ch;
      continue;
    }

    if (ch === "-" && next === "-") {
      while (i < sql.length && sql[i] !== "\n") i += 1;
      out += " ";
      continue;
    }
    if (ch === "/" && next === "*") {
      i += 2;
      while (i < sql.length && !(sql[i] === "*" && sql[i + 1] === "/")) i += 1;
      i += 1;
      out += " ";
      continue;
    }

    // Any non-whitespace, non-comment content after a ';' is a second statement.
    if (pendingSemicolon) {
      multipleStatements = true;
      break;
    }
    if (ch === ";") {
      pendingSemicolon = true;
      continue;
    }

    if (ch === "'" || ch === '"' || ch === "`") {
      quote = ch;
    }
    out += ch;
  }

  return { normalized: out.trim(), multipleStatements };
}

/**
 * Throw unless `sql` is a single read-only SELECT/WITH statement. Returns the
 * normalized (comment-stripped, trailing-`;`-removed) query to run.
 */
export function assertReadOnlySelect(sql: string): string {
  const { normalized, multipleStatements } = scanSingleStatement(sql);

  if (!normalized) {
    throw new AthenaSqlNotAllowedError("Query is empty.");
  }

  if (multipleStatements) {
    throw new AthenaSqlNotAllowedError(
      "Only a single statement is allowed (remove the ';').",
    );
  }

  const leading = normalized.match(/^[A-Za-z]+/)?.[0]?.toUpperCase();
  if (!leading) {
    throw new AthenaSqlNotAllowedError("Query must begin with SELECT or WITH.");
  }

  if (
    FORBIDDEN_LEADING.has(leading) ||
    (leading !== "SELECT" && leading !== "WITH")
  ) {
    throw new AthenaSqlNotAllowedError(
      `Only SELECT (or WITH ... SELECT) queries are allowed — "${leading}" is blocked on this read-only editor.`,
    );
  }

  return normalized;
}
