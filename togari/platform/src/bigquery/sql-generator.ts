/**
 * @togari/admin — SQL Generator
 *
 * Natural language → SQL via Claude + SqlSanitizer for tenant isolation.
 * Supports both tenant-isolated mode (with clientId) and non-tenant mode.
 */

import { createLogger } from '../observability/logger';
import { SONNET } from '../config/models';

const logger = createLogger('SqlGenerator');

export class SqlSanitizer {
  private static readonly FORBIDDEN = ['DROP', 'DELETE', 'UPDATE', 'INSERT', 'ALTER', 'CREATE', 'TRUNCATE', 'MERGE', 'GRANT', 'REVOKE'];

  static sanitize(sql: string, clientId?: string): string {
    // Word-boundary match per keyword: `UPDATE deals SET ...` still trips
    // the guard (UPDATE followed by whitespace is a word boundary), but
    // legitimate column names like `updated_at` / `created_at` no longer
    // false-positive because the alphanumeric run isn't broken inside.
    for (const keyword of SqlSanitizer.FORBIDDEN) {
      const pattern = new RegExp(`\\b${keyword}\\b`, 'i');
      if (pattern.test(sql)) {
        throw new Error(`Forbidden SQL keyword: ${keyword}`);
      }
    }

    // If no clientId, skip tenant filtering
    if (!clientId) {
      return sql;
    }

    // Inject tenant filter at outermost WHERE
    const upper = sql.toUpperCase();
    if (upper.includes('WHERE')) {
      return sql.replace(/WHERE/i, 'WHERE client_id = @clientId AND');
    }
    // No WHERE clause — add one before ORDER BY, LIMIT, GROUP BY, or at end
    const insertPoint = sql.search(/\b(ORDER BY|LIMIT|GROUP BY)\b/i);
    if (insertPoint > -1) {
      return sql.slice(0, insertPoint) + ' WHERE client_id = @clientId ' + sql.slice(insertPoint);
    }
    return sql + ' WHERE client_id = @clientId';
  }
}

export class SqlGenerator {
  private anthropicApiKey: string;
  private dataset: string;
  private table: string;
  private fullyQualifiedTable: string;
  private schemaDescription: string;

  constructor(anthropicApiKey: string, dataset: string, table: string, projectId?: string, schemaDescription?: string) {
    this.anthropicApiKey = anthropicApiKey;
    this.dataset = dataset;
    this.table = table;
    this.fullyQualifiedTable = projectId
      ? `${projectId}.${dataset}.${table}`
      : `${dataset}.${table}`;
    this.schemaDescription = schemaDescription || '';
  }

  async generate(naturalLanguage: string, clientId?: string): Promise<{ sql: string; params: Record<string, unknown> }> {
    const tenantRule = clientId
      ? '- Use @clientId parameter for tenant filtering (already injected)'
      : '- No tenant filtering needed';

    const systemPrompt = `You are a SQL generator. Convert natural language to BigQuery SQL.
Table: \`${this.fullyQualifiedTable}\`
${this.schemaDescription ? `\n${this.schemaDescription}\n` : ''}
Rules:
- Only generate SELECT queries
- Never use string concatenation for parameters
${tenantRule}
- Use BigQuery Standard SQL syntax
- Use LIKE with wildcards for partial text matching. Be case-insensitive by using LOWER() when doing text matching.
- Do NOT add a LIMIT clause unless the user explicitly asks for a specific number of results.
- Return ONLY the SQL, no markdown fences or explanation`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.anthropicApiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: SONNET,
        max_tokens: 1024,
        system: systemPrompt,
        messages: [{ role: 'user', content: naturalLanguage }],
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Anthropic API ${response.status}: ${errorBody}`);
    }

    const data = (await response.json()) as any;
    let rawSql = (data.content || [])
      .filter((c: any) => c.type === 'text')
      .map((c: any) => c.text)
      .join('')
      .trim();
    rawSql = rawSql.replace(/```sql\n?/g, '').replace(/```\n?/g, '').trim();

    if (clientId) {
      const sanitized = SqlSanitizer.sanitize(rawSql, clientId);
      return {
        sql: sanitized,
        params: { clientId },
      };
    }

    // Non-tenant mode: still sanitize for forbidden keywords, no params
    SqlSanitizer.sanitize(rawSql);
    return {
      sql: rawSql,
      params: {},
    };
  }
}
