/**
 * Structured error responses for MCP tool failures.
 *
 * Instead of returning stack traces to Claude (which wastes tokens and confuses
 * the model), tools return a consistent JSON shape that Claude can reason about
 * and relay to the user.
 */

export interface StructuredToolError {
  error: true;
  tool: string;
  message: string;
  retry_possible: boolean;
  /** Optional: downstream service that caused the failure */
  provider?: string;
  /** Optional: HTTP status from the external API */
  status_code?: number;
}

/**
 * Build a structured error response for an MCP tool.
 *
 * @example
 * ```ts
 * return toolError('mof_deal_create', error);
 * // → { content: [{ type: 'text', text: '{"error":true,"tool":"mof_deal_create",...}' }], isError: true }
 * ```
 */
export function toolError(
  toolName: string,
  error: unknown,
  options: { provider?: string; retryable?: boolean } = {},
): { content: [{ type: 'text'; text: string }]; isError: true } {
  const message = error instanceof Error ? error.message : String(error);

  // Determine retry-ability heuristically
  let retry_possible = options.retryable ?? true;
  const lowerMsg = message.toLowerCase();

  // Non-retryable conditions
  if (
    lowerMsg.includes('not found') ||
    lowerMsg.includes('validation') ||
    lowerMsg.includes('invalid') ||
    lowerMsg.includes('missing required') ||
    lowerMsg.includes('forbidden') ||
    lowerMsg.includes('unauthorized') ||
    lowerMsg.includes('not configured')
  ) {
    retry_possible = false;
  }

  // Extract HTTP status if available
  let status_code: number | undefined;
  if (error && typeof error === 'object' && 'statusCode' in error) {
    status_code = (error as { statusCode: number }).statusCode;
  }

  // 4xx = not retryable, 5xx / network = retryable
  if (status_code && status_code >= 400 && status_code < 500) {
    retry_possible = false;
  }

  const structured: StructuredToolError = {
    error: true,
    tool: toolName,
    message,
    retry_possible,
    ...(options.provider && { provider: options.provider }),
    ...(status_code && { status_code }),
  };

  return {
    content: [{ type: 'text' as const, text: JSON.stringify(structured) }],
    isError: true,
  };
}

/**
 * Wrap an MCP tool handler with structured error handling.
 *
 * @example
 * ```ts
 * server.tool('my_tool', 'desc', schema, withStructuredErrors('my_tool', async (params) => {
 *   // ... your logic
 *   return { content: [{ type: 'text', text: result }] };
 * }));
 * ```
 */
export function withStructuredErrors<TParams, TResult>(
  toolName: string,
  handler: (params: TParams) => Promise<TResult>,
  options: { provider?: string } = {},
): (params: TParams) => Promise<TResult | ReturnType<typeof toolError>> {
  return async (params: TParams) => {
    try {
      return await handler(params);
    } catch (error) {
      process.stderr.write(
        `[tool-error] ${toolName}: ${error instanceof Error ? error.message : String(error)}\n`,
      );
      return toolError(toolName, error, options) as any;
    }
  };
}
