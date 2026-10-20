/**
 * @togari/admin — Structured audit logging
 *
 * Writes JSON to stdout with { audit: "true" } marker.
 * Cloud Logging sink routes audit events to BigQuery.
 * NEVER log PHI — only IDs.
 */

import { randomUUID } from 'crypto';
import { getCurrentTenant } from '../tenant/context';

export interface AuditEntry {
  audit_id: string;
  audit: 'true';
  client_id: string;
  user_id: string;
  tool_name: string;
  entity_type?: string;
  entity_id?: string;
  action: string;
  tokens_used?: number;
  cost_usd?: number;
  duration_ms: number;
  status: 'success' | 'error';
  error_code?: string;
  timestamp: string;
  'logging.googleapis.com/trace'?: string;
  /**
   * Free-form structured payload for decisions whose shape doesn't fit
   * the fixed audit columns — e.g. fuzzy name resolution (input_text,
   * matched_user_id, alternative_candidates). Downstream BQ schema
   * stores it as a JSON column.
   */
  metadata?: Record<string, unknown>;
}

export function logAudit(entry: AuditEntry): void {
  const out = process.env.MCP_TRANSPORT === 'stdio' ? process.stderr : process.stdout;
  out.write(JSON.stringify(entry) + '\n');
}

export function createAuditEntry(
  toolName: string,
  clientId: string,
  userId: string,
  durationMs: number,
  status: 'success' | 'error',
  errorCode?: string,
): AuditEntry {
  const traceHeader = process.env.HTTP_X_CLOUD_TRACE_CONTEXT;
  const projectId = process.env.GCP_PROJECT_ID || 'midyear-glazing-485303-u3';

  const entry: AuditEntry = {
    audit_id: randomUUID(),
    audit: 'true',
    client_id: clientId,
    user_id: userId,
    tool_name: toolName,
    action: toolName,
    duration_ms: durationMs,
    status,
    error_code: errorCode,
    timestamp: new Date().toISOString(),
  };

  if (traceHeader) {
    const traceId = traceHeader.split('/')[0];
    entry['logging.googleapis.com/trace'] = `projects/${projectId}/traces/${traceId}`;
  }

  return entry;
}

type ToolResult = {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
};

type ToolHandler<T> = (args: T) => Promise<ToolResult>;

export function withAuditLog<T>(
  toolName: string,
  handler: ToolHandler<T>,
): ToolHandler<T> {
  return async (args: T): Promise<ToolResult> => {
    const startMs = Date.now();
    let clientId = 'unknown';
    let userId = 'unknown';

    try {
      const tenant = getCurrentTenant();
      clientId = tenant.tenantId;
      userId = tenant.userId || 'unknown';
    } catch {}

    try {
      const result = await handler(args);
      const durationMs = Date.now() - startMs;
      const status = result.isError ? 'error' as const : 'success' as const;
      logAudit(createAuditEntry(toolName, clientId, userId, durationMs, status));
      return result;
    } catch (error) {
      const durationMs = Date.now() - startMs;
      const errorCode = (error as any)?.code || 'INTERNAL_ERROR';
      logAudit(createAuditEntry(toolName, clientId, userId, durationMs, 'error', errorCode));
      throw error;
    }
  };
}
