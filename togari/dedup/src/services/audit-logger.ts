/**
 * Audit logger — logs every tool invocation to BigQuery audit_log table.
 * Fire-and-forget: never blocks tool execution.
 */

import { BigQuery } from '@google-cloud/bigquery';

export interface AuditEntry {
  client_id: string;
  user_id: string;
  tool_name: string;
  tokens_used: number;
  cost_usd: number;
  duration_ms: number;
  success: boolean;
  error_message: string;
  timestamp: Date;
}

export class AuditLogger {
  private bq: BigQuery;
  private dataset: string;
  private table = 'audit_log';

  constructor(projectId: string, dataset: string, credentialsPath?: string, gcpCredentialsBase64?: string) {
    const options: ConstructorParameters<typeof BigQuery>[0] = { projectId };

    if (gcpCredentialsBase64) {
      const decoded = Buffer.from(gcpCredentialsBase64, 'base64').toString('utf-8');
      options.credentials = JSON.parse(decoded);
    } else if (credentialsPath) {
      options.keyFilename = credentialsPath;
    }

    this.bq = new BigQuery(options);
    this.dataset = dataset;
  }

  /**
   * Log an audit entry. Fire-and-forget — errors are logged to stderr, never thrown.
   */
  log(entry: AuditEntry): void {
    const row = {
      ...entry,
      timestamp: entry.timestamp.toISOString(),
    };

    this.bq
      .dataset(this.dataset)
      .table(this.table)
      .insert([row])
      .catch((err) => {
        process.stderr.write(`Audit log write failed: ${err instanceof Error ? err.message : String(err)}\n`);
      });
  }
}
