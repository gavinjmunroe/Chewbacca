/**
 * BigQuery client for executing read-only, tenant-scoped parameterized queries.
 *
 * Every query executed here:
 *   1. Is validated as a SELECT-only statement (defence-in-depth after SqlSanitizer)
 *   2. Runs with named parameters — client_id is NEVER string-concatenated
 *   3. Tool invocations are audited via writeToolAudit() into audit_log
 *
 * audit_log columns (matches sql/create_tables.sql):
 *   client_id, user_id, tool_name,
 *   tokens_used, cost_usd, duration_ms,
 *   success, error_message, timestamp
 */

import { BigQuery } from "@google-cloud/bigquery";

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
  /**
   * Forward-compatible bag for fields not yet in the audit_log table.
   * Targeted columns (per Sagar's signals/opportunities roadmap): signal_type,
   * opportunity_score. Adding columns is a Karthik-run migration; until that
   * lands, anything passed here is dropped at write time with a stderr warning.
   * Callers can populate this today so the wire-up is one diff away post-migration.
   */
  extras?: Record<string, string | number | boolean>;
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
    this.dataset =
      dataset ?? process.env.BIGQUERY_DATASET ?? "togari_data_lake";

    const options: ConstructorParameters<typeof BigQuery>[0] = { projectId };

    if (gcpCredentialsBase64) {
      const decoded = Buffer.from(gcpCredentialsBase64, "base64").toString(
        "utf-8",
      );
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
    _auditInfo?: AuditInfo,
  ): Promise<QueryResult> {
    // Defence-in-depth: reject mutations even if SqlSanitizer was bypassed
    if (!/^(SELECT|WITH)\b/i.test(sql.replace(/\s+/g, " ").trim())) {
      throw new Error("Only SELECT queries are permitted.");
    }

    // Block cross-tenant queries — strip our own injected predicate first so
    // it doesn't trigger the check, then look for any remaining client_id filter.
    const sqlWithoutTenantPredicate = sql.replace(
      /\bclient_id\s*=\s*@clientId\b/gi,
      "",
    );
    if (/\bclient_id\s*(=|!=|<>|IN\s*\()/i.test(sqlWithoutTenantPredicate)) {
      throw new Error("Cross-tenant query attempt blocked.");
    }

    const queryParams: QueryParams = params ?? { clientId: "unknown" };
    const types: Record<string, string> = {};
    for (const key of Object.keys(queryParams)) {
      types[key] = "STRING";
    }

    const [job] = await this.client.createQueryJob({
      query: sql,
      params: queryParams,
      types,
      useLegacySql: false,
    });

    const [rows, , response] = await job.getQueryResults({
      autoPaginate: false,
    });

    const schema =
      response?.schema?.fields?.map((f) => ({
        name: f.name ?? "unknown",
        type: f.type ?? "unknown",
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
   * Schema matches sql/create_tables.sql audit_log definition.
   */
  async writeToolAudit(record: ToolAuditRecord): Promise<void> {
    const fqAuditTable = `\`${this.projectId}.${this.dataset}.audit_log\``;

    if (record.extras && Object.keys(record.extras).length > 0) {
      const keys = Object.keys(record.extras).join(", ");
      process.stderr.write(
        `[audit] extras field passed but audit_log schema does not yet support it; dropping: ${keys}\n`,
      );
    }

    await this.client.query({
      query: `
        INSERT INTO ${fqAuditTable} (
          client_id, user_id, tool_name,
          tokens_used, cost_usd, duration_ms,
          success, error_message, timestamp
        ) VALUES (
          @client_id, @user_id, @tool_name,
          @tokens_used, @cost_usd, @duration_ms,
          @success, @error_message, CURRENT_TIMESTAMP()
        )
      `,
      params: {
        client_id: record.clientId,
        user_id: record.userId ?? null,
        tool_name: record.toolName,
        tokens_used: record.tokensUsed ?? null,
        cost_usd: record.costUsd ?? null,
        duration_ms: record.durationMs,
        success: record.success,
        error_message: "",
      },
      types: {
        client_id: "STRING",
        user_id: "STRING",
        tool_name: "STRING",
        tokens_used: "INT64",
        cost_usd: "FLOAT64",
        duration_ms: "INT64",
        success: "BOOL",
        error_message: "STRING",
      },
      useLegacySql: false,
    });
  }
}
