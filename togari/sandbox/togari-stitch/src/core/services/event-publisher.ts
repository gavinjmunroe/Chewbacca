/**
 * Pub/Sub event publisher for data mutations
 *
 * Fire-and-forget pattern: publish events asynchronously without blocking
 * the tool's hot path. Errors are logged but never fail the primary operation.
 *
 * Topic: togari-healthcare-events
 * Project: midyear-glazing-485303-u3
 */

import { randomUUID } from 'crypto';
import { createLogger } from '../utils/logger';
import { getCurrentTenant } from '../middleware/tenant';

const logger = createLogger('event-publisher');

const GCP_PROJECT_ID = 'midyear-glazing-485303-u3';
const TOPIC_NAME = 'togari-healthcare-events';

// ---------------------------------------------------------------------------
// Pub/Sub client (lazy-loaded)
// ---------------------------------------------------------------------------

let pubsubTopic: any = null;
let pubsubInitAttempted = false;

async function getTopic(): Promise<any> {
  if (pubsubInitAttempted && !pubsubTopic) return null;

  try {
    if (!pubsubTopic) {
      pubsubInitAttempted = true;
      const { PubSub } = await import('@google-cloud/pubsub');
      const pubsub = new PubSub({ projectId: GCP_PROJECT_ID });
      pubsubTopic = pubsub.topic(TOPIC_NAME, {
        batching: {
          maxMessages: 10,
          maxMilliseconds: 100,
        },
      });
    }
    return pubsubTopic;
  } catch (error) {
    logger.debug('Pub/Sub unavailable', {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

// ---------------------------------------------------------------------------
// Event types
// ---------------------------------------------------------------------------

export type EventType =
  | 'person_created'
  | 'person_updated'
  | 'person_scored'
  | 'person_enriched'
  | 'company_enriched'
  | 'campaign_created'
  | 'touchpoint_logged'
  | 'file_uploaded'
  | 'file_processed'
  | 'scoring_tier_changed'
  | 'rate_limit_hit';

export interface HealthcareEvent {
  event_id: string;
  event_type: EventType;
  client_id: string;
  entity_type?: string;
  entity_id?: string;
  timestamp: string;
  payload: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Core publish (fire-and-forget)
// ---------------------------------------------------------------------------

async function publishEvent(event: HealthcareEvent): Promise<void> {
  try {
    const topic = await getTopic();
    if (!topic) return; // Pub/Sub unavailable (local dev)

    const data = Buffer.from(JSON.stringify(event));
    const attributes: Record<string, string> = {
      event_type: event.event_type,
      client_id: event.client_id,
    };
    if (event.entity_type) attributes.entity_type = event.entity_type;

    // Fire-and-forget: don't await the publish result
    topic.publishMessage({ data, attributes }).catch((error: unknown) => {
      logger.warn('Failed to publish event', {
        event_type: event.event_type,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  } catch (error) {
    // Never fail the primary operation
    logger.warn('Event publish error', {
      event_type: event.event_type,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

// ---------------------------------------------------------------------------
// Convenience functions
// ---------------------------------------------------------------------------

function getTenantId(): string {
  try {
    return getCurrentTenant().tenantId;
  } catch {
    return 'unknown';
  }
}

export function publishEntityEvent(
  type: EventType,
  entityType: string,
  entityId: string,
  data: Record<string, unknown> = {},
): void {
  const event: HealthcareEvent = {
    event_id: randomUUID(),
    event_type: type,
    client_id: getTenantId(),
    entity_type: entityType,
    entity_id: entityId,
    timestamp: new Date().toISOString(),
    payload: data,
  };
  // Fire-and-forget — don't block caller
  publishEvent(event).catch(() => {});
}

export function publishScoringEvent(
  personId: string,
  scores: { composite: number; internal: number; external: number },
  tier: string,
  factors: Record<string, unknown> = {},
): void {
  publishEntityEvent('person_scored', 'person', personId, {
    composite_score: scores.composite,
    internal_score: scores.internal,
    external_score: scores.external,
    tier,
    factors,
  });
}

export function publishEnrichmentEvent(
  entityId: string,
  entityType: string,
  source: string,
  data: Record<string, unknown> = {},
  costUsd?: number,
): void {
  const eventType: EventType = entityType === 'company' ? 'company_enriched' : 'person_enriched';
  publishEntityEvent(eventType, entityType, entityId, {
    source,
    cost_usd: costUsd,
    ...data,
  });
}
