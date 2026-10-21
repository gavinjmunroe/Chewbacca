// Server-only Slack Web API client. Reads a channel's full history plus thread
// replies, resolves user display names, and normalizes file attachments.
//
// Patterns adapted from sebseager/slack-exporter: cursor pagination,
// 429 rate-limit retry, and a single users.list fetch (not per-user lookups).

const SLACK_API = "https://slack.com/api";
const ADDITIONAL_SLEEP_MS = 2000;

// Safety cap so a runaway channel can't make a page hang forever. Bumped high
// enough to cover a very active channel's recent history.
const MAX_MESSAGES = 2000;

export type SlackFile = {
  id: string;
  name: string;
  title: string;
  mimetype: string;
  filetype: string;
  size: number;
  isImage: boolean;
  // Proxied URL served by our own API so the browser never needs the token.
  url: string;
  // Original Slack permalink (opens in Slack).
  permalink: string;
};

export type SlackMessage = {
  ts: string;
  tsLabel: string;
  userId: string;
  userName: string;
  userAvatar: string | null;
  text: string;
  rawText: string;
  files: SlackFile[];
  replyCount: number;
  replies: SlackMessage[];
};

type SlackUser = {
  name: string;
  realName: string;
  avatar: string | null;
};

function token(): string {
  const t = process.env.SLACK_BOT_TOKEN;
  if (!t) throw new Error("SLACK_BOT_TOKEN is not set");
  return t;
}

function channelId(): string {
  const c = process.env.SLACK_CHANNEL_ID;
  if (!c) throw new Error("SLACK_CHANNEL_ID is not set");
  return c;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Rate-limit-aware GET against the Slack Web API.
async function slackGet(
  method: string,
  params: Record<string, string>,
): Promise<any> {
  const url = `${SLACK_API}/${method}?${new URLSearchParams(params)}`;
  let attempt = 0;
  while (true) {
    attempt += 1;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token()}` },
      cache: "no-store",
    });
    if (res.status === 429) {
      const retryAfter = Number(res.headers.get("Retry-After") || "1");
      await sleep(retryAfter * 1000 + ADDITIONAL_SLEEP_MS);
      if (attempt > 8)
        throw new Error(`Slack ${method} rate-limited too many times`);
      continue;
    }
    const json = await res.json();
    if (!json.ok) throw new Error(`Slack ${method} failed: ${json.error}`);
    return json;
  }
}

// Generic cursor-paginated GET that concatenates one array key across pages.
async function paginatedGet(
  method: string,
  params: Record<string, string>,
  combineKey: string,
  max = MAX_MESSAGES,
): Promise<any[]> {
  const out: any[] = [];
  let cursor: string | undefined;
  while (true) {
    const page = await slackGet(method, {
      ...params,
      ...(cursor ? { cursor } : {}),
    });
    const chunk = page[combineKey] || [];
    out.push(...chunk);
    cursor = page.response_metadata?.next_cursor || undefined;
    if (!cursor || cursor.trim() === "" || out.length >= max) break;
  }
  return out;
}

// Fetch the whole workspace user directory once and index by id.
async function getUserDirectory(): Promise<Map<string, SlackUser>> {
  const map = new Map<string, SlackUser>();
  const members = await paginatedGet(
    "users.list",
    { limit: "200" },
    "members",
    50000,
  );
  for (const u of members) {
    const name =
      u?.profile?.display_name?.trim() ||
      u?.profile?.real_name?.trim() ||
      u?.real_name ||
      u?.name ||
      u.id;
    map.set(u.id, {
      name,
      realName: u?.profile?.real_name || name,
      avatar: u?.profile?.image_72 || u?.profile?.image_48 || null,
    });
  }
  return map;
}

function formatTs(ts: string): string {
  const seconds = Math.round(parseFloat(ts));
  const d = new Date(seconds * 1000);
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function normalizeFiles(rawFiles: any[]): SlackFile[] {
  if (!Array.isArray(rawFiles)) return [];
  return rawFiles
    .filter((f) => f && f.id)
    .map((f) => {
      const isImage =
        typeof f.mimetype === "string" && f.mimetype.startsWith("image/");
      return {
        id: f.id,
        name: f.name || f.title || f.id,
        title: f.title || f.name || "",
        mimetype: f.mimetype || "application/octet-stream",
        filetype: f.filetype || "",
        size: f.size || 0,
        isImage,
        url: `/api/slack/file/${f.id}`,
        permalink: f.permalink || "",
      };
    });
}

// Turn raw Slack markup into readable text: resolve <@U123> mentions,
// channel refs, and <url|label> links into plain readable strings.
function cleanText(raw: string, users: Map<string, SlackUser>): string {
  if (!raw) return "";
  return raw
    .replace(/<@([A-Z0-9]+)>/g, (_m, id) => {
      const u = users.get(id);
      return u ? `@${u.name}` : "@user";
    })
    .replace(/<#[A-Z0-9]+\|([^>]+)>/g, (_m, name) => `#${name}`)
    .replace(/<(https?:\/\/[^|>]+)\|([^>]+)>/g, (_m, _url, label) => label)
    .replace(/<(https?:\/\/[^>]+)>/g, (_m, url) => url)
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function buildMessage(
  m: any,
  users: Map<string, SlackUser>,
  replies: SlackMessage[],
): SlackMessage {
  const user = users.get(m.user) || {
    name: m.username || m.user || "unknown",
    realName: "",
    avatar: null,
  };
  return {
    ts: m.ts,
    tsLabel: formatTs(m.ts),
    userId: m.user || "",
    userName: user.name,
    userAvatar: user.avatar,
    text: cleanText(m.text || "", users),
    rawText: m.text || "",
    files: normalizeFiles(m.files),
    replyCount: m.reply_count || 0,
    replies,
  };
}

export async function getChannelFeed(): Promise<SlackMessage[]> {
  const [users, rawTop] = await Promise.all([
    getUserDirectory(),
    paginatedGet(
      "conversations.history",
      { channel: channelId(), limit: "200" },
      "messages",
    ),
  ]);

  // Keep normal messages and file shares; drop join/leave/rename/system noise.
  // Filter FIRST so reply fetches stay index-aligned with the rendered feed.
  const topLevel = rawTop.filter(
    (m) =>
      m.type === "message" &&
      (!m.subtype ||
        m.subtype === "file_share" ||
        m.subtype === "thread_broadcast"),
  );

  // Fetch replies for every threaded parent (a parent has thread_ts === ts).
  // Bounded concurrency via Promise.all is fine; slackGet retries on 429.
  const withReplies = await Promise.all(
    topLevel.map(async (m) => {
      if (m.reply_count > 0 && m.thread_ts === m.ts) {
        const replies = await paginatedGet(
          "conversations.replies",
          { channel: channelId(), ts: m.ts, limit: "200" },
          "messages",
        );
        // First entry is the parent itself; drop it.
        return replies.slice(1).map((r: any) => buildMessage(r, users, []));
      }
      return [] as SlackMessage[];
    }),
  );

  const feed = topLevel.map((m, i) => buildMessage(m, users, withReplies[i]));

  // Slack returns newest-first; render oldest-first like the real channel.
  return feed.reverse();
}

// Streams a single file's bytes through our server using the bot token, so the
// browser can display/download Slack files without ever seeing the token.
export async function fetchSlackFile(fileId: string): Promise<{
  body: ArrayBuffer;
  contentType: string;
  filename: string;
} | null> {
  const info = await slackGet("files.info", { file: fileId });
  const f = info.file;
  const src = f?.url_private_download || f?.url_private;
  if (!src) return null;
  const res = await fetch(src, {
    headers: { Authorization: `Bearer ${token()}` },
    cache: "no-store",
  });
  if (!res.ok) return null;
  return {
    body: await res.arrayBuffer(),
    contentType: f.mimetype || "application/octet-stream",
    filename: f.name || fileId,
  };
}
