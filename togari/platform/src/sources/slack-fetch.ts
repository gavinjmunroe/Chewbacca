/**
 * Read-only Slack fetch for on-command ingestion into Togari's source of truth.
 *
 * Uses the existing bot token (SLACK_BOT_TOKEN, the same app that powers the
 * inbound Slack transport) to read recent messages from a channel. The bot must
 * be a member of the channel it reads — otherwise Slack returns not_in_channel
 * and we surface that plainly.
 *
 * No writes, no auto-poll: this is a manual pull. When SLACK_BOT_TOKEN is
 * missing the function returns a clean not-configured result rather than
 * throwing, matching gmail-fetch / fireflies-fetch.
 *
 *   SLACK_BOT_TOKEN   xoxb- bot token with channels:history + channels:read
 */

import { WebClient } from "@slack/web-api";
import { createLogger } from "../observability/logger";

const logger = createLogger("sources/slack-fetch");

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export interface SlackMessage {
  ts: string;
  user: string;
  text: string;
  date: string; // ISO
}

export interface FetchSlackMessagesResult {
  configured: boolean;
  note?: string;
  channel?: string;
  messages: SlackMessage[];
}

/** Resolve a channel name ("#leads" / "leads") to its id, or pass an id through. */
async function resolveChannelId(
  client: WebClient,
  channel: string,
): Promise<string | null> {
  const raw = channel.trim().replace(/^#/, "");
  // Already an id (Cxxxx / Gxxxx / Dxxxx).
  if (/^[CGD][A-Z0-9]{6,}$/.test(raw)) return raw;
  let cursor: string | undefined;
  do {
    const res = await client.conversations.list({
      types: "public_channel,private_channel",
      limit: 1000,
      cursor,
    });
    const match = (res.channels ?? []).find(
      (c) => (c.name ?? "").toLowerCase() === raw.toLowerCase(),
    );
    if (match?.id) return match.id;
    cursor = res.response_metadata?.next_cursor || undefined;
  } while (cursor);
  return null;
}

/**
 * Fetch up to `limit` recent messages from a Slack channel within the last
 * `sinceDays` days. Best-effort user-name enrichment.
 */
export async function fetchSlackMessages(params: {
  channel: string;
  sinceDays?: number;
  limit?: number;
}): Promise<FetchSlackMessagesResult> {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) {
    return {
      configured: false,
      note: "Slack not configured: set SLACK_BOT_TOKEN",
      messages: [],
    };
  }
  if (!params.channel || !params.channel.trim()) {
    return {
      configured: true,
      note: "Provide a Slack channel name or id to read.",
      messages: [],
    };
  }

  const limit = Math.max(1, Math.min(MAX_LIMIT, params.limit ?? DEFAULT_LIMIT));
  const sinceDays = params.sinceDays ?? 7;
  const oldestSec = Math.floor(
    (Date.now() - sinceDays * 24 * 60 * 60 * 1000) / 1000,
  );

  const client = new WebClient(token);
  try {
    const channelId = await resolveChannelId(client, params.channel);
    if (!channelId) {
      return {
        configured: true,
        note: `Channel "${params.channel}" not found or the bot cannot see it.`,
        messages: [],
      };
    }

    const history = await client.conversations.history({
      channel: channelId,
      oldest: String(oldestSec),
      limit,
    });

    const userCache = new Map<string, string>();
    const resolveUser = async (id?: string): Promise<string> => {
      if (!id) return "unknown";
      if (userCache.has(id)) return userCache.get(id) as string;
      try {
        const info = await client.users.info({ user: id });
        const name = info.user?.real_name || info.user?.name || id;
        userCache.set(id, name);
        return name;
      } catch {
        userCache.set(id, id);
        return id;
      }
    };

    const messages: SlackMessage[] = [];
    for (const m of history.messages ?? []) {
      if (!m.text || m.subtype) continue; // skip joins/bot noise
      const ts = m.ts ?? "";
      messages.push({
        ts,
        user: await resolveUser(m.user),
        text: m.text,
        date: ts ? new Date(Number(ts) * 1000).toISOString() : "",
      });
    }

    return { configured: true, channel: params.channel, messages };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn("slack fetch failed", { error: message });
    return {
      configured: true,
      note: `Slack fetch failed: ${message}`,
      messages: [],
    };
  }
}
