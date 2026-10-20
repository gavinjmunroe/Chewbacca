/**
 * @togari/transports/slack — Thread context fetcher
 *
 * Fetches recent messages from a Slack thread that are relevant to
 * the Togari bot — messages that @-mention the bot, or are bot replies
 * — so the tool-use loop has prior-turn context.
 *
 * Returns up to `max` messages, oldest-first, in the same shape the
 * loop expects (`{ role: 'user'|'assistant', content: string }`).
 *
 * This is read-only — best-effort. If conversations.replies fails or
 * the token isn't set, returns an empty list and the caller falls
 * through to single-turn processing.
 */

import { createLogger } from '../../observability/logger';

const logger = createLogger('slack/thread-context');

export interface ThreadMessage {
  role: 'user' | 'assistant';
  content: string;
  user?: string;
  ts: string;
}

/**
 * Fetch the last `max` thread messages that mention the bot or are
 * from the bot itself, oldest-first. Returns an empty array on any
 * failure — never throws.
 */
export async function getThreadContext(
  channel: string,
  threadTs: string,
  botUserId: string,
  max: number = 5,
): Promise<ThreadMessage[]> {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token || !channel || !threadTs) return [];

  try {
    const url = new URL('https://slack.com/api/conversations.replies');
    url.searchParams.set('channel', channel);
    url.searchParams.set('ts', threadTs);
    url.searchParams.set('limit', String(Math.max(max * 4, 20)));

    const res = await fetch(url.toString(), {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      logger.warn('conversations.replies HTTP error', { status: res.status });
      return [];
    }
    const data = (await res.json()) as {
      ok?: boolean;
      messages?: Array<{
        text?: string;
        user?: string;
        bot_id?: string;
        ts?: string;
      }>;
      error?: string;
    };
    if (!data.ok) {
      logger.warn('conversations.replies API error', { error: data.error });
      return [];
    }

    const mentionToken = `<@${botUserId}>`;
    const relevant: ThreadMessage[] = [];
    for (const msg of data.messages ?? []) {
      const text = msg.text ?? '';
      if (!text) continue;
      const fromBot = msg.user === botUserId || !!msg.bot_id;
      const mentionsBot = text.includes(mentionToken);
      if (!fromBot && !mentionsBot) continue;
      relevant.push({
        role: fromBot ? 'assistant' : 'user',
        content: text.replace(new RegExp(`^\\s*${mentionToken}\\s*`), '').trim(),
        user: msg.user,
        ts: msg.ts ?? '',
      });
    }

    // Drop the current in-flight message (it's the LAST relevant) — the
    // runner adds it as the active user message. Return the remaining
    // oldest-first, capped to `max`.
    const prior = relevant.slice(0, -1);
    return prior.slice(-max);
  } catch (err) {
    logger.warn('getThreadContext failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}
