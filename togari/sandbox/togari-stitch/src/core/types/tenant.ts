/**
 * @togari/core/types/tenant
 * Tenant context for multi-tenant isolation
 */

/**
 * TenantContext holds the identity of the currently authenticated tenant.
 * Populated by Auth0 JWT middleware in HTTP mode or env vars in stdio mode.
 */
export interface TenantContext {
  /** Auth0 org_id — the primary tenant identifier */
  tenantId: string;
  /** Auth0 user sub — identifies the individual user */
  userId?: string;
  /** User email for audit logging */
  userEmail?: string;
  /** Subscription tier — determines rate limits and quotas */
  tier: 'free' | 'pro' | 'enterprise';
}
