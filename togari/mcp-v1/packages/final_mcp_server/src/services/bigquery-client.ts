/**
 * BigQuery client for executing read-only queries.
 * Authenticates via GOOGLE_APPLICATION_CREDENTIALS (service account JSON)
 * or Application Default Credentials.
 */

import { BigQuery } from '@google-cloud/bigquery';

export interface QueryResult {
  rows: Record<string, unknown>[];
  totalRows: number;
  schema: { name: string; type: string }[];
}

export class BigQueryClient {
  private client: BigQuery;

  constructor(projectId: string, credentialsPath?: string, gcpCredentialsBase64?: string) {
    const options: ConstructorParameters<typeof BigQuery>[0] = {
      projectId,
    };

    if (gcpCredentialsBase64) {
      const decoded = Buffer.from(gcpCredentialsBase64, 'base64').toString('utf-8');
      options.credentials = JSON.parse(decoded);
    } else if (credentialsPath) {
      options.keyFilename = credentialsPath;
    }
    // Otherwise falls back to GOOGLE_APPLICATION_CREDENTIALS env var or ADC

    this.client = new BigQuery(options);
  }

  async executeQuery(sql: string): Promise<QueryResult> {
    // Final safety check — only allow SELECT/WITH
    const normalized = sql.toUpperCase().replace(/\s+/g, ' ').trim();
    if (!normalized.startsWith('SELECT') && !normalized.startsWith('WITH')) {
      throw new Error('Only SELECT queries are permitted.');
    }

    const [job] = await this.client.createQueryJob({
      query: sql,
      useLegacySql: false,
    });

    // Single paginating loop: captures rows and schema in one pass
    const allRows: Record<string, unknown>[] = [];
    let schema: { name: string; type: string }[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let nextQuery: Record<string, unknown> | undefined = {};
    while (nextQuery !== undefined) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const [pageRows, next, response]: [unknown[], Record<string, unknown> | undefined, any] = await (job as any).getQueryResults({
        autoPaginate: false,
        ...nextQuery,
      });
      allRows.push(...(pageRows as Record<string, unknown>[]));
      if (schema.length === 0 && response?.schema?.fields) {
        schema = (response.schema.fields as Array<{ name?: string; type?: string }>).map((f) => ({
          name: f.name ?? 'unknown',
          type: f.type ?? 'unknown',
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
}
