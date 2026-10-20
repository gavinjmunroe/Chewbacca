/**
 * @togari/admin — Tenant types
 */

export interface TenantContext {
  /** Tenant slug (e.g. "48n", "bma") — sourced from JWT custom claim
   *  https://togari.app/client_id, set by Auth0 Action from org_metadata.client_id.
   *  Falls back to raw org_id if the custom claim isn't present. */
  tenantId: string;
  /** Auth0 user sub — identifies the individual user */
  userId?: string;
  /** User email for audit logging */
  userEmail?: string;
  /** Subscription tier — determines rate limits and quotas */
  tier: 'free' | 'pro' | 'enterprise';
}
