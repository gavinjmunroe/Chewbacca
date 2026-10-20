/**
 * Rate limit wrapper for MCP tool handlers
 *
 * Checks tenant limits (daily quotas) then connector limits (per-minute)
 * before executing the tool handler. Returns a 429 error on limit exceeded.
 */

import { getCurrentTenant } from './tenant';
import { checkTenantLimit, checkConnectorLimit } from '../services/rate-limiter';
import type { UserTier } from '../config/limits';

type ToolResult = {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
};

type ToolHandler<T> = (args: T) => Promise<ToolResult>;

/**
 * Wrap a tool handler with tenant + connector rate limiting.
 */
export function withRateLimit<T>(
  toolName: string,
  handler: ToolHandler<T>,
): ToolHandler<T> {
  return async (args: T): Promise<ToolResult> => {
    // Get tenant context for tier-based limits
    let tier: UserTier = 'free';
    let tenantId = 'unknown';
    try {
      const tenant = getCurrentTenant();
      tenantId = tenant.tenantId;
      tier = (tenant.tier as UserTier) || 'free';
    } catch {
      // No tenant context (e.g. health_check) — skip tenant limits
    }

    // Check tenant daily quota
    if (tenantId !== 'unknown') {
      await checkTenantLimit(tenantId, tier, toolName);
    }

    // Check connector per-minute limit
    await checkConnectorLimit(toolName);

    // Execute the actual tool handler
    return handler(args);
  };
}
