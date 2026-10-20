/**
 * Read a client's Clay campaigns from Togari's own server: per-campaign sends,
 * replies and bounces, the master inbox, and one thread at a time.
 *
 * Caleb, 2026-10-13, about the client dashboard first fed from his Mac: "The
 * dashboard shouldn't be dependent on us!!!!!!!!!!!!!" So Togari calls Clay's
 * frontend API (api.clay.com/v3, the calls the Clay app makes) with a signed-in
 * session kept encrypted in tenant_secrets, never in an env var.
 *
 * The session expires about a week after it is issued (the stored one said
 * 2026-10-21 on 2026-10-13). Clay re-issues it in Set-Cookie as it is used,
 * and every re-issue is saved back, so a dashboard that is opened keeps itself
 * signed in. The bounce guard uses the same session to pause campaigns that
 * cross Caleb's 3% limit.
 */
import { getTenantSecret, setTenantSecret } from "../../secrets/tenantSecrets";

const API = "https://api.clay.com/v3";
const KEY = "clay_session";
const EXPIRES_KEY = "clay_session_expires";
// One Clay call took 0.3 to 1s from the Mac on 2026-10-13; 15s means Clay is
// down, and the page says so rather than hanging (guessed, never measured).
const TIMEOUT_MS = 15_000;

export interface CampaignStat {
  id: string;
  name: string;
  status: string;
  leads: number;
  sent: number;
  replies: number;
  bounces: number;
}

export interface InboxReply {
  leadEmail: string;
  campaignName: string;
  emailCampaignId: number;
  emailLeadId: number;
  lastSent: string;
  lastReply: string;
  /** The sequencer's own reply category id, 0 when unset. */
  category: number;
}

export interface ThreadMessage {
  type: string;
  from: string;
  messageId: string;
  subject: string;
  body: string;
  time: string;
}

// Per client: each is signed in to its own Clay workspace, and one shared
// value would send Serif's calls out under Zeutara's sign-in.
const cached = new Map<string, string>();

async function session(tenant: string): Promise<string> {
  const hit = cached.get(tenant);
  if (hit) return hit;
  const s = await getTenantSecret(tenant, KEY);
  if (!s) throw new Error("No Clay session saved for this client");
  cached.set(tenant, s);
  return s;
}

/**
 * When the claysession cookie in a Set-Cookie list expires, from its Expires
 * or Max-Age attribute (Max-Age wins, as in browsers), or null.
 */
export function sessionExpiry(
  setCookies: string[],
  now = Date.now(),
): Date | null {
  for (const c of setCookies) {
    if (!/^(?:__Host-)?claysession=/.test(c.trim())) continue;
    const maxAge = /;\s*max-age=(-?\d+)/i.exec(c);
    if (maxAge) return new Date(now + Number(maxAge[1]) * 1000);
    const expires = /;\s*expires=([^;]+)/i.exec(c);
    const at = expires ? Date.parse(expires[1]) : NaN;
    if (isFinite(at)) return new Date(at);
  }
  return null;
}

// What the last Clay call said about the session, per tenant, for the expiry
// warning (src/integrations/clay/session-alert.ts).
const lastOk = new Map<string, number>();
const lastSignedOut = new Map<string, number>();
const knownExpiry = new Map<string, string>();

export interface SessionHealth {
  /** The last 401/403 came after the last good answer. */
  signedOut: boolean;
  /** From the last Set-Cookie Clay sent; null until Clay has sent one. */
  expiresAt: Date | null;
}

export async function sessionHealth(tenant: string): Promise<SessionHealth> {
  const expires =
    knownExpiry.get(tenant) ??
    (await getTenantSecret(tenant, EXPIRES_KEY).catch(() => null));
  const at = expires ? Date.parse(expires) : NaN;
  return {
    signedOut: (lastSignedOut.get(tenant) ?? 0) > (lastOk.get(tenant) ?? 0),
    expiresAt: isFinite(at) ? new Date(at) : null,
  };
}

/** The claysession value in a Set-Cookie list, or null. */
export function renewedSession(setCookies: string[]): string | null {
  for (const c of setCookies) {
    const m = /^(?:__Host-)?claysession=([^;]+)/.exec(c.trim());
    if (m && m[1] && m[1] !== "deleted") return m[1];
  }
  return null;
}

async function call(
  tenant: string,
  method: "GET" | "POST" | "PATCH",
  path: string,
  body?: unknown,
): Promise<unknown> {
  const s = await session(tenant);
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      accept: "application/json, text/plain, */*",
      "content-type": "application/json",
      origin: "https://app.clay.com",
      referer: "https://app.clay.com/",
      cookie: `claysession=${s}; __Host-claysession=${s}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const setCookies = res.headers.getSetCookie?.() ?? [];
  const next = renewedSession(setCookies);
  if (next && next !== s) {
    cached.set(tenant, next);
    await setTenantSecret(tenant, KEY, next).catch(() => undefined);
  }
  const expires = sessionExpiry(setCookies)?.toISOString();
  if (expires && expires !== knownExpiry.get(tenant)) {
    knownExpiry.set(tenant, expires);
    await setTenantSecret(tenant, EXPIRES_KEY, expires).catch(() => undefined);
  }
  if (res.status === 401 || res.status === 403) {
    cached.delete(tenant);
    lastSignedOut.set(tenant, Date.now());
    throw new Error("The saved Clay session is signed out");
  }
  lastOk.set(tenant, Date.now());
  if (!res.ok) throw new Error(`Clay answered ${res.status} for ${path}`);
  if (res.status === 204) return null;
  // 2026-10-17: res.json() threw "Body is unusable: Body has already been
  // read" on 1 in 3 thread reads from zrec-ops (thread at campaign-read.ts:252),
  // which stopped a send before it started. Reading the text once and parsing
  // it ourselves has not thrown since; cause in undici never isolated.
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

const num = (x: unknown) =>
  typeof x === "number" && isFinite(x) ? x : Number(x) || 0;

export async function campaignStats(
  tenant: string,
  workspaceId: string,
): Promise<CampaignStat[]> {
  const [all, sums] = (await Promise.all([
    call(tenant, "GET", `/workspaces/${workspaceId}/all-campaigns`),
    call(
      tenant,
      "GET",
      `/workspaces/${workspaceId}/campaigns/analytics-summaries`,
    ),
  ])) as [
    { campaigns?: Array<Record<string, unknown>> },
    { items?: Array<Record<string, unknown>> },
  ];
  const byId = new Map(
    (sums.items || []).map((i) => [String(i.campaignId), i]),
  );
  return (all.campaigns || []).map((c) => {
    const s = byId.get(String(c.id)) || {};
    return {
      id: String(c.id),
      name: String(c.name || ""),
      status: String(c.status || ""),
      leads: num(s.leads),
      sent: num(s.sent),
      replies: num(s.replies),
      bounces: num(s.bounces),
    };
  });
}

/** Stop a live Clay campaign from sending new steps. */
export async function pauseCampaign(
  tenant: string,
  workspaceId: string,
  campaignId: string,
): Promise<void> {
  if (!/^cam_[A-Za-z0-9]+$/.test(campaignId))
    throw new Error("Invalid Clay campaign id");
  await call(
    tenant,
    "PATCH",
    `/workspaces/${workspaceId}/campaigns/${campaignId}`,
    { status: "paused" },
  );
}

/** Every inbox reply, newest first, up to `max`. */
export async function inboxReplies(
  tenant: string,
  workspaceId: string,
  max = 400,
): Promise<InboxReply[]> {
  const out: InboxReply[] = [];
  for (let offset = 0; offset < max; offset += 20) {
    const page = (await call(
      tenant,
      "POST",
      `/workspaces/${workspaceId}/clay-sequencer/master-inbox/replies`,
      {
        offset,
        limit: 20,
      },
    )) as { paginated_replies?: Array<Record<string, unknown>> };
    const rows = page.paginated_replies || [];
    for (const r of rows) {
      out.push({
        leadEmail: String(r.lead_email || ""),
        campaignName: String(r.email_campaign_name || ""),
        emailCampaignId: num(r.email_campaign_id),
        emailLeadId: num(r.email_lead_id),
        lastSent: String(r.last_sent_time || ""),
        lastReply: String(r.last_reply_time || ""),
        category: num(r.lead_category_id),
      });
    }
    if (rows.length < 20) break;
  }
  return out;
}

export async function thread(
  tenant: string,
  workspaceId: string,
  campaignId: number,
  leadId: number,
): Promise<ThreadMessage[]> {
  const t = (await call(
    tenant,
    "POST",
    `/workspaces/${workspaceId}/clay-sequencer/master-inbox/message-history`,
    {
      campaign_id: campaignId,
      lead_id: leadId,
    },
  )) as { history?: Array<Record<string, unknown>> };
  return (t.history || []).map((m) => ({
    type: String(m.type || ""),
    from: String(m.from || ""),
    messageId: String(m.message_id || ""),
    subject: String(m.subject || ""),
    body: String(m.email_body || ""),
    time: String(m.time || ""),
  }));
}

export interface SequencerCampaign {
  id: number;
  name: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Campaigns on Clay's Sequencer (Serif's kind, 2026-10-16). all-campaigns
 * lists only Clay's newer Campaigns and comes back empty for these.
 */
export async function sequencerCampaigns(
  tenant: string,
  workspaceId: string,
): Promise<SequencerCampaign[]> {
  const r = (await call(
    tenant,
    "GET",
    `/workspaces/${workspaceId}/clay-sequencer/campaigns`,
  )) as { campaigns?: Array<Record<string, unknown>> };
  return (r.campaigns || []).map((c) => ({
    id: num(c.id),
    name: String(c.name || ""),
    status: String(c.status || ""),
    createdAt: String(c.created_at || ""),
    updatedAt: String(c.updated_at || ""),
  }));
}

export interface DayStats {
  /** YYYY-MM-DD in the timezone asked for. */
  day: string;
  sent: number;
  bounced: number;
  leads: number;
}

const MONTHS = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split(" ");

/**
 * One Sequencer campaign's sends and bounces per day, from..to inclusive.
 * Clay labels each day "12 Oct" with no year, so days are taken in order and
 * each label is checked against the date it should be.
 */
export async function dayWiseStats(
  tenant: string,
  workspaceId: string,
  campaignId: number,
  from: string,
  to: string,
  timezone: string,
): Promise<DayStats[]> {
  const r = (await call(
    tenant,
    "POST",
    `/workspaces/${workspaceId}/clay-sequencer/analytics/day-wise`,
    {
      request: {
        start_date: from,
        end_date: to,
        timezone,
        campaign_ids: String(campaignId),
      },
    },
  )) as {
    dayWiseStats?: Array<{
      date?: string;
      emailEngagementMetrics?: Record<string, unknown>;
    }>;
  };
  const out: DayStats[] = [];
  let t = Date.parse(`${from}T00:00:00Z`);
  for (const d of r.dayWiseStats || []) {
    const day = new Date(t).toISOString().slice(0, 10);
    t += 86_400_000;
    const label = `${Number(day.slice(8))} ${MONTHS[Number(day.slice(5, 7)) - 1]}`;
    if (d.date !== label)
      throw new Error(`Clay day-wise gave "${d.date}" where ${day} was due`);
    const m = d.emailEngagementMetrics || {};
    out.push({
      day,
      sent: num(m.sent),
      bounced: num(m.bounced),
      leads: num(m.uniqueLeadReached),
    });
  }
  return out;
}

/** Continue an existing thread through the inbox operation used by Clay's UI. */
/** Raised before Clay's reply endpoint is called: nothing was sent. */
export class ContinuationRefused extends Error {
  /** Something newer is in the thread: stop, never try another route. */
  advanced = false;
}

export async function replyInThread(
  tenant: string,
  workspaceId: string,
  campaignId: number,
  leadId: number,
  parentId: string,
  recipient: string,
  body: string,
): Promise<void> {
  let parent: Record<string, unknown>;
  try {
    parent = await continuationParent(
      tenant,
      workspaceId,
      campaignId,
      leadId,
      parentId,
      recipient,
      body,
    );
  } catch (error) {
    if (error instanceof ContinuationRefused) throw error;
    throw new ContinuationRefused(
      error instanceof Error ? error.message : String(error),
    );
  }
  // Clay's cached ReplyForm targets the selected message, including
  // its last-message Reply button. The limited workflow action omits this key.
  // The native operation is chosen before sending, with no transport fallback.
  await call(
    tenant,
    "POST",
    `/workspaces/${workspaceId}/clay-sequencer/master-inbox/reply`,
    {
      campaign_id: campaignId,
      reply_data: {
        email_stats_id: parent.stats_id,
        email_body: body,
        reply_message_id: parentId,
        reply_email_time: parent.time,
        reply_email_body: parent.email_body,
        add_signature: false,
      },
    },
  );
}

/**
 * The provider message a native reply answers: our own SENT to the recipient
 * (a follow-up), or the recipient's own REPLY (an answer). On 2026-10-16 the
 * webhook workflow refused every second answer to a lead with "Already
 * replied to this lead" (Ethan Austin, run wfr_13eb06f9), so answering an
 * inbound needs this path too. Either way it must be the latest message.
 */
async function continuationParent(
  tenant: string,
  workspaceId: string,
  campaignId: number,
  leadId: number,
  parentId: string,
  recipient: string,
  body: string,
): Promise<Record<string, unknown>> {
  if (tenant !== "zeutara" || workspaceId !== "1372623")
    throw new Error("Native continuation is scoped to Zeutara's workspace");
  if (
    !Number.isSafeInteger(campaignId) ||
    campaignId <= 0 ||
    !Number.isSafeInteger(leadId) ||
    leadId <= 0 ||
    !parentId ||
    !body.trim()
  )
    throw new Error(
      "Native continuation requires complete thread identity and body",
    );
  const data = (await call(
    tenant,
    "POST",
    `/workspaces/${workspaceId}/clay-sequencer/master-inbox/message-history`,
    { campaign_id: campaignId, lead_id: leadId },
  )) as {
    history?: Array<Record<string, unknown>>;
    cursor?: unknown;
    has_more?: unknown;
  };
  if (!Array.isArray(data.history) || data.cursor || data.has_more)
    throw new Error("Complete provider history is required for continuation");
  const parents = data.history.filter((m) => m.message_id === parentId);
  const parent = parents[0];
  const lead = recipient.trim().toLowerCase();
  const matchesLead =
    parent?.type === "SENT"
      ? typeof parent.to === "string" && parent.to.trim().toLowerCase() === lead
      : parent?.type === "REPLY" &&
        typeof parent.from === "string" &&
        parent.from.trim().toLowerCase() === lead;
  if (
    parents.length !== 1 ||
    !parent ||
    !matchesLead ||
    typeof parent.stats_id !== "string" ||
    !parent.stats_id ||
    typeof parent.time !== "string" ||
    !Number.isFinite(Date.parse(parent.time)) ||
    typeof parent.email_body !== "string"
  )
    throw new Error(
      "Continuation parent and recipient must match the provider record",
    );
  const parentTime = Date.parse(parent.time);
  if (
    data.history.some(
      (m) =>
        m.message_id !== parentId &&
        ["SENT", "REPLY", "FORWARD"].includes(String(m.type)) &&
        (typeof m.time !== "string" ||
          !Number.isFinite(Date.parse(m.time)) ||
          Date.parse(m.time) >= parentTime),
    )
  ) {
    const advanced = new ContinuationRefused(
      "Conversation advanced; reconcile before continuing",
    );
    advanced.advanced = true;
    throw advanced;
  }
  return parent;
}

/** Seed or replace the saved session (run once from a signed-in machine). */
export async function saveSession(
  tenant: string,
  value: string,
): Promise<void> {
  await setTenantSecret(tenant, KEY, value);
  cached.set(tenant, value);
  // A pasted cookie carries no expiry; the next Set-Cookie from Clay fills it.
  knownExpiry.delete(tenant);
  await setTenantSecret(tenant, EXPIRES_KEY, "").catch(() => undefined);
}
