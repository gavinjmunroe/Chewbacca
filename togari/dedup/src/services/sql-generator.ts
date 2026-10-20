/**
 * SqlGenerator — converts natural language into BigQuery SQL via Claude.
 * SqlSanitizer — validates and hardens the generated SQL before execution.
 *
 * Security pipeline for every query:
 *   NL input → Claude → raw SQL
 *            → SqlSanitizer.validate()     — block mutations
 *            → SqlSanitizer.injectTenant() — force WHERE client_id = @clientId
 *            → BigQueryClient.executeQuery() with parameterized @clientId
 *
 * Client_id is NEVER string-concatenated into SQL — always a named parameter.
 */

import Anthropic from "@anthropic-ai/sdk";

// ─── Types ────────────────────────────────────────────────────────────────────

/** A single column definition passed to SqlGenerator so the prompt is table-specific. */
export interface ColumnDef {
  name: string;
  type: string;
  description: string;
}

/** Output of the full generation + sanitization pipeline. */
export interface SanitizedQuery {
  /** The SQL safe to execute — SELECT only, with WHERE client_id = @clientId injected. */
  sql: string;
  /** Named parameters to pass to BigQuery parameterized execution. */
  params: { clientId: string; [key: string]: string };
  /** Claude's raw output before sanitization (for audit logging). */
  rawSql: string;
}

// ─── SqlSanitizer ─────────────────────────────────────────────────────────────

export class SqlSanitizer {
  /**
   * Forbidden statement types — any of these in the SQL string is a hard reject.
   * Checked as whole words to avoid false positives inside identifiers or strings.
   */
  private static readonly FORBIDDEN = [
    "INSERT",
    "UPDATE",
    "DELETE",
    "DROP",
    "ALTER",
    "CREATE",
    "TRUNCATE",
    "MERGE",
    "GRANT",
    "REVOKE",
    "CALL",
    "EXECUTE",
    "EXEC",
  ] as const;

  /**
   * Validate that the SQL is a read-only SELECT or WITH (CTE) statement.
   * Throws with a descriptive message if any mutation keyword is found.
   */
  static validate(sql: string): void {
    const normalized = sql.replace(/\s+/g, " ").trim();

    // Must start with SELECT or WITH (CTEs)
    if (!/^(SELECT|WITH)\b/i.test(normalized)) {
      throw new Error(
        `SQL rejected: must be a SELECT statement, got: "${normalized.slice(0, 40)}..."`,
      );
    }

    // Scan for forbidden keywords as whole words anywhere in the query.
    // This catches mutations hidden in subqueries or CTEs.
    for (const kw of SqlSanitizer.FORBIDDEN) {
      if (new RegExp(`\\b${kw}\\b`, "i").test(sql)) {
        throw new Error(
          `SQL rejected: contains forbidden keyword "${kw}". Only SELECT queries are allowed.`,
        );
      }
    }
  }

  /**
   * Force-inject `client_id = @clientId` into the outermost WHERE clause.
   *
   * Strategy — walk character-by-character tracking parenthesis depth so we
   * only operate on the outermost query, never on subqueries or CTEs.
   *
   * Cases handled:
   *   • No WHERE  → appends WHERE client_id = @clientId before ORDER BY / end
   *   • Has WHERE → prepends client_id = @clientId AND <existing conditions>
   *   • CTE (WITH ... SELECT ...) → injects into the outermost SELECT's WHERE
   */
  static injectTenant(sql: string): string {
    const trimmed = sql.replace(/;\s*$/, "").trimEnd();
    const upper = trimmed.toUpperCase();

    // Walk at depth-0 to find positions of keywords in the outermost query
    let depth = 0;
    let outerWherePos = -1; // position of WHERE keyword at depth 0
    let insertBefore = -1; // position to inject before (ORDER BY etc.)

    for (let i = 0; i < trimmed.length; i++) {
      const ch = trimmed[i];
      if (ch === "(") {
        depth++;
        continue;
      }
      if (ch === ")") {
        depth--;
        continue;
      }
      if (depth !== 0) continue;

      const rest = upper.slice(i);

      // First depth-0 WHERE
      if (outerWherePos === -1 && /^WHERE\b/.test(rest)) {
        outerWherePos = i;
        continue;
      }

      // First depth-0 ORDER BY / GROUP BY / HAVING / LIMIT (after FROM)
      if (
        insertBefore === -1 &&
        /^(ORDER\s+BY|GROUP\s+BY|HAVING|LIMIT)\b/.test(rest)
      ) {
        insertBefore = i;
        break;
      }
    }

    if (outerWherePos !== -1) {
      // Existing WHERE — prepend condition so the tenant filter is always first
      const afterWhere = outerWherePos + "WHERE".length;
      return (
        trimmed.slice(0, afterWhere) +
        " client_id = @clientId AND" +
        trimmed.slice(afterWhere)
      );
    }

    // No WHERE — insert before ORDER BY/GROUP BY/LIMIT or at the very end
    const pos = insertBefore !== -1 ? insertBefore : trimmed.length;
    const before = trimmed.slice(0, pos).trimEnd();
    const after = pos < trimmed.length ? "\n" + trimmed.slice(pos) : "";
    return `${before}\nWHERE client_id = @clientId${after}`;
  }

  /**
   * Full pipeline: validate then inject.
   * Returns the hardened SQL ready for parameterized execution.
   */
  static sanitize(rawSql: string, clientId: string): SanitizedQuery {
    SqlSanitizer.validate(rawSql);
    const sql = SqlSanitizer.injectTenant(rawSql);
    return { sql, params: { clientId }, rawSql };
  }
}

// ─── SqlGenerator ─────────────────────────────────────────────────────────────

export class SqlGenerator {
  private client: Anthropic;
  private fullyQualifiedTable: string;
  private schemaDescription: string;

  constructor(
    apiKey: string,
    projectId: string,
    dataset: string,
    table: string,
    schemaDescription: string,
  ) {
    this.client = new Anthropic({ apiKey });
    this.fullyQualifiedTable = `\`${projectId}.${dataset}.${table}\``;
    this.schemaDescription = schemaDescription;
  }

  /**
   * Convert a natural-language query into a sanitized, tenant-scoped SQL query.
   *
   * @param naturalLanguageQuery - The user's question in plain English.
   * @param clientId - The authenticated tenant's client_id (from JWT context).
   *                   Injected as a parameterized value — never concatenated.
   * @returns SanitizedQuery with hardened SQL + params ready for BigQuery.
   */
  async generate(
    naturalLanguageQuery: string,
    clientId: string,
  ): Promise<SanitizedQuery> {
    const systemPrompt = `You are a SQL generator for Google BigQuery. You MUST return ONLY a valid BigQuery Standard SQL SELECT statement — no explanation, no markdown, no code fences, just raw SQL.

TABLE: ${this.fullyQualifiedTable}

COLUMNS:
${this.schemaDescription}

RULES:
1. ONLY generate SELECT statements. Never generate INSERT, UPDATE, DELETE, DROP, ALTER, CREATE, MERGE, TRUNCATE, GRANT, REVOKE, or any mutation.
2. Always query from ${this.fullyQualifiedTable}.
3. Use BigQuery Standard SQL syntax.
4. Use LIKE with wildcards for partial text matching (e.g. WHERE currentTitle LIKE '%Engineer%'). Be case-insensitive by using LOWER() when doing text matching.
5. Always add LIMIT 100 unless the user explicitly asks for a specific number of results or asks for a count/aggregate.
6. If the user asks for a count or aggregate, use COUNT(*), GROUP BY, etc. as appropriate.
7. Return ONLY the SQL query text with no surrounding formatting.
8. Never reference client_id in WHERE clauses — tenant isolation is handled at the database layer. Do not filter by client_id.`;

    const response = await this.client.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: "user", content: naturalLanguageQuery }],
    });

    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      throw new Error("Claude returned no text content");
    }

    // Strip markdown fences if Claude added them despite instructions
    let rawSql = textBlock.text.trim();
    rawSql = rawSql
      .replace(/^```(?:sql)?\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();

    return SqlSanitizer.sanitize(rawSql, clientId);
  }
}
