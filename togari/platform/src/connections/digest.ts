/**
 * The daily warm-intro digest: every new route, grouped by target account,
 * strongest target first. Each target opens with its name in a large header,
 * then who to ask and their email. Under it, each buyer, and under each buyer
 * the routes to them, each starting with the person to ask (champion →
 * colleague → buyer) and carrying Good path / Not a fit.
 *
 * Paths reach connection_paths from Clay's results table (POST
 * /connections/paths). Once a weekday morning in the client's timezone, this
 * claims whatever is waiting and posts it. A day with nothing new posts
 * nothing.
 */

import crypto from "crypto";
import { createLogger } from "../observability/logger";
import {
  connectionClients,
  resolveChannel,
  type ReplybotClientConfig,
} from "../agents/replybot/client-config";
import { slackBotTokenFor } from "../transports/slack/installations";
import {
  claimPendingPaths,
  contactEmail,
  lastDigestDate,
  releaseDigest,
  savePathMessage,
  type ConnectionPath,
} from "./paths";

const logger = createLogger("connections/digest");

/** The hour (client's local time) the digest goes out, and how late it may. */
export function digestHour(): number {
  const n = Number(process.env.CONNECTION_DIGEST_HOUR);
  return Number.isInteger(n) && n >= 0 && n <= 20 ? n : 9;
}
/**
 * Three hours of window, so a deploy or a restart at 9:00 still gets the
 * morning's digest out — but a server down all morning waits for tomorrow
 * rather than posting at teatime.
 */
const WINDOW_HOURS = 3;

// ── Ordering ─────────────────────────────────────────────────────────

const OVERLAP_RANK: Record<string, number> = { yes: 0, possible: 1, unknown: 2, no: 3 };
const PERSONA_RANK: Record<string, number> = {
  managed_care_contracting: 0,
  executive: 1,
  revenue_cycle: 2,
};
const MATCH_RANK: Record<string, number> = { domain: 0, name: 1, parent_domain: 2 };

/**
 * Strongest first: an overlap at the target, then the most recent bridge,
 * then the buyer closest to payer contracting, then the surest match.
 */
export function rankPaths(paths: ConnectionPath[]): ConnectionPath[] {
  const rank = (table: Record<string, number>, v: string | null, missing: number) =>
    v != null && v in table ? table[v] : missing;
  return [...paths].sort(
    (a, b) =>
      rank(OVERLAP_RANK, a.tenure_overlap, 2) - rank(OVERLAP_RANK, b.tenure_overlap, 2) ||
      (b.end_year ?? 0) - (a.end_year ?? 0) ||
      rank(PERSONA_RANK, a.buyer_persona, 3) - rank(PERSONA_RANK, b.buyer_persona, 3) ||
      rank(MATCH_RANK, a.match, 3) - rank(MATCH_RANK, b.match, 3) ||
      a.path_id.localeCompare(b.path_id),
  );
}

// ── Rendering ────────────────────────────────────────────────────────

/** Slack mrkdwn treats &, < and > as markup. */
export function escapeMrkdwn(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name;

function link(url: string | null, label: string): string | null {
  if (!url || !/^https?:\/\//i.test(url)) return null;
  return `<${url.replace(/[<>|]/g, "")}|${escapeMrkdwn(label)}>`;
}

function years(start: number | null, end: number | null): string {
  if (start && end) return `${start}–${end}`;
  if (end) return `until ${end}`;
  if (start) return `from ${start}`;
  return "years not stated";
}

function overlapText(p: ConnectionPath): string {
  switch (p.tenure_overlap) {
    case "yes":
      return p.overlap_years ? `overlap ${p.overlap_years} yr${p.overlap_years === 1 ? "" : "s"}` : "overlap yes";
    case "possible":
      return "overlap possible (same year)";
    case "no":
      return "no overlap";
    default:
      return "overlap unknown";
  }
}

const MATCH_TEXT: Record<string, string> = {
  domain: "matched by domain",
  name: "matched by name",
  parent_domain: "matched by parent domain, check it",
};

/** "2:14 PM" in the client's timezone, for the verdict line. */
function localTime(iso: string | null, timezone: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  // ICU puts a narrow no-break space before AM/PM; Slack users type a space.
  return d
    .toLocaleTimeString("en-US", { timeZone: timezone, hour: "numeric", minute: "2-digit" })
    .replace(/\u202f/g, " ");
}

/**
 * One route to a buyer, starting with the person we would ask: champion →
 * colleague → buyer, or champion → buyer when the champion worked at the
 * target themself. It sits under the buyer's own line, so the buyer's links
 * are there, not here; the second line is the evidence for this route.
 */
export function routeText(p: ConnectionPath): string {
  const self = p.bridge_relation === "self";
  const bridge = self
    ? ""
    : ` → ${escapeMrkdwn(p.bridge_name)}${p.bridge_title ? ` (${escapeMrkdwn(p.bridge_title)})` : ""}`;
  const line1 = `${escapeMrkdwn(p.champion_name)}${bridge} → ${escapeMrkdwn(p.buyer_name)}`;

  const details = [
    `${escapeMrkdwn(firstName(p.bridge_name))} at ${escapeMrkdwn(p.target_account)} ${years(p.start_year, p.end_year)}`,
    overlapText(p),
    p.match ? MATCH_TEXT[p.match] ?? null : null,
    self ? null : link(p.bridge_linkedin, firstName(p.bridge_name)),
    // Often the old job's source is the bridge's own profile: link it once.
    !self && p.role_source_url === p.bridge_linkedin ? null : link(p.role_source_url, "role source"),
  ].filter(Boolean);

  return `${line1}\n${details.join(" · ")}`;
}

/** The buyer's own line: who they are, when they joined, where to look them up. */
export function buyerText(p: ConnectionPath): string {
  const title = p.buyer_title ? ` · ${escapeMrkdwn(p.buyer_title)}` : "";
  const sourceDiffers = p.buyer_source_url && p.buyer_source_url !== p.buyer_linkedin;
  const details = [
    p.buyer_joined_year ? `Joined ${escapeMrkdwn(p.target_account)} ${p.buyer_joined_year}` : null,
    link(p.buyer_linkedin, "LinkedIn"),
    sourceDiffers ? link(p.buyer_source_url, "source") : null,
  ].filter(Boolean);
  return `*${escapeMrkdwn(p.buyer_name)}*${title}${details.length ? `\n${details.join(" · ")}` : ""}`;
}

/**
 * The blocks for one route. The second block is the buttons until someone
 * decides, then a line saying who decided what — same block_id, so a redraw
 * swaps one for the other in place.
 */
export function pathBlocks(p: ConnectionPath, timezone: string): any[] {
  const blocks: any[] = [
    {
      type: "section",
      block_id: `connpath_text:${p.path_id}`,
      text: { type: "mrkdwn", text: routeText(p) },
    },
  ];
  if (p.verdict) {
    const label = p.verdict === "good" ? ":white_check_mark: Good path" : ":x: Not a fit";
    const who = p.verdict_by ? ` · <@${p.verdict_by}>` : "";
    const when = localTime(p.verdict_at, timezone);
    blocks.push({
      type: "context",
      block_id: `connpath:${p.path_id}`,
      elements: [{ type: "mrkdwn", text: `${label}${who}${when ? `, ${when}` : ""}` }],
    });
  } else {
    blocks.push({
      type: "actions",
      block_id: `connpath:${p.path_id}`,
      elements: [
        {
          type: "button",
          action_id: "connpath_good",
          text: { type: "plain_text", text: "Good path" },
          value: p.path_id,
        },
        {
          type: "button",
          action_id: "connpath_bad",
          text: { type: "plain_text", text: "Not a fit" },
          value: p.path_id,
        },
      ],
    });
  }
  return blocks;
}

/** Every route into one target account, the strongest target first. */
export interface TargetGroup {
  account: string;
  segment: string | null;
  paths: ConnectionPath[];
  /** A target too big for one message, carried on into the next. */
  continued?: boolean;
}

/**
 * Group routes by target account. Targets come in the order of their
 * strongest route; inside a target, each buyer's routes sit together, buyers
 * in the order of their strongest route, so "three ways to reach Carol Han"
 * reads as one run rather than three scattered lines.
 */
export function groupByTarget(paths: ConnectionPath[]): TargetGroup[] {
  const byAccount = new Map<string, ConnectionPath[]>();
  for (const p of rankPaths(paths)) {
    const list = byAccount.get(p.target_account) ?? [];
    list.push(p);
    byAccount.set(p.target_account, list);
  }
  return [...byAccount].map(([account, ranked]) => {
    const firstSeen = new Map<string, number>();
    ranked.forEach((p, i) => {
      const key = p.buyer_name.toLowerCase();
      if (!firstSeen.has(key)) firstSeen.set(key, i);
    });
    const paths = ranked
      .map((p, i) => ({ p, i }))
      .sort(
        (a, b) =>
          firstSeen.get(a.p.buyer_name.toLowerCase())! - firstSeen.get(b.p.buyer_name.toLowerCase())! ||
          a.i - b.i,
      )
      .map((x) => x.p);
    return { account, segment: ranked[0].target_segment, paths };
  });
}

/** Each buyer's routes, buyers in the order the group already has them. */
function byBuyer(paths: ConnectionPath[]): ConnectionPath[][] {
  const buyers = new Map<string, ConnectionPath[]>();
  for (const p of paths) {
    const key = p.buyer_name.toLowerCase();
    buyers.set(key, [...(buyers.get(key) ?? []), p]);
  }
  return [...buyers.values()];
}

/**
 * A target's heading. The account name is a Slack header block — the only way
 * to make text larger in a message — then a line with the segment and counts,
 * and one "Ask" line per customer contact whose routes lead here, with their
 * email.
 */
export function targetHeaderBlocks(group: TargetGroup, index: number): any[] {
  const routes = group.paths.length;
  const people = byBuyer(group.paths).length;
  const summary = [
    group.segment ? escapeMrkdwn(group.segment) : null,
    `${routes} route${routes === 1 ? "" : "s"} to ${people} ${people === 1 ? "person" : "people"}`,
    group.continued ? "continued" : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const champions = new Map<string, ConnectionPath>();
  for (const p of group.paths) {
    const key = p.champion_name.toLowerCase();
    if (!champions.has(key)) champions.set(key, p);
  }
  const askLines = [...champions.values()].map((p) => {
    const role = [p.champion_title, p.champion_company].filter(Boolean).map((v) => escapeMrkdwn(v!)).join(", ");
    const email = contactEmail(p);
    return (
      `Ask *${escapeMrkdwn(p.champion_name)}*${role ? ` (${role})` : ""} · ` +
      (email ? `<mailto:${email}|${escapeMrkdwn(email)}>` : "_no email on file_")
    );
  });

  return [
    {
      type: "header",
      block_id: `conntarget:${index}`,
      // Header blocks are plain text, at most 150 characters.
      text: { type: "plain_text", text: group.account.slice(0, 150), emoji: false },
    },
    {
      type: "section",
      block_id: `conntarget_ask:${index}`,
      text: { type: "mrkdwn", text: [summary, ...askLines].join("\n") },
    },
  ];
}

/**
 * The blocks for a message's targets: each target's heading, then each buyer
 * with the routes to them underneath.
 */
export function targetListBlocks(groups: TargetGroup[], timezone: string): any[] {
  return groups.flatMap((g, i) => [
    ...(i > 0 ? [{ type: "divider" }] : []),
    ...targetHeaderBlocks(g, i),
    ...byBuyer(g.paths).flatMap((routes, j) => [
      {
        type: "section",
        block_id: `connbuyer:${i}:${j}`,
        text: { type: "mrkdwn", text: buyerText(routes[0]) },
      },
      ...routes.flatMap((p) => pathBlocks(p, timezone)),
    ]),
  ]);
}

/** Slack's cap on blocks in one message. */
const MAX_BLOCKS = 50;
/** The top message's header and its divider; a thread part's one line. */
const TOP_RESERVED = 3;
const PART_RESERVED = 1;

/**
 * Blocks a run of routes into one target costs: divider, header, ask line,
 * one line per buyer, and two per route (the route and its buttons).
 */
function groupCost(paths: ConnectionPath[]): number {
  return 3 + byBuyer(paths).length + 2 * paths.length;
}

/**
 * Split the targets into messages under Slack's block cap. A target is kept
 * whole when it fits; only a target too big for any one message is split, its
 * later part marked "continued".
 */
export function packMessages(groups: TargetGroup[]): TargetGroup[][] {
  const messages: TargetGroup[][] = [[]];
  let used = TOP_RESERVED;

  for (const group of groups) {
    let remaining = group.paths;
    let continued = false;
    while (remaining.length > 0) {
      const current = messages[messages.length - 1];
      if (used + groupCost(remaining) <= MAX_BLOCKS) {
        current.push({ ...group, paths: remaining, continued });
        used += groupCost(remaining);
        break;
      }
      if (current.length > 0) {
        messages.push([]);
        used = PART_RESERVED;
        continue;
      }
      // Too big for a message of its own: take as many routes as fit.
      let take = 1;
      while (take < remaining.length && used + groupCost(remaining.slice(0, take + 1)) <= MAX_BLOCKS) take++;
      current.push({ ...group, paths: remaining.slice(0, take), continued });
      remaining = remaining.slice(take);
      continued = true;
      messages.push([]);
      used = PART_RESERVED;
    }
  }
  return messages.filter((m) => m.length > 0);
}

/**
 * The digest's header. block_ids start with "connhead" so a redraw after a
 * click can keep the header and rebuild only the targets.
 */
export function headerBlocks(params: {
  date: Date;
  timezone: string;
  total: number;
  champions: number;
  targets: number;
  part?: { from: number; to: number };
}): any[] {
  if (params.part) {
    return [
      {
        type: "context",
        block_id: "connhead_part",
        elements: [{ type: "mrkdwn", text: `Routes ${params.part.from}–${params.part.to} of ${params.total}` }],
      },
    ];
  }
  const day = params.date.toLocaleDateString("en-US", {
    timeZone: params.timezone,
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
  return [
    {
      type: "section",
      block_id: "connhead_title",
      text: { type: "mrkdwn", text: `*Warm-intro paths · ${day}*` },
    },
    {
      type: "context",
      block_id: "connhead_note",
      elements: [
        {
          type: "mrkdwn",
          text:
            `${plural(params.total, "new route")} into ${plural(params.targets, "target account")}, ` +
            `from ${plural(params.champions, "customer contact")}, strongest first. Each route starts ` +
            `with the person to ask. Overlap means the same organization at the same time, not ` +
            `that they know each other.`,
        },
      ],
    },
  ];
}

// ── Posting ──────────────────────────────────────────────────────────

/** One Slack Web API call. Throws on an HTTP or Slack-level failure. */
export async function slackApi(token: string, method: string, body: Record<string, unknown>): Promise<any> {
  const res = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Slack ${method} HTTP ${res.status}`);
  const data = (await res.json()) as any;
  if (!data.ok) throw new Error(`Slack ${method}: ${data.error}`);
  return data;
}

/**
 * Post everything waiting for one client. Returns how many routes were posted.
 *
 * Routes are claimed before posting; if the top message fails, they are
 * released for the next run. A thread part that fails releases only what was
 * not yet posted.
 */
export async function postDigest(client: ReplybotClientConfig, now: Date = new Date()): Promise<number> {
  const digestId = crypto.randomUUID();
  const claimed = await claimPendingPaths(client.clientId, digestId);
  if (claimed.length === 0) return 0;

  const timezone = client.voice.timezone;
  const channel = resolveChannel(client, "connections");
  const groups = groupByTarget(claimed);
  const messages = packMessages(groups);
  const total = claimed.length;
  const champions = new Set(claimed.map((p) => p.champion_name.toLowerCase())).size;
  const idsIn = (m: TargetGroup[]) => m.flatMap((g) => g.paths.map((p) => p.path_id));
  const countIn = (m: TargetGroup[]) => m.reduce((n, g) => n + g.paths.length, 0);

  let token: string;
  let threadTs: string;
  try {
    token = await slackBotTokenFor(client.slackTeamId);
    const top = await slackApi(token, "chat.postMessage", {
      channel,
      text: `Warm-intro paths: ${total} new`,
      blocks: [
        ...headerBlocks({ date: now, timezone, total, champions, targets: groups.length }),
        { type: "divider" },
        ...targetListBlocks(messages[0], timezone),
      ],
      unfurl_links: false,
      unfurl_media: false,
    });
    threadTs = String(top.ts);
    await savePathMessage({ pathIds: idsIn(messages[0]), channel, slackTs: threadTs, threadTs });
  } catch (err) {
    await releaseDigest(digestId);
    throw err;
  }

  let posted = countIn(messages[0]);
  for (let i = 1; i < messages.length; i++) {
    const from = posted + 1;
    const to = posted + countIn(messages[i]);
    try {
      const part = await slackApi(token, "chat.postMessage", {
        channel,
        thread_ts: threadTs,
        text: `Warm-intro paths ${from}–${to}`,
        blocks: [
          ...headerBlocks({
            date: now,
            timezone,
            total,
            champions,
            targets: groups.length,
            part: { from, to },
          }),
          ...targetListBlocks(messages[i], timezone),
        ],
        unfurl_links: false,
        unfurl_media: false,
      });
      await savePathMessage({ pathIds: idsIn(messages[i]), channel, slackTs: String(part.ts), threadTs });
      posted = to;
    } catch (err) {
      // The rest wait for tomorrow's digest rather than vanishing.
      await releaseDigest(digestId);
      logger.error(
        "connections.digest.part_failed",
        err instanceof Error ? err : new Error(String(err)),
        { clientId: client.clientId, part: i },
      );
      break;
    }
  }

  logger.info("connections.digest.posted", {
    clientId: client.clientId,
    channel,
    routes: posted,
    targets: groups.length,
    messages: messages.length,
  });
  return posted;
}

/** Local weekday, hour and date in a timezone. */
export function localParts(now: Date, timezone: string): { weekday: string; hour: number; date: string } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      weekday: "short",
      hour: "numeric",
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  return {
    weekday: parts.weekday,
    hour: Number(parts.hour),
    date: `${parts.year}-${parts.month}-${parts.day}`,
  };
}

/** Is it digest time for this client, and has today's not gone out yet? */
export async function isDigestDue(client: ReplybotClientConfig, now: Date): Promise<boolean> {
  const { weekday, hour, date } = localParts(now, client.voice.timezone);
  if (weekday === "Sat" || weekday === "Sun") return false;
  const start = digestHour();
  if (hour < start || hour >= start + WINDOW_HOURS) return false;
  return (await lastDigestDate(client.clientId, client.voice.timezone)) !== date;
}

/** What the timer calls. One client failing never stops the others. */
export async function runConnectionDigests(now: Date = new Date()): Promise<number> {
  let posted = 0;
  for (const client of connectionClients()) {
    try {
      if (await isDigestDue(client, now)) posted += await postDigest(client, now);
    } catch (err) {
      logger.error(
        "connections.digest.failed",
        err instanceof Error ? err : new Error(String(err)),
        { clientId: client.clientId },
      );
    }
  }
  return posted;
}
