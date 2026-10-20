/**
 * @togari/transports/slack — Parser (thin wrapper)
 *
 * Thin preprocessor that turns raw Slack text into the universal
 * `ParsedIntent[]` shape by delegating to the core intent classifier.
 * The prior local Claude prompt has moved to `core/intent-router.ts`.
 */

import { classifyIntent } from '../../core/intent-router';
import type { ParsedIntent, TogariRequest } from '../../core/types';

export type { ParsedIntent } from '../../core/types';

/**
 * Parse a Slack (or any raw text) message into one or more structured
 * intents. Returns an array — each element is a single action the
 * engine/transport should execute.
 *
 * `timezone` is the requester's IANA TZ (from Slack profile). Threaded
 * into the parser so reminder_times are computed in the user's TZ, not
 * server-local UTC. Defaults to ET when unknown.
 */
export async function parseSlackMessage(text: string, timezone: string = 'America/New_York'): Promise<ParsedIntent[]> {
  const request: TogariRequest = {
    text,
    userId: 'slack_parser',
    platform: 'slack',
    transport: 'slack',
  };
  return classifyIntent(request, { timezone });
}
