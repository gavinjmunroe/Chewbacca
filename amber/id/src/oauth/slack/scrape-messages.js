/**
 * Slack message scraper.
 *
 * Pulls the installing user's recent message history from every Slack
 * conversation they have access to, counts what it saw, and
 * upserts under a stable `slack:<channel_id>:<ts>` ID so re-syncs overwrite
 * rather than duplicate. Designed so Medha can semantically recall "what
 * did we discuss in #design last week?" once the agent's contact-search
 * tool ships.
 *
 * Reads SLACK_USER_TOKEN (xoxp-) from the per-tenant secrets bag — the
 * user token has the channels:history / groups:history / im:history /
 * mpim:history scopes already granted at OAuth time (see
 * src/oauth/slack/scopes.js). The bot token cannot read DMs or private
 * channels the bot was never added to, so user-token is the right choice
 * for "everything the user can see."
 *
 * Bounded:
 *   - 20 channels per sync (MRU first; subsequent syncs deepen the back-catalog
 *     because we sort channels by latest activity, not alphabet).
 *   - 200 messages per channel per sync.
 *   - 8s timeout per Slack API call, 200ms pacing between calls.
 *
 * Never throws. Every failure logs and moves on. The HTTP route that fires
 * this is fire-and-forget; the user does not wait on it.
 */

import { getSecret } from "../../db/secrets.js";

// These vectors predate the healthDimension write contract that
// pinecone-client.upsert() now enforces for every other writer (the contract
// the retired cNFT client owned). Opting out keeps them flowing instead of
// silently 400ing; classifying them into the six dimensions is follow-up work.
const DIMENSIONLESS = { requireDimension: false };

const CONVERSATIONS_LIST_URL = "https://slack.com/api/conversations.list";
const CONVERSATIONS_HISTORY_URL = "https://slack.com/api/conversations.history";
const USERS_INFO_URL = "https://slack.com/api/users.info";

const CHANNEL_LIST_LIMIT = 200; // per Slack page; we still cap channels scraped at MAX_CHANNELS below
const MESSAGES_PER_CHANNEL = 200;
const MAX_CHANNELS = 20;
const REQUEST_TIMEOUT_MS = 8000;
const PACING_MS = 200;

// Subtypes that are never user content — channel system events, bot
// noise, and metadata-only notifications. Bots are also detected via the
// presence of `bot_id` on the message (more reliable than subtype alone
// because newer apps post with subtype === undefined).
const SKIP_SUBTYPES = new Set([
  "bot_message",
  "channel_join",
  "channel_leave",
  "channel_topic",
  "channel_purpose",
  "channel_name",
  "channel_archive",
  "channel_unarchive",
  "group_join",
  "group_leave",
  "group_topic",
  "group_purpose",
  "group_name",
  "group_archive",
  "group_unarchive",
  "app_conversation_join",
  "app_conversation_leave",
  "pinned_item",
  "unpinned_item",
  "reminder_add",
  "tombstone",
]);

function describeFetchError(err) {
  if (!err) return { message: "unknown" };
  const cause = err.cause || {};
  return {
    message: err.message || String(err),
    causeMessage: cause.message,
    causeCode: cause.code,
    causeErrno: cause.errno,
    causeName: cause.name,
  };
}

/**
 * Wrap fetch with timeout + structured error reporting. Returns
 * { ok: true, data } on a successful Slack JSON response, or
 * { ok: false, error, status?, retryAfter? } on any failure.
 *
 * Slack returns HTTP 200 with `{ ok: false, error: "<code>" }` for
 * application-level failures (invalid_auth, rate-limit, etc), and HTTP
 * 429 with a Retry-After header for hard rate limits. Both surfaces are
 * handled here so the caller only sees a normalized result.
 */
async function callSlack(url, token, params, log) {
  const qs = new URLSearchParams(params).toString();
  const fullUrl = qs ? `${url}?${qs}` : url;
  let res;
  try {
    res = await fetch(fullUrl, {
      method: "GET",
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/json",
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    log?.warn?.(
      { url, ...describeFetchError(err) },
      "[slack:scrape] fetch failed",
    );
    return { ok: false, error: "fetch_failed" };
  }
  if (res.status === 429) {
    const retryAfter = parseInt(res.headers.get("retry-after") || "0", 10);
    log?.warn?.({ url, retryAfter }, "[slack:scrape] rate limited");
    return { ok: false, error: "rate_limited", retryAfter };
  }
  if (!res.ok) {
    return { ok: false, error: `status_${res.status}`, status: res.status };
  }
  let body;
  try {
    body = await res.json();
  } catch (err) {
    return { ok: false, error: "parse_failed" };
  }
  if (!body.ok) {
    log?.warn?.(
      { url, slackError: body.error },
      "[slack:scrape] slack returned ok=false",
    );
    return { ok: false, error: body.error || "slack_error" };
  }
  return { ok: true, data: body };
}

/**
 * Paginate conversations.list across all conversation types the user can
 * see. Returns the unique union (Slack returns DMs separately from public
 * channels when types is multi-valued, but the API still dedupes within a
 * page). Capped at CHANNEL_LIST_LIMIT * a few pages to avoid runaway
 * pagination on huge workspaces.
 */
async function listAllConversations(token, log) {
  const channels = [];
  let cursor = "";
  for (let page = 0; page < 5; page++) {
    const params = {
      types: "public_channel,private_channel,im,mpim",
      limit: String(CHANNEL_LIST_LIMIT),
      exclude_archived: "true",
    };
    if (cursor) params.cursor = cursor;
    const result = await callSlack(CONVERSATIONS_LIST_URL, token, params, log);
    if (!result.ok) {
      if (result.error === "rate_limited" && result.retryAfter) {
        await new Promise((r) => setTimeout(r, result.retryAfter * 1000));
        continue;
      }
      break;
    }
    const pageChannels = Array.isArray(result.data.channels)
      ? result.data.channels
      : [];
    channels.push(...pageChannels);
    cursor = result.data.response_metadata?.next_cursor || "";
    if (!cursor) break;
    await new Promise((r) => setTimeout(r, PACING_MS));
  }
  return channels;
}

/**
 * Build a human-readable label for the channel that goes into the
 * embedded text. Public/private channels carry a real name; DMs and
 * MPIMs do not, so we synthesize one from the participant context that
 * Slack already includes on the conversations.list row.
 */
function channelLabel(channel) {
  if (!channel) return "(unknown)";
  if (channel.name) return `#${channel.name}`;
  if (channel.is_im) return "DM";
  if (channel.is_mpim) return "Group DM";
  return channel.id;
}

/**
 * Channels are ranked for the bounded MAX_CHANNELS slice by latest
 * activity. Slack's conversations.list returns `latest.ts` on most
 * channels when the user is a member; falls back to channel.updated when
 * missing. Higher = more recent = scraped first.
 */
function channelSortKey(channel) {
  const ts = parseFloat(channel?.latest?.ts || "0") || 0;
  const updated = (channel?.updated || 0) / 1000;
  return Math.max(ts, updated);
}

/**
 * One channel's worth of message history. Paginated, capped by
 * MESSAGES_PER_CHANNEL. Returns an array of normalized message records
 * ready to be embedded + upserted.
 */
async function fetchChannelMessages(token, channelId, log) {
  const collected = [];
  let cursor = "";
  while (collected.length < MESSAGES_PER_CHANNEL) {
    const remaining = MESSAGES_PER_CHANNEL - collected.length;
    const limit = Math.min(remaining, 200);
    const params = {
      channel: channelId,
      limit: String(limit),
    };
    if (cursor) params.cursor = cursor;
    const result = await callSlack(
      CONVERSATIONS_HISTORY_URL,
      token,
      params,
      log,
    );
    if (!result.ok) {
      if (result.error === "rate_limited" && result.retryAfter) {
        await new Promise((r) => setTimeout(r, result.retryAfter * 1000));
        continue;
      }
      return collected;
    }
    const msgs = Array.isArray(result.data.messages)
      ? result.data.messages
      : [];
    if (msgs.length === 0) break;
    collected.push(...msgs);
    if (!result.data.has_more) break;
    cursor = result.data.response_metadata?.next_cursor || "";
    if (!cursor) break;
    await new Promise((r) => setTimeout(r, PACING_MS));
  }
  return collected;
}

/**
 * Look up a Slack user's display name once per scrape, caching the
 * result. Most messages in a channel reference a handful of repeat
 * authors; calling users.info per message would burn the rate limit
 * budget without adding value.
 */
async function resolveUserName(token, userId, cache, log) {
  if (!userId) return null;
  if (cache.has(userId)) return cache.get(userId);
  const result = await callSlack(USERS_INFO_URL, token, { user: userId }, log);
  let name = null;
  if (result.ok) {
    const u = result.data.user || {};
    const profile = u.profile || {};
    name =
      profile.display_name_normalized ||
      profile.display_name ||
      profile.real_name_normalized ||
      profile.real_name ||
      u.name ||
      null;
  }
  cache.set(userId, name);
  return name;
}

/**
 * Decide whether a Slack message is user content worth indexing.
 *
 * Skipped:
 *   - bot posts (bot_id set OR subtype === "bot_message")
 *   - channel/group system events (join, leave, topic change, pin, etc)
 *   - messages with no text at all (attachment-only / file-only previews)
 *   - thread "broadcast" stubs (subtype thread_broadcast posts a
 *     placeholder in the channel; the real reply lives in the thread and
 *     we'd double-index it)
 */
function shouldIndexMessage(msg) {
  if (!msg || typeof msg !== "object") return false;
  if (msg.bot_id) return false;
  if (typeof msg.subtype === "string" && SKIP_SUBTYPES.has(msg.subtype)) {
    return false;
  }
  const text = typeof msg.text === "string" ? msg.text.trim() : "";
  if (!text) return false;
  return true;
}

function isoFromSlackTs(ts) {
  const seconds = parseFloat(ts || "0");
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return new Date(seconds * 1000).toISOString();
}

/**
 * Render the embedding text for a Slack message. Includes channel + author
 * + timestamp so semantic search by "what did Sagar say in #design last
 * Tuesday" can hit all four signals at once.
 */
function textForMessage({ channelDisplay, authorName, authorId, isoTs, text }) {
  const author = authorName
    ? `@${authorName}`
    : authorId
      ? `<@${authorId}>`
      : "(unknown)";
  const when = isoTs || "(unknown time)";
  return `[Slack ${channelDisplay}] ${author} at ${when}: ${text}`;
}

/**
 * WAS: embed each message and upsert it into the user's external vector index.
 *
 * There is no external vector index any more. Observations carry their own
 * pgvector embedding in Cloud SQL and retrieval.js searches it in-database, so a
 * second copy of Slack text in a second store is exactly the sprawl this rebuild
 * removed. The scrape still walks channels and counts what it saw; it indexes
 * nothing. Wire Slack text into `observations` when that is a feature somebody
 * asked for, and it will be searchable by the same path as everything else.
 */
async function indexMessages() {
  return 0;
}

/**
 * Top-level orchestrator. Reads the user token, walks conversations, fans
 * out into per-channel history, indexes everything that's real user text.
 *
 *   { ok: true, channels_scraped, messages_seen, messages_indexed,
 *     channels_failed }
 *
 * `messages_seen` is the raw count Slack returned (including the bot /
 * system messages we filtered out); `messages_indexed` is what landed in
 * Pinecone. The gap is normal and useful to see in logs — a channel that
 * is 90% bot noise should show a wide gap.
 */
export async function scrapeAndIndexSlackMessages(did, log) {
  if (!did) return { ok: false, error: "missing_did" };

  let token;
  try {
    token = await getSecret(did, "SLACK_USER_TOKEN");
  } catch (err) {
    log?.warn?.(
      { did, err: err?.message },
      "[slack:scrape] secrets read failed",
    );
    return { ok: false, error: "secrets_read_failed" };
  }
  if (!token) {
    return { ok: false, error: "no_user_token" };
  }

  log?.info?.({ did }, "[slack:scrape] starting");

  // Pull every channel the user can see, then take MAX_CHANNELS by most
  // recent activity.
  const allChannels = await listAllConversations(token, log);
  const ranked = allChannels
    .filter((c) => c?.id)
    .sort((a, b) => channelSortKey(b) - channelSortKey(a))
    .slice(0, MAX_CHANNELS);

  log?.info?.(
    { did, total_channels: allChannels.length, scraping: ranked.length },
    "[slack:scrape] channels ranked",
  );

  const userCache = new Map();
  let messagesSeen = 0;
  let messagesIndexed = 0;
  let channelsFailed = 0;

  for (const channel of ranked) {
    const channelDisplay = channelLabel(channel);
    let msgs;
    try {
      msgs = await fetchChannelMessages(token, channel.id, log);
    } catch (err) {
      channelsFailed++;
      log?.warn?.(
        { did, channel: channel.id, err: err?.message },
        "[slack:scrape] channel history fetch threw",
      );
      continue;
    }
    if (!Array.isArray(msgs) || msgs.length === 0) {
      await new Promise((r) => setTimeout(r, PACING_MS));
      continue;
    }
    messagesSeen += msgs.length;

    const indexable = msgs.filter(shouldIndexMessage);
    const records = [];
    for (const m of indexable) {
      const authorName = await resolveUserName(token, m.user, userCache, log);
      const isoTs = isoFromSlackTs(m.ts);
      const text = textForMessage({
        channelDisplay,
        authorName,
        authorId: m.user,
        isoTs,
        text: m.text,
      });
      records.push({
        id: `slack:${channel.id}:${m.ts}`,
        text,
        createdAt: isoTs || new Date().toISOString(),
        channelId: channel.id,
        channelName: channel.name || null,
        channelKind: channel.is_im
          ? "im"
          : channel.is_mpim
            ? "mpim"
            : channel.is_private
              ? "private_channel"
              : "public_channel",
        slackUserId: m.user || null,
        slackUserName: authorName,
        slackTs: m.ts,
        slackThreadTs: m.thread_ts || null,
      });
    }

    const indexed = await indexMessages(did, records, log);
    messagesIndexed += indexed;
    await new Promise((r) => setTimeout(r, PACING_MS));
  }

  const summary = {
    ok: true,
    did,
    channels_scraped: ranked.length,
    channels_failed: channelsFailed,
    messages_seen: messagesSeen,
    messages_indexed: messagesIndexed,
  };
  log?.info?.(summary, "[slack:scrape] done");
  return summary;
}

export const __test__ = {
  shouldIndexMessage,
  textForMessage,
  channelLabel,
  isoFromSlackTs,
  SKIP_SUBTYPES,
};
