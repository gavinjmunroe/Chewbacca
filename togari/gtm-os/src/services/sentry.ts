/**
 * Sentry error tracking integration.
 *
 * Initializes @sentry/node at server startup. All unhandled exceptions and
 * tool handler errors are captured automatically.
 *
 * Set SENTRY_DSN env var to enable. If unset, all capture calls are no-ops.
 *
 * Usage:
 *   import { initSentry, captureException, wrapToolHandler } from './services/sentry';
 *
 *   // At startup:
 *   initSentry();
 *
 *   // In tool handlers:
 *   server.tool('my_tool', 'desc', schema, wrapToolHandler('my_tool', async (params) => { ... }));
 *
 *   // Manual capture:
 *   captureException(error, { tags: { tool: 'my_tool' } });
 */

// ─── Types ──────────────────────────────────────────────────────────────────

interface SentryLike {
  init: (options: Record<string, unknown>) => void;
  captureException: (error: Error, context?: Record<string, unknown>) => string;
  captureMessage: (message: string, level?: string) => string;
  setTag: (key: string, value: string) => void;
  setUser: (user: { id: string; [key: string]: unknown } | null) => void;
  withScope: (callback: (scope: ScopeLike) => void) => void;
  startSpan: (options: Record<string, unknown>, callback: () => unknown) => unknown;
  flush: (timeout?: number) => Promise<boolean>;
}

interface ScopeLike {
  setTag: (key: string, value: string) => void;
  setExtra: (key: string, value: unknown) => void;
}

// ─── State ──────────────────────────────────────────────────────────────────

let sentry: SentryLike | null = null;
let initialized = false;

// ─── Initialization ─────────────────────────────────────────────────────────

/**
 * Initialize Sentry. Call once at server startup.
 * No-op if SENTRY_DSN is not configured.
 */
export function initSentry(): void {
  if (initialized) return;
  initialized = true;

  const dsn = process.env.SENTRY_DSN;
  if (!dsn) {
    process.stderr.write('[sentry] SENTRY_DSN not configured — error tracking disabled\n');
    return;
  }

  try {
    // Dynamic import to avoid hard dependency — @sentry/node is optional
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    sentry = require('@sentry/node') as SentryLike;

    sentry.init({
      dsn,
      environment: process.env.NODE_ENV ?? 'development',
      release: `togari-gtm@${process.env.npm_package_version ?? '1.0.0'}`,
      tracesSampleRate: parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE ?? '0.1'),
      // Don't send PII — strip user-identifiable data
      sendDefaultPii: false,
      // Tag every event with the service name
      initialScope: {
        tags: {
          service: 'togari-gtm',
        },
      },
    });

    process.stderr.write('[sentry] Initialized error tracking\n');
  } catch (error) {
    process.stderr.write(
      `[sentry] Failed to initialize: ${error instanceof Error ? error.message : error}. ` +
      `Install @sentry/node to enable: npm install @sentry/node\n`,
    );
    sentry = null;
  }
}

// ─── Capture helpers ────────────────────────────────────────────────────────

/**
 * Capture an exception to Sentry. No-op if Sentry is not initialized.
 */
export function captureException(
  error: Error,
  context?: { tags?: Record<string, string>; extra?: Record<string, unknown> },
): void {
  if (!sentry) return;

  sentry.withScope((scope) => {
    if (context?.tags) {
      for (const [key, value] of Object.entries(context.tags)) {
        scope.setTag(key, value);
      }
    }
    if (context?.extra) {
      for (const [key, value] of Object.entries(context.extra)) {
        scope.setExtra(key, value);
      }
    }
    sentry!.captureException(error);
  });
}

/**
 * Capture a message to Sentry. No-op if Sentry is not initialized.
 */
export function captureMessage(
  message: string,
  level: 'info' | 'warning' | 'error' = 'info',
): void {
  if (!sentry) return;
  sentry.captureMessage(message, level);
}

/**
 * Set the current user context for Sentry.
 */
export function setSentryUser(userId: string, clientId?: string): void {
  if (!sentry) return;
  sentry.setUser({
    id: userId,
    ...(clientId && { client_id: clientId }),
  });
}

/**
 * Clear the current user context.
 */
export function clearSentryUser(): void {
  if (!sentry) return;
  sentry.setUser(null);
}

// ─── MCP tool wrapper ───────────────────────────────────────────────────────

type ToolResult = { content: Array<{ type: string; text: string }>; isError?: boolean };

/**
 * Wrap an MCP tool handler with Sentry error boundary.
 *
 * On error: captures the exception to Sentry, returns a structured error
 * response to Claude (not a stack trace).
 *
 * @example
 * ```ts
 * server.tool('my_tool', 'desc', schema, wrapToolHandler('my_tool', async (params) => {
 *   // ... your logic
 *   return { content: [{ type: 'text', text: 'result' }] };
 * }));
 * ```
 */
export function wrapToolHandler<TParams>(
  toolName: string,
  handler: (params: TParams) => Promise<ToolResult>,
): (params: TParams) => Promise<ToolResult> {
  return async (params: TParams): Promise<ToolResult> => {
    try {
      return await handler(params);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));

      // Capture to Sentry with tool context
      captureException(err, {
        tags: { tool: toolName },
        extra: { params },
      });

      // Return structured error to Claude (not a stack trace)
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            error: true,
            tool: toolName,
            message: err.message,
            retry_possible: !err.message.toLowerCase().includes('not found') &&
                            !err.message.toLowerCase().includes('not configured'),
          }),
        }],
        isError: true,
      };
    }
  };
}

// ─── Shutdown ───────────────────────────────────────────────────────────────

/**
 * Flush pending Sentry events. Call before process exit.
 */
export async function flushSentry(timeoutMs = 2000): Promise<void> {
  if (!sentry) return;
  await sentry.flush(timeoutMs);
}

// ─── Testing helpers ────────────────────────────────────────────────────────

export function resetSentry(): void {
  sentry = null;
  initialized = false;
}
