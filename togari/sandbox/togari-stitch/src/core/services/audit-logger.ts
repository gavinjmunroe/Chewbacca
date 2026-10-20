/**
 * Structured audit logging
 *
 * Writes JSON to stdout with { audit: "true" } marker.
 * Cloud Logging picks this up automatically. A logging sink routes
 * audit events (filter: audit="true") to BigQuery for analytics.
 *
 * NEVER log PHI (patient names, emails, health data). Only IDs.
 */

import { randomUUID } from 'crypto';

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
}

// ---------------------------------------------------------------------------
// Tool → entity/action inference
// ---------------------------------------------------------------------------

const TOOL_ENTITY_MAP: Record<string, string> = {
  create_patient: 'person',
  get_patient: 'person',
  update_patient: 'person',
  search_patients: 'person',
  enrich_contact: 'person',
  enrich_company: 'company',
  score_lead: 'person',
  normalize_data: 'data',
  query_data: 'data',
  upload_file: 'file',
  process_file: 'file',
  search_web: 'web',
  health_check: 'system',
};

const TOOL_ACTION_MAP: Record<string, string> = {
  create_patient: 'create',
  get_patient: 'read',
  update_patient: 'update',
  search_patients: 'search',
  enrich_contact: 'enrich',
  enrich_company: 'enrich',
  score_lead: 'score',
  normalize_data: 'normalize',
  query_data: 'query',
  upload_file: 'upload',
  process_file: 'process',
  search_web: 'search',
  health_check: 'health_check',
};

function inferEntityId(toolName: string, args: Record<string, unknown>): string | undefined {
  if (args.person_id) return String(args.person_id);
  if (args.identifier) return '[redacted]'; // Could be email/name — don't log
  if (args.domain) return String(args.domain);
  if (args.file_name) return String(args.file_name);
  return undefined;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function logAudit(entry: AuditEntry): void {
  // In stdio mode, stdout is reserved for JSON-RPC — route audit logs to stderr.
  // In HTTP/Cloud Run mode, Cloud Logging auto-ingests structured JSON on stdout.
  const out = process.env.MCP_TRANSPORT === 'stdio' ? process.stderr : process.stdout;
  out.write(JSON.stringify(entry) + '\n');
}

export function createAuditEntry(
  toolName: string,
  clientId: string,
  userId: string,
  args: Record<string, unknown>,
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
    entity_type: TOOL_ENTITY_MAP[toolName],
    entity_id: inferEntityId(toolName, args),
    action: TOOL_ACTION_MAP[toolName] || toolName,
    duration_ms: durationMs,
    status,
    error_code: errorCode,
    timestamp: new Date().toISOString(),
  };

  // Cloud Trace correlation
  if (traceHeader) {
    const traceId = traceHeader.split('/')[0];
    entry['logging.googleapis.com/trace'] = `projects/${projectId}/traces/${traceId}`;
  }

  return entry;
}
