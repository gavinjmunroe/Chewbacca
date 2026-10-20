/**
 * BigQuery client for executing read-only, tenant-scoped parameterized queries.
 *
 * Every query executed here:
 *   1. Is validated as a SELECT-only statement (defence-in-depth after SqlSanitizer)
 *   2. Runs with named parameters — client_id is NEVER string-concatenated
 *   3. Is logged to the audit_log table before execution (fire-and-forget)
 *
 * audit_log columns:
 *   execution_id, client_id, user_id, tool_name,
 *   nl_query, raw_sql, sanitized_sql,
 *   tokens_used, cost_usd, duration_ms, success,
 *   logged_at
 */

import { BigQuery } from '@google-cloud/bigquery';
import { randomUUID } from 'crypto';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface QueryResult {
  rows: Record<string, unknown>[];
  totalRows: number;
  schema: { name: string; type: string }[];
}

export interface QueryParams {
  /** Tenant identifier — injected as @clientId parameter, never concatenated */
  clientId: string;
  [key: string]: string;
}

/** NL→SQL specific audit fields (query_contacts / query_deals only) */
export interface AuditInfo {
  nlQuery: string;
  rawSql: string;
  sanitizedSql: string;
}

/** Audit record for any tool invocation (including non-SQL tools) */
export interface ToolAuditRecord {
  clientId: string;
  userId?: string;
  toolName: string;
  durationMs: number;
  success: boolean;
  tokensUsed?: number;
  costUsd?: number;
}

// ─── BigQueryClient ───────────────────────────────────────────────────────────

export class BigQueryClient {
  private client: BigQuery;
  private projectId: string;
  private dataset: string;

  constructor(
    projectId: string,
    credentialsPath?: string,
    gcpCredentialsBase64?: string,
    dataset?: string,
  ) {
    this.projectId = projectId;
    this.dataset   = dataset ?? process.env.BIGQUERY_DATASET ?? 'togari_data_lake';

    const options: ConstructorParameters<typeof BigQuery>[0] = { projectId };

    if (gcpCredentialsBase64) {
      const decoded = Buffer.from(gcpCredentialsBase64, 'base64').toString('utf-8');
      options.credentials = JSON.parse(decoded);
    } else if (credentialsPath) {
      options.keyFilename = credentialsPath;
    }
    // Falls back to GOOGLE_APPLICATION_CREDENTIALS env var or ADC

    this.client = new BigQuery(options);
  }

  /**
   * Execute a parameterized SELECT query.
   *
   * @param sql       - Sanitized SQL with @clientId placeholder already injected.
   * @param params    - Named parameters including clientId. Never concatenated into SQL.
   * @param auditInfo - NL query + raw/sanitized SQL for audit logging.
   */
  async executeQuery(
    sql: string,
    params?: QueryParams,
    auditInfo?: AuditInfo,
  ): Promise<QueryResult> {
    // Defence-in-depth: reject mutations even if SqlSanitizer was bypassed
    if (!/^(SELECT|WITH)\b/i.test(sql.replace(/\s+/g, ' ').trim())) {
      throw new Error('Only SELECT queries are permitted.');
    }

    // Block cross-tenant queries — defense-in-depth alongside RAPs
    if (/\bclient_id\s*(=|!=|<>|IN\s*\()/i.test(sql)) {
      throw new Error('Cross-tenant query attempt blocked.');
    }

    const [job] = await this.client.createQueryJob({
      query:        sql,
      params:       queryParams,
      types,
      useLegacySql: false,
    });

    const [rows, , response] = await job.getQueryResults({ autoPaginate: false });

    const schema =
      response?.schema?.fields?.map((f) => ({
        name: f.name ?? 'unknown',
        type: f.type ?? 'unknown',
      })) ?? [];

    // Cap returned rows to prevent MCP stdio buffer overflow on large result sets
    const MAX_ROWS = 200;
    const cappedRows = rows.slice(0, MAX_ROWS);

    return {
      rows: cappedRows as Record<string, unknown>[],
      totalRows: rows.length,
      schema,
    };
  }

  // ─── Audit logging ───────────────────────────────────────────────────────────

  /**
   * Write a tool invocation record to audit_log.
   * Called from the server-level tool wrapper in index.ts — covers ALL 58+ tools.
   * Fire-and-forget: failures are logged to stderr but never surface to the user.
   */
  async writeToolAudit(record: ToolAuditRecord): Promise<void> {
    const fqAuditTable = `\`${this.projectId}.${this.dataset}.audit_log\``;
    const executionId  = randomUUID();

    await this.client.query({
      query: `
        INSERT INTO ${fqAuditTable} (
          execution_id, client_id, user_id, tool_name,
          nl_query, raw_sql, sanitized_sql,
          tokens_used, cost_usd, duration_ms, success,
          logged_at
        ) VALUES (
          @execution_id, @client_id, @user_id, @tool_name,
          NULL, NULL, NULL,
          @tokens_used, @cost_usd, @duration_ms, @success,
          CURRENT_TIMESTAMP()
        )
      `,
      params: {
        execution_id: executionId,
        client_id:    record.clientId,
        user_id:      record.userId      ?? null,
        tool_name:    record.toolName,
        tokens_used:  record.tokensUsed  ?? null,
        cost_usd:     record.costUsd     ?? null,
        duration_ms:  record.durationMs,
        success:      record.success,
      },
      types: {
        execution_id: 'STRING',
        client_id:    'STRING',
        user_id:      'STRING',
        tool_name:    'STRING',
        tokens_used:  'INT64',
        cost_usd:     'FLOAT64',
        duration_ms:  'INT64',
        success:      'BOOL',
      },
      useLegacySql: false,
    });
  }

  /**
   * Write an NL→SQL query entry to audit_log.
   * Called from executeQuery() — only for query_contacts / query_deals.
   */
  private async writeAuditLog(
    executionId: string,
    sanitizedSql: string,
    params?: QueryParams,
    auditInfo?: AuditInfo,
  ): Promise<void> {
    const fqAuditTable = `\`${this.projectId}.${this.dataset}.audit_log\``;

    await this.client.query({
      query: `
        INSERT INTO ${fqAuditTable} (
          execution_id, client_id, tool_name,
          nl_query, raw_sql, sanitized_sql,
          logged_at
        ) VALUES (
          @execution_id, @client_id, @tool_name,
          @nl_query, @raw_sql, @sanitized_sql,
          CURRENT_TIMESTAMP()
        )
      `,
      params: {
        execution_id:  executionId,
        client_id:     params?.clientId ?? 'unknown',
        tool_name:     auditInfo ? 'query_contacts' : 'query_unknown',
        nl_query:      auditInfo?.nlQuery      ?? '',
        raw_sql:       auditInfo?.rawSql       ?? '',
        sanitized_sql: auditInfo?.sanitizedSql ?? sanitizedSql,
      },
      types: {
        execution_id:  'STRING',
        client_id:     'STRING',
        tool_name:     'STRING',
        nl_query:      'STRING',
        raw_sql:       'STRING',
        sanitized_sql: 'STRING',
      },
      useLegacySql: false,
    });
  }
}
