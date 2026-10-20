/**
 * Audit logging wrapper for MCP tool handlers
 *
 * Wraps each tool handler to:
 * 1. Time execution
 * 2. Capture success/error status
 * 3. Log structured audit entry to stdout (for Cloud Logging → BigQuery)
 *
 * NEVER logs PHI — only entity IDs, tool names, and metadata.
 */

import { getCurrentTenant } from './tenant';
import { logAudit, createAuditEntry } from '../services/audit-logger';
import { AppError } from '../errors/types';

type ToolResult = {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
};

type ToolHandler<T> = (args: T) => Promise<ToolResult>;

/**
 * Wrap a tool handler with structured audit logging.
 */
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
    } catch {
      // No tenant context (e.g. health_check in some modes)
    }

    try {
      const result = await handler(args);
      const durationMs = Date.now() - startMs;

      const status = result.isError ? 'error' as const : 'success' as const;
      const entry = createAuditEntry(
        toolName,
        clientId,
        userId,
        args as Record<string, unknown>,
        durationMs,
        status,
      );
      logAudit(entry);

      return result;
    } catch (error) {
      const durationMs = Date.now() - startMs;
      const errorCode = error instanceof AppError ? error.code : 'INTERNAL_ERROR';

      const entry = createAuditEntry(
        toolName,
        clientId,
        userId,
        args as Record<string, unknown>,
        durationMs,
        'error',
        errorCode,
      );
      logAudit(entry);

      throw error;
    }
  };
}
