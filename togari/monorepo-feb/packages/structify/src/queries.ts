import type { QueryFilter, QueryOptions } from './client';
import type { LeadStatus, RoutingTier, Vertical } from '@togari/core';

/**
 * Query Builder for type-safe Structify queries
 */
export class QueryBuilder {
  private filters: QueryFilter[] = [];
  private _limit?: number;
  private _offset?: number;
  private _orderBy?: string;
  private _orderDirection?: 'asc' | 'desc';

  /**
   * Add a filter condition
   */
  where(field: string, operator: QueryFilter['operator'], value: any): this {
    this.filters.push({ field, operator, value });
    return this;
  }

  /**
   * Filter by organization ID (always required)
   */
  forOrganization(organizationId: string): this {
    return this.where('organizationId', 'eq', organizationId);
  }

  /**
   * Filter by status
   */
  withStatus(status: LeadStatus): this {
    return this.where('currentStatus', 'eq', status);
  }

  /**
   * Filter by routing tier
   */
  withRoutingTier(tier: RoutingTier): this {
    return this.where('routingTier', 'eq', tier);
  }

  /**
   * Filter by vertical
   */
  forVertical(vertical: Vertical): this {
    return this.where('vertical', 'eq', vertical);
  }

  /**
   * Filter by minimum score
   */
  withMinScore(score: number): this {
    return this.where('compositeScore', 'gte', score);
  }

  /**
   * Filter by source channel
   */
  fromChannel(channel: string): this {
    return this.where('sourceChannel', 'eq', channel);
  }

  /**
   * Set result limit
   */
  limit(count: number): this {
    this._limit = count;
    return this;
  }

  /**
   * Set result offset (for pagination)
   */
  offset(count: number): this {
    this._offset = count;
    return this;
  }

  /**
   * Set ordering
   */
  orderBy(field: string, direction: 'asc' | 'desc' = 'asc'): this {
    this._orderBy = field;
    this._orderDirection = direction;
    return this;
  }

  /**
   * Build the final query options
   */
  build(): QueryOptions {
    return {
      filters: this.filters.length > 0 ? this.filters : undefined,
      limit: this._limit,
      offset: this._offset,
      orderBy: this._orderBy,
      orderDirection: this._orderDirection,
    };
  }
}

/**
 * Helper to create a new query builder
 */
export function query(): QueryBuilder {
  return new QueryBuilder();
}

/**
 * Common query presets
 */
export const presets = {
  /**
   * Get high-touch leads
   */
  highTouchLeads: (organizationId: string) =>
    query()
      .forOrganization(organizationId)
      .withRoutingTier('high_touch')
      .withStatus('new')
      .orderBy('compositeScore', 'desc'),

  /**
   * Get engaged leads
   */
  engagedLeads: (organizationId: string) =>
    query()
      .forOrganization(organizationId)
      .where('currentStatus', 'in', ['engaged', 'qualified', 'opportunity'])
      .orderBy('lastContactedAt', 'desc'),

  /**
   * Get leads for nurture campaign
   */
  nurtureLeads: (organizationId: string) =>
    query()
      .forOrganization(organizationId)
      .withRoutingTier('nurture')
      .withStatus('contacted')
      .orderBy('createdAt', 'asc'),

  /**
   * Get recent leads (last 7 days)
   */
  recentLeads: (organizationId: string) =>
    query()
      .forOrganization(organizationId)
      .where('createdAt', 'gte', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000))
      .orderBy('createdAt', 'desc'),

  /**
   * Get leads by campaign
   */
  campaignLeads: (organizationId: string, campaignId: string) =>
    query()
      .forOrganization(organizationId)
      .where('sourceCampaign', 'eq', campaignId)
      .orderBy('createdAt', 'desc'),
};
