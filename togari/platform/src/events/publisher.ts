/**
 * @togari/admin — Cloud Pub/Sub event publisher
 * Fire-and-forget publishing. Never throws, never blocks tool execution.
 */

import { PubSub, Topic } from '@google-cloud/pubsub';
import { randomUUID } from 'crypto';
import { createLogger } from '../observability/logger';
import { getCurrentTenant } from '../tenant/context';
import type { EventType, BaseEvent } from './types';

const logger = createLogger('EventPublisher');

let pubsub: PubSub | null = null;
let topic: Topic | null = null;
const TOPIC_NAME = 'togari-events';

async function ensureTopic(): Promise<Topic | null> {
  if (topic) return topic;

  try {
    const projectId = process.env.GCP_PROJECT_ID || 'midyear-glazing-485303-u3';
    pubsub = new PubSub({ projectId });
    const [exists] = await pubsub.topic(TOPIC_NAME).exists();
    if (!exists) {
      const [created] = await pubsub.createTopic(TOPIC_NAME);
      topic = created;
      logger.info(`Created Pub/Sub topic: ${TOPIC_NAME}`);
    } else {
      topic = pubsub.topic(TOPIC_NAME);
    }
    return topic;
  } catch (error) {
    logger.warn('Pub/Sub unavailable — events will not be published', {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

export async function publishEvent<T>(
  eventType: EventType,
  payload: T,
  clientId?: string,
): Promise<void> {
  try {
    const t = await ensureTopic();
    if (!t) return;

    let actor: string | undefined;
    let resolvedClientId = clientId;
    try {
      const tenant = getCurrentTenant();
      resolvedClientId = resolvedClientId || tenant.tenantId;
      actor = tenant.userId;
    } catch {}

    const event: BaseEvent<T> = {
      event_id: randomUUID(),
      event_type: eventType,
      client_id: resolvedClientId || 'unknown',
      timestamp: new Date().toISOString(),
      actor,
      payload,
    };

    await t.publishMessage({
      data: Buffer.from(JSON.stringify(event)),
      attributes: {
        event_type: eventType,
        client_id: resolvedClientId || 'unknown',
      },
    });

    logger.debug(`Published event: ${eventType}`, { event_id: event.event_id });
  } catch (error) {
    logger.error('Failed to publish event', error, { eventType });
  }
}
