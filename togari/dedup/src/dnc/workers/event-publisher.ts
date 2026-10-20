/**
 * Social connection event publisher.
 *
 * Fires a `social_connection_added` event to the togari-events Pub/Sub topic
 * the instant a new connection row is inserted into BigQuery.
 *
 * Downstream subscribers (webhooks, Slack bots, CRM enrichment jobs) react
 * to this event in real time — this is the closest thing to a true webhook
 * for platforms that don't offer them natively.
 */

import { PubSub } from '@google-cloud/pubsub';
import { randomUUID } from 'crypto';
import type { SocialConnectionRow, Platform } from '../types/index.js';

const TOPIC    = process.env.PUBSUB_TOPIC_SOCIAL ?? 'togari-social-connections';
const PROJECT  = process.env.GCP_PROJECT_ID ?? 'midyear-glazing-485303-u3';

let _pubsub: PubSub | null = null;

function getPubSub(): PubSub {
  if (_pubsub) return _pubsub;
  const opts: ConstructorParameters<typeof PubSub>[0] = { projectId: PROJECT };
  const b64 = process.env.GCP_CREDENTIALS_BASE64;
  if (b64) opts.credentials = JSON.parse(Buffer.from(b64, 'base64').toString());
  _pubsub = new PubSub(opts);
  return _pubsub;
}

export interface SocialConnectionEvent {
  event_id: string;
  event_type: 'social_connection_added';
  platform: Platform;
  connection_id: string;
  platform_user_id: string;
  username: string;
  full_name: string;
  profile_url: string;
  current_title: string | null;
  current_company: string | null;
  connection_type: string;
  connected_at: string;
  owner_username: string;
  timestamp: string;
}

/**
 * Publish a `social_connection_added` event for each new connection row.
 * Fire-and-forget — never blocks the insert path.
 */
export async function publishNewConnections(rows: SocialConnectionRow[]): Promise<void> {
  if (rows.length === 0) return;

  const pubsub = getPubSub();
  const topic  = pubsub.topic(TOPIC);

  // Ensure topic exists
  try {
    const [exists] = await topic.exists();
    if (!exists) await pubsub.createTopic(TOPIC);
  } catch { /* best-effort */ }

  const publishes = rows.map(row => {
    const event: SocialConnectionEvent = {
      event_id:         randomUUID(),
      event_type:       'social_connection_added',
      platform:         row.platform,
      connection_id:    row.connection_id,
      platform_user_id: row.platform_user_id,
      username:         row.username,
      full_name:        row.full_name,
      profile_url:      row.profile_url,
      current_title:    row.current_title,
      current_company:  row.current_company,
      connection_type:  row.connection_type,
      connected_at:     row.connected_at,
      owner_username:   row.owner_username,
      timestamp:        new Date().toISOString(),
    };

    return topic.publishMessage({
      data: Buffer.from(JSON.stringify(event)),
      attributes: {
        event_type: 'social_connection_added',
        platform:   row.platform,
        event_id:   event.event_id,
      },
    }).catch(err => {
      process.stderr.write(`[DNC Events] Failed to publish ${row.platform}:${row.username} — ${err.message}\n`);
    });
  });

  await Promise.allSettled(publishes);
  process.stderr.write(`[DNC Events] Published ${rows.length} social_connection_added events\n`);
}
