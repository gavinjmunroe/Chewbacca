/**
 * Cloud Pub/Sub event publisher.
 *
 * publishEvent() is fire-and-forget — it never blocks tool execution and
 * never throws. Failed publishes are logged to stderr and Sentry (if configured).
 *
 * Usage:
 *   await publishEvent('deal_created', { deal_id, deal_name, ... }, clientId);
 *
 * The Pub/Sub topic is created automatically on first use if it doesn't exist.
 * Set PUBSUB_TOPIC env var to override the default 'togari-events'.
 */

import { PubSub, Topic } from '@google-cloud/pubsub';
import { randomUUID } from 'crypto';
import type { EventType, EventPayloadMap, BaseEvent } from './types';
import { getRequestClientId, getRequestUserId } from '../middleware/auth';
import { captureException } from '../services/sentry';

// ─── Configuration ──────────────────────────────────────────────────────────

const TOPIC_NAME = process.env.PUBSUB_TOPIC ?? 'togari-events';
const PROJECT_ID = process.env.GCP_PROJECT_ID ?? 'midyear-glazing-485303-u3';

// ─── Singleton client ───────────────────────────────────────────────────────

let pubsubClient: PubSub | null = null;
let topicRef: Topic | null = null;
let topicVerified = false;

function getPubSubClient(): PubSub {
  if (!pubsubClient) {
    const options: ConstructorParameters<typeof PubSub>[0] = { projectId: PROJECT_ID };

    const credentialsBase64 = process.env.GCP_CREDENTIALS_BASE64;
    const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;

    if (credentialsBase64) {
      const decoded = Buffer.from(credentialsBase64, 'base64').toString('utf-8');
      options.credentials = JSON.parse(decoded);
    } else if (credentialsPath) {
      options.keyFilename = credentialsPath;
    }

    pubsubClient = new PubSub(options);
  }
  return pubsubClient;
}

async function getOrCreateTopic(): Promise<Topic> {
  if (topicRef && topicVerified) return topicRef;

  const client = getPubSubClient();
  topicRef = client.topic(TOPIC_NAME);

  if (!topicVerified) {
    try {
      const [exists] = await topicRef.exists();
      if (!exists) {
        await client.createTopic(TOPIC_NAME);
        process.stderr.write(`[events] Created Pub/Sub topic: ${TOPIC_NAME}\n`);
      }
      topicVerified = true;
    } catch (error) {
      // If topic creation fails (e.g. permissions), we'll still try to publish.
      // The publish will fail with a clearer error if the topic truly doesn't exist.
      process.stderr.write(
        `[events] Could not verify topic ${TOPIC_NAME}: ${error instanceof Error ? error.message : error}\n`,
      );
      topicVerified = true; // Don't retry verification every call
    }
  }

  return topicRef;
}

// ─── Publisher ──────────────────────────────────────────────────────────────

/**
 * Publish an event to the togari-events Pub/Sub topic.
 *
 * Fire-and-forget: errors are logged but never thrown.
 * client_id is inferred from the current request context if not provided.
 *
 * @param eventType - The event type discriminator
 * @param payload - Event-specific data (type-safe per eventType)
 * @param clientId - Override client_id (defaults to JWT context)
 */
export async function publishEvent<T extends EventType>(
  eventType: T,
  payload: EventPayloadMap[T],
  clientId?: string,
): Promise<void> {
  try {
    const resolvedClientId = clientId ?? getRequestClientId() ?? 'unknown';
    const actor = getRequestUserId() ?? 'system';

    const event: BaseEvent<T> = {
      event_id: randomUUID(),
      event_type: eventType,
      client_id: resolvedClientId,
      timestamp: new Date().toISOString(),
      actor,
      payload,
    };

    const topic = await getOrCreateTopic();
    const messageBuffer = Buffer.from(JSON.stringify(event));

    await topic.publishMessage({
      data: messageBuffer,
      attributes: {
        event_type: eventType,
        client_id: resolvedClientId,
        event_id: event.event_id,
      },
    });

    process.stderr.write(
      `[events] Published ${eventType} (${event.event_id}) for client ${resolvedClientId}\n`,
    );
  } catch (error) {
    // Fire-and-forget: log and move on
    process.stderr.write(
      `[events] Failed to publish ${eventType}: ${error instanceof Error ? error.message : error}\n`,
    );
    captureException(error instanceof Error ? error : new Error(String(error)), {
      tags: { event_type: eventType },
    });
  }
}

/**
 * Publish multiple events in a batch.
 * Each event is independent — one failure doesn't affect others.
 */
export async function publishEvents(
  events: Array<{ type: EventType; payload: EventPayloadMap[EventType]; clientId?: string }>,
): Promise<void> {
  await Promise.all(
    events.map(({ type, payload, clientId }) => publishEvent(type, payload as any, clientId)),
  );
}

// ─── Testing helpers ────────────────────────────────────────────────────────

/**
 * Reset singleton state (for tests).
 */
export function resetPubSubClient(): void {
  pubsubClient = null;
  topicRef = null;
  topicVerified = false;
}
