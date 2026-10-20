/**
 * @togari/admin — Rate limiting
 *
 * TenantRateLimiter: daily quotas per tenant tier
 * ConnectorRateLimiter: sliding-window limits per upstream API
 * Backed by Redis with in-memory fallback.
 */

import { RateLimiterRedis, RateLimiterMemory, RateLimiterRes } from 'rate-limiter-flexible';
import Redis from 'ioredis';
import { createLogger } from '../observability/logger';
import { RateLimitError } from '../errors/types';
import { TIER_LIMITS, type UserTier } from '../config/limits';
import { getCurrentTenant } from '../tenant/context';

const logger = createLogger('rate-limiter');

// ---------------------------------------------------------------------------
// Redis client (shared singleton)
// ---------------------------------------------------------------------------

let redisClient: Redis | null = null;
let redisAvailable = false;

export async function initRedis(url: string): Promise<void> {
  try {
    redisClient = new Redis(url, {
      maxRetriesPerRequest: 1,
      enableReadyCheck: true,
      lazyConnect: true,
      connectTimeout: 5000,
    });
    await redisClient.connect();
    redisAvailable = true;
    logger.info('Redis connected for rate limiting');
  } catch (error) {
    logger.warn('Redis unavailable — falling back to in-memory rate limiting', {
      error: error instanceof Error ? error.message : String(error),
    });
    redisClient = null;
    redisAvailable = false;
  }
}

// ---------------------------------------------------------------------------
// Configurable tool mappings
// ---------------------------------------------------------------------------

export type Operation = 'enrichment' | 'search' | 'upload' | 'write' | 'generate';

let toolOperationMap: Record<string, Operation> = {};
let toolConnectorMap: Record<string, string> = {};
let connectorLimitsConfig: Record<string, number> = {
  anthropic: 900,
  exa: 400,
  structify: 100,
  clay: 200,
};

const TIER_LIMIT_KEYS: Record<Operation, keyof typeof TIER_LIMITS['free']> = {
  enrichment: 'enrichmentsPerDay',
  search: 'searchesPerDay',
  upload: 'uploadsPerDay',
  write: 'enrichmentsPerDay',
  generate: 'enrichmentsPerDay',
};

export function configureRateLimits(config: {
  toolOperationMap?: Record<string, Operation>;
  toolConnectorMap?: Record<string, string>;
  connectorLimits?: Record<string, number>;
}): void {
  if (config.toolOperationMap) toolOperationMap = { ...toolOperationMap, ...config.toolOperationMap };
  if (config.toolConnectorMap) toolConnectorMap = { ...toolConnectorMap, ...config.toolConnectorMap };
  if (config.connectorLimits) connectorLimitsConfig = { ...connectorLimitsConfig, ...config.connectorLimits };
}

// ---------------------------------------------------------------------------
// TenantRateLimiter
// ---------------------------------------------------------------------------

const tenantLimiters = new Map<string, RateLimiterRedis | RateLimiterMemory>();

function getTenantLimiter(tier: UserTier, operation: Operation): RateLimiterRedis | RateLimiterMemory {
  const key = `${tier}:${operation}`;
  let limiter = tenantLimiters.get(key);
  if (limiter) return limiter;

  const limitKey = TIER_LIMIT_KEYS[operation];
  const limit = TIER_LIMITS[tier][limitKey];
  const opts = { keyPrefix: `tenant:${operation}`, points: limit, duration: 86400 };

  limiter = (redisAvailable && redisClient)
    ? new RateLimiterRedis({ storeClient: redisClient, ...opts })
    : new RateLimiterMemory(opts);

  tenantLimiters.set(key, limiter);
  return limiter;
}

export async function checkTenantLimit(tenantId: string, tier: UserTier, toolName: string): Promise<void> {
  const operation = toolOperationMap[toolName];
  if (!operation) return;

  const limiter = getTenantLimiter(tier, operation);
  try {
    await limiter.consume(tenantId);
  } catch (error) {
    if (error instanceof RateLimiterRes) {
      const retryAfter = Math.ceil(error.msBeforeNext / 1000);
      throw new RateLimitError(retryAfter, `${tier} tier ${operation} daily limit`);
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// ConnectorRateLimiter
// ---------------------------------------------------------------------------

const connectorLimiters = new Map<string, RateLimiterRedis | RateLimiterMemory>();

function getConnectorLimiter(connector: string): RateLimiterRedis | RateLimiterMemory {
  let limiter = connectorLimiters.get(connector);
  if (limiter) return limiter;

  const limit = connectorLimitsConfig[connector] || 100;
  const opts = { keyPrefix: `connector:${connector}`, points: limit, duration: 60 };

  limiter = (redisAvailable && redisClient)
    ? new RateLimiterRedis({ storeClient: redisClient, ...opts })
    : new RateLimiterMemory(opts);

  connectorLimiters.set(connector, limiter);
  return limiter;
}

export async function checkConnectorLimit(toolName: string): Promise<void> {
  const connector = toolConnectorMap[toolName];
  if (!connector) return;

  const limiter = getConnectorLimiter(connector);
  try {
    await limiter.consume(connector);
  } catch (error) {
    if (error instanceof RateLimiterRes) {
      const waitMs = error.msBeforeNext;
      logger.debug(`Connector rate limit for ${connector}, waiting ${waitMs}ms`);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      await limiter.consume(connector);
    } else {
      throw error;
    }
  }
}

// ---------------------------------------------------------------------------
// HOF wrapper
// ---------------------------------------------------------------------------

type ToolResult = {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
};

type ToolHandler<T> = (args: T) => Promise<ToolResult>;

export function withRateLimit<T>(toolName: string, handler: ToolHandler<T>): ToolHandler<T> {
  return async (args: T): Promise<ToolResult> => {
    let tier: UserTier = 'free';
    let tenantId = 'unknown';
    try {
      const tenant = getCurrentTenant();
      tenantId = tenant.tenantId;
      tier = (tenant.tier as UserTier) || 'free';
    } catch {}

    if (tenantId !== 'unknown') await checkTenantLimit(tenantId, tier, toolName);
    await checkConnectorLimit(toolName);
    return handler(args);
  };
}
