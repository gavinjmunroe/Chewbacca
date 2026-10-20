/**
 * API Constants
 * Centralized constants for API routes and configuration
 */

export const API_ROUTES = {
  TRPC: '/api/trpc',
  AMBER_WEBHOOK: '/api/v1/amber',
  WEBHOOKS: '/api/v1/webhooks',
  HEALTH: '/health',
} as const;

export const API_ENDPOINTS = {
  AMBER_SUBMIT: '/submit',
  CLAY_ENRICHMENT: '/clay/enrichment',
  SCORING_UPDATE: '/scoring/update',
  N8N_CALLBACK: '/n8n/callback',
} as const;

export const DEFAULT_VALUES = {
  PORT: 4000,
  ALLOWED_ORIGINS: 'http://localhost:3000',
  ACCESS_TOKEN_EXPIRE_MINUTES: 30,
  MAX_BATCH_SIZE: 100,
  REQUEST_SIZE_LIMIT: '1mb',
} as const;

/**
 * Pagination Configuration
 */
export const PAGINATION = {
  DEFAULT_LIMIT: 50,
  MAX_LIMIT: 1000,
  MIN_LIMIT: 1,
  MIN_OFFSET: 0,
} as const;

/**
 * Retry Configuration
 */
export const RETRY = {
  MAX_ATTEMPTS: 3,
  DELAY_MS: 1000,
} as const;

/**
 * Timeout Configuration (in milliseconds)
 */
export const TIMEOUTS = {
  REQUEST: 30000, // 30 seconds
  RATE_LIMIT_WINDOW: 60000, // 1 minute
} as const;

/**
 * Rate Limiting
 */
export const RATE_LIMITS = {
  GENERAL_MAX_REQUESTS: 100, // Per window
  AUTH_MAX_REQUESTS: 5, // Per window
  HEALTH_MAX_REQUESTS: 100, // Per window
} as const;

/**
 * AI/LLM Configuration
 */
export const AI_LIMITS = {
  MAX_TOKENS: 4000,
  DEFAULT_TOKENS: 1000,
  MAX_ROWS: 1000,
} as const;

/**
 * Score Configuration
 */
export const SCORES = {
  MIN: 0,
  MAX: 100,
} as const;
