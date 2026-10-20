/**
 * Per-tenant and per-connector rate limiting
 *
 * TenantRateLimiter: daily quotas per tenant tier (free/pro/enterprise)
 * ConnectorRateLimiter: sliding-window limits per upstream API
 *
 * Backed by Redis (ioredis). Falls back to in-memory if Redis is unavailable.
 */

import { RateLimiterRedis, RateLimiterMemory, RateLimiterRes } from 'rate-limiter-flexible';
import Redis from 'ioredis';
import { createLogger } from '../utils/logger';
import { RateLimitError } from '../errors/types';
import { TIER_LIMITS, type UserTier } from '../config/limits';

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
// Operation classification
// ---------------------------------------------------------------------------

type Operation = 'enrichment' | 'search' | 'upload';

const TOOL_OPERATION_MAP: Record<string, Operation> = {
  enrich_contact: 'enrichment',
  enrich_company: 'enrichment',
  normalize_data: 'enrichment',
  search_patients: 'search',
  query_data: 'search',
  search_web: 'search',
  upload_file: 'upload',
  process_file: 'upload',
};

const TIER_LIMIT_KEYS: Record<Operation, keyof typeof TIER_LIMITS['free']> = {
  enrichment: 'enrichmentsPerDay',
  search: 'searchesPerDay',
  upload: 'uploadsPerDay',
};

export function getOperationForTool(toolName: string): Operation | undefined {
  return TOOL_OPERATION_MAP[toolName];
}

// ---------------------------------------------------------------------------
// TenantRateLimiter
// ---------------------------------------------------------------------------

const tenantLimiters = new Map<string, RateLimiterRedis | RateLimiterMemory>();

function getTenantLimiter(tier: UserTier, operation: Operation): RateLimiterRedis | RateLimiterMemory {
  const key = `${tier}:${operation}`;
  let limiter = tenantLimiters.get(key);
  if (limiter) return limiter;

  const limit = TIER_LIMITS[tier][TIER_LIMIT_KEYS[operation]];
  const opts = {
    keyPrefix: `tenant:${operation}`,
    points: limit,
    duration: 86400, // 1 day in seconds
  };

  if (redisAvailable && redisClient) {
    limiter = new RateLimiterRedis({ storeClient: redisClient, ...opts });
  } else {
    limiter = new RateLimiterMemory(opts);
  }

  tenantLimiters.set(key, limiter);
  return limiter;
}

export async function checkTenantLimit(
  tenantId: string,
  tier: UserTier,
  toolName: string,
): Promise<void> {
  const operation = getOperationForTool(toolName);
  if (!operation) return; // Tools without limits (health_check, score_lead, etc.)

  const limiter = getTenantLimiter(tier, operation);
  try {
    await limiter.consume(tenantId);
  } catch (error) {
    if (error instanceof RateLimiterRes) {
      const retryAfter = Math.ceil(error.msBeforeNext / 1000);
      logger.info('Tenant rate limit hit', {
        audit: 'true',
        tenantId,
        tier,
        operation,
        toolName,
        retryAfter,
      });
      throw new RateLimitError(retryAfter, `${tier} tier ${operation} daily limit`);
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// ConnectorRateLimiter
// ---------------------------------------------------------------------------

const CONNECTOR_LIMITS: Record<string, number> = {
  anthropic: 900,
  exa: 400,
  structify: 100,
  clay: 200,
};

const TOOL_CONNECTOR_MAP: Record<string, string> = {
  enrich_contact: 'exa', // primary connector
  enrich_company: 'exa',
  search_web: 'exa',
  normalize_data: 'anthropic',
  search_patients: 'structify',
  query_data: 'structify',
  create_patient: 'structify',
  get_patient: 'structify',
  update_patient: 'structify',
};

const connectorLimiters = new Map<string, RateLimiterRedis | RateLimiterMemory>();

function getConnectorLimiter(connector: string): RateLimiterRedis | RateLimiterMemory {
  let limiter = connectorLimiters.get(connector);
  if (limiter) return limiter;

  const limit = CONNECTOR_LIMITS[connector] || 100;
  const opts = {
    keyPrefix: `connector:${connector}`,
    points: limit,
    duration: 60, // 1 minute sliding window
  };

  if (redisAvailable && redisClient) {
    limiter = new RateLimiterRedis({ storeClient: redisClient, ...opts });
  } else {
    limiter = new RateLimiterMemory(opts);
  }

  connectorLimiters.set(connector, limiter);
  return limiter;
}

export async function checkConnectorLimit(toolName: string): Promise<void> {
  const connector = TOOL_CONNECTOR_MAP[toolName];
  if (!connector) return;

  const limiter = getConnectorLimiter(connector);
  try {
    await limiter.consume(connector);
  } catch (error) {
    if (error instanceof RateLimiterRes) {
      // Queue and wait instead of failing immediately
      const waitMs = error.msBeforeNext;
      logger.debug(`Connector rate limit for ${connector}, waiting ${waitMs}ms`);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      // Retry once after waiting
      await limiter.consume(connector);
    } else {
      throw error;
    }
  }
}
