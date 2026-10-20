/**
 * User tier and API rate limits
 */

export type UserTier = 'free' | 'pro' | 'enterprise';

export interface TierLimits {
  enrichmentsPerDay: number;
  searchesPerDay: number;
  uploadsPerDay: number;
}

/**
 * Daily limits for each user tier
 */
export const TIER_LIMITS: Record<UserTier, TierLimits> = {
  free: {
    enrichmentsPerDay: 100,
    searchesPerDay: 50,
    uploadsPerDay: 5,
  },
  pro: {
    enrichmentsPerDay: 1000,
    searchesPerDay: 500,
    uploadsPerDay: 50,
  },
  enterprise: {
    enrichmentsPerDay: 10000,
    searchesPerDay: 5000,
    uploadsPerDay: 500,
  },
};

export interface ApiLimit {
  requestsPerMinute: number;
}

/**
 * Global API rate limits (requests per minute)
 */
export const API_LIMITS: Record<string, ApiLimit> = {
  claude: {
    requestsPerMinute: 900,
  },
  exa: {
    requestsPerMinute: 400,
  },
};
