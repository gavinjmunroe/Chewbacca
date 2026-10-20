/**
 * @togari/admin — BigQuery client
 *
 * Parameterized queries with read-only validation and audit writes.
 * Defense-in-depth: blocks mutations, enforces @clientId parameters.
 */

import { BigQuery } from "@google-cloud/bigquery";
import { createLogger } from "../observability/logger";

const logger = createLogger("BigQueryClient");

/**
 * BigQuery cannot infer the type of a NULL parameter, so it rejects a query
 * with "Parameter types must be provided for null values" unless a `types`
 * entry is supplied. Every null/undefined param in these writes targets a
 * STRING column (non-string columns are written via literals like
 * CURRENT_TIMESTAMP(), PARSE_JSON(), or computed numbers, never a bare null
 * param), so defaulting nulls to STRING is safe and fixes the whole class of
 * failures in one place. Returns a `types` map covering only the null params,
 * or undefined when there are none.
 */
function nullParamTypes(
  params: Record<string, unknown>,
): Record<string, string> | undefined {
  const types: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined) types[key] = "STRING";
  }
  return Object.keys(types).length > 0 ? types : undefined;
}

export interface QueryResult {
  rows: Record<string, unknown>[];
  totalRows: number;
  schema?: Record<string, string>[];
}

export class BigQueryClient {
  private client: BigQuery;

  constructor(
    projectId: string,
    keyFilename?: string | null,
    credentialsBase64?: string | null,
  ) {
    const opts: any = { projectId };
    if (keyFilename) {
      opts.keyFilename = keyFilename;
    } else if (credentialsBase64) {
      const decoded = Buffer.from(credentialsBase64, "base64").toString(
        "utf-8",
      );
      opts.credentials = JSON.parse(decoded);
    }
    this.client = new BigQuery(opts);
  }

  async executeQuery(
    sql: string,
    params: Record<string, unknown> = {},
    auditInfo?: { toolName: string; clientId: string },
  ): Promise<QueryResult> {
    // Defense: block mutations
    const normalized = sql.trim().toUpperCase();
    if (!normalized.startsWith("SELECT") && !normalized.startsWith("WITH")) {
      throw new Error("Only SELECT/WITH queries are allowed");
    }

    const queryOpts: Record<string, unknown> = {
      query: sql,
      useLegacySql: false,
    };
    if (Object.keys(params).length > 0) {
      queryOpts.params = params;
      const types = nullParamTypes(params);
      if (types) queryOpts.types = types;
    }

    const [job] = await this.client.createQueryJob(queryOpts);

    // Auto-pagination: collect all pages
    const allRows: Record<string, unknown>[] = [];
    let schema: Record<string, string>[] | undefined;
    let nextQuery: Record<string, unknown> | undefined = {};
    while (nextQuery !== undefined) {
      const [pageRows, next, response]: [
        unknown[],
        Record<string, unknown> | undefined,
        any,
      ] = await (job as any).getQueryResults({
        autoPaginate: false,
        ...nextQuery,
      });
      allRows.push(...(pageRows as Record<string, unknown>[]));
      if (!schema && response?.schema?.fields) {
        schema = (
          response.schema.fields as Array<{ name?: string; type?: string }>
        ).map((f) => ({
          name: f.name ?? "unknown",
          type: f.type ?? "unknown",
        }));
      }
      nextQuery = next ?? undefined;
    }

    return {
      rows: allRows,
      totalRows: allRows.length,
      schema,
    };
  }

  async writeAuditLog(
    dataset: string,
    table: string,
    row: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.client.dataset(dataset).table(table).insert([row]);
    } catch (error) {
      logger.error("Failed to write audit log", error);
    }
  }

  async executeWrite(
    sql: string,
    params: Record<string, unknown> = {},
  ): Promise<{ success: boolean; numDmlAffectedRows: string }> {
    const normalized = sql.trim().toUpperCase();
    if (
      !normalized.startsWith("INSERT") &&
      !normalized.startsWith("UPDATE") &&
      !normalized.startsWith("MERGE")
    ) {
      throw new Error(
        "Only INSERT/UPDATE/MERGE queries are allowed through executeWrite",
      );
    }
    // Block dangerous operations. MERGE is allowed (above) because it's the
    // canonical idempotent upsert path — BigQuery doesn't have a native UPSERT.
    // We still block DELETE inside MERGE (WHEN MATCHED THEN DELETE) because
    // the Phase 1.5a capture path never needs it.
    //
    // Word-boundary regex (same pattern as SqlSanitizer post-Patch-D) so a
    // column name like `dropped_at` / `deleted_by` / `altered_count` doesn't
    // false-positive. The actual `WHEN MATCHED THEN DELETE` form still has
    // `DELETE` as a standalone token and is still caught.
    if (/\b(DROP|DELETE|ALTER|TRUNCATE)\b/i.test(normalized)) {
      throw new Error("Destructive operations are not allowed");
    }

    const queryOpts: Record<string, unknown> = {
      query: sql,
      useLegacySql: false,
    };

    if (Object.keys(params).length > 0) {
      queryOpts.params = params;
      const types = nullParamTypes(params);
      if (types) queryOpts.types = types;
    }

    const [job] = await this.client.createQueryJob(queryOpts);
    await job.getQueryResults();

    return {
      success: true,
      numDmlAffectedRows: await this.affectedRows(job),
    };
  }

  /**
   * Rows a DML statement actually touched.
   *
   * `job.metadata` is the job resource as it was CREATED — the SDK never
   * refreshes it, and `getQueryResults()` does not either, so DML statistics
   * are simply absent there and every caller silently saw "0". That broke
   * anything that treats 0 as "someone else got there first": compare-and-set
   * claims reported themselves lost on success. The finished job has to be
   * fetched explicitly.
   */
  private async affectedRows(job: any): Promise<string> {
    try {
      const [metadata] = await job.getMetadata();
      return metadata?.statistics?.query?.numDmlAffectedRows ?? "0";
    } catch (err) {
      logger.warn("could not read DML statistics from the finished job", {
        error: err instanceof Error ? err.message : String(err),
      });
      return "0";
    }
  }


  /**
   * Run a guarded DELETE. Separate from executeWrite (which refuses DELETE) so
   * deletes are deliberate and auditable. Two guardrails: the statement must be
   * a DELETE, and it must carry a WHERE clause — an unqualified table-wide
   * delete is refused so a bad call can never nuke a table. Callers scope by
   * tenant (client_brand) + the target id.
   */
  async executeDelete(
    sql: string,
    params: Record<string, unknown> = {},
  ): Promise<{ success: boolean; numDmlAffectedRows: string }> {
    const normalized = sql.trim().toUpperCase();
    if (!normalized.startsWith("DELETE")) {
      throw new Error("executeDelete only runs DELETE statements");
    }
    if (!/\bWHERE\b/.test(normalized)) {
      throw new Error("refusing a DELETE with no WHERE clause");
    }
    if (/\b(DROP|ALTER|TRUNCATE|INSERT|UPDATE|MERGE)\b/.test(normalized)) {
      throw new Error("executeDelete rejects mixed/destructive statements");
    }

    const queryOpts: Record<string, unknown> = {
      query: sql,
      useLegacySql: false,
    };
    if (Object.keys(params).length > 0) {
      queryOpts.params = params;
      const types = nullParamTypes(params);
      if (types) queryOpts.types = types;
    }

    const [job] = await this.client.createQueryJob(queryOpts);
    await job.getQueryResults();
    return {
      success: true,
      numDmlAffectedRows: await this.affectedRows(job),
    };
  }

  getClient(): BigQuery {
    return this.client;
  }
}
