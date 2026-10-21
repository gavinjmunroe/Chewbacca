/**
 * THE ONLY PLACE THIS SITE TALKS TO AMBER.
 *
 * Everything the web session can do is here, and it is a short list on purpose:
 * sign in, read your network, read a card, search your own contacts. The token
 * the API mints for `client: "web"` carries `network:read` and `contacts:read`
 * and the server rejects it everywhere else, so this file cannot grow past what
 * the credential is actually allowed to do without the server saying no first.
 *
 * WHERE THE TOKEN LIVES. sessionStorage, not localStorage: it dies with the tab,
 * which is the right lifetime for a credential nobody can revoke from another
 * device. It is read through a try/catch because Safari in private mode throws
 * on access rather than returning null, and a thrown storage read should log
 * somebody out, not white-screen them.
 */

/**
 * WHERE THE API LIVES.
 *
 * A build-time value if one was baked in, otherwise asked for at runtime. The
 * runtime path is the one that matters: NEXT_PUBLIC_* is inlined during
 * `npm run build`, so on a platform that builds a container and then injects
 * variables into it, the baked value is the empty string and every call below
 * would go to this site's own origin instead -- returning this site's own HTML
 * 404, which parses to nothing and reads as a generic failure while the API
 * logs stay empty. That is the bug this indirection exists to remove.
 *
 * Resolved once per page load and held in module scope, so the extra request
 * happens at most once and only on pages that actually talk to Amber.
 */
const BUILD_TIME_API = process.env.NEXT_PUBLIC_AMBER_API?.trim() ?? "";

let apiBasePromise: Promise<string> | null = null;

async function apiBase(): Promise<string> {
  if (BUILD_TIME_API) return BUILD_TIME_API;
  if (!apiBasePromise) {
    apiBasePromise = fetch("/api/config", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { apiBase: "" }))
      .then((c: { apiBase?: string }) => String(c?.apiBase ?? ""))
      // A failed lookup must not be cached as "" forever -- the next attempt
      // should be allowed to try again rather than inheriting one bad moment.
      .catch(() => {
        apiBasePromise = null;
        return "";
      });
  }
  const base = await apiBasePromise;
  if (!base) {
    // Let the next call retry rather than sticking on an unconfigured answer.
    apiBasePromise = null;
    throw new AmberError(
      0,
      "api_not_configured",
      "This site is not pointed at the Amber API. Set AMBER_API on the website service.",
    );
  }
  return base;
}

const TOKEN_KEY = "amber.web.token";
const SCOPE_KEY = "amber.web.scope";

export type Session = { token: string; scope: string[] | null };

export function readSession(): Session | null {
  try {
    const token = sessionStorage.getItem(TOKEN_KEY);
    if (!token) return null;
    const raw = sessionStorage.getItem(SCOPE_KEY);
    return { token, scope: raw ? (JSON.parse(raw) as string[]) : null };
  } catch {
    return null;
  }
}

export function writeSession(s: Session) {
  try {
    sessionStorage.setItem(TOKEN_KEY, s.token);
    sessionStorage.setItem(SCOPE_KEY, JSON.stringify(s.scope ?? null));
  } catch {
    /* private mode: the session lives in memory for this page only */
  }
}

export function clearSession() {
  try {
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(SCOPE_KEY);
  } catch {
    /* nothing to clear */
  }
}

export class AmberError extends Error {
  code: string;
  status: number;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

async function call<T>(path: string, init: RequestInit = {}, token?: string): Promise<T> {
  const base = await apiBase();
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(init.headers ?? {}),
      },
    });
  } catch {
    // A CORS refusal and an offline browser look identical from here, and the
    // likeliest cause of the first is AMBER_WEB_ORIGINS missing this origin.
    // A THROWN FETCH IS ALMOST NEVER THE USER'S CONNECTION.
    //
    // The page itself loaded, so the network works. What throws here is the
    // browser refusing a cross-origin response, and the overwhelmingly likely
    // cause is this site's origin missing from the API's AMBER_WEB_ORIGINS --
    // which matches EXACTLY, so https://www.example.com and https://example.com
    // are two different entries. Telling somebody to check their connection
    // sends them to look at the one thing that is demonstrably fine.
    throw new AmberError(
      0,
      "blocked_or_offline",
      `The browser blocked the request to ${base}. Its origin allowlist probably does not include ${
        typeof location !== "undefined" ? location.origin : "this site"
      }.`,
    );
  }

  // A RESPONSE THAT IS NOT JSON IS NOT AN API RESPONSE. Whatever answered is
  // not Amber -- a proxy, a CDN error page, this site's own 404 -- and
  // reporting that as a generic failure sends somebody to read API logs that
  // will never contain it.
  const text = await res.text().catch(() => "");
  let body: Record<string, unknown> = {};
  let parsed = false;
  try {
    body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    parsed = true;
  } catch {
    parsed = false;
  }

  if (!parsed) {
    throw new AmberError(
      res.status,
      "not_an_api_response",
      `${base} answered ${res.status} with something that is not JSON. Check AMBER_API points at the Amber API.`,
    );
  }

  if (!res.ok) {
    throw new AmberError(
      res.status,
      String(body?.error ?? body?.code ?? "request_failed"),
      String(body?.message ?? `Amber refused that (${res.status}).`),
    );
  }
  return body as T;
}

// ── signing in: the same phone-and-code flow the app uses ──────────────────

/**
 * THE ROUTE IS /v1/otp/start. It was written here as /v1/otp/request, which
 * does not exist on the API, and the way that failure presented is worth
 * keeping in mind: Fastify answers an OPTIONS preflight for an unknown route
 * from its default 404 handler, and that response carries no CORS headers. So
 * the browser reports "blocked by CORS policy: No Access-Control-Allow-Origin
 * header", never the 404 underneath it.
 *
 * A CORS error on a cross-origin POST therefore means one of two things, and
 * the message names only the first: the origin is not allowed, or the PATH IS
 * WRONG. Check the path before touching the allowlist.
 */
export const requestCode = (phone: string) =>
  call<{ ok: true; deliveredVia: string }>("/v1/otp/start", {
    method: "POST",
    body: JSON.stringify({ phone }),
  });

export async function verifyCode(phone: string, code: string): Promise<Session> {
  const r = await call<{ token: string; scope: string[] | null }>("/v1/otp/verify", {
    method: "POST",
    // `client: "web"` is what asks the server for the narrow token. Without it
    // the browser would be handed the same full session the phone gets.
    body: JSON.stringify({ phone, code, client: "web" }),
  });
  const session = { token: r.token, scope: r.scope ?? null };
  writeSession(session);
  return session;
}

// ── reading the network ────────────────────────────────────────────────────

export type Edge = {
  fromId: string;
  toId: string;
  kind: string;
  weight: number;
  label?: string | null;
};

export type Contact = {
  id: string;
  name?: string | null;
  fullName?: string | null;
  company?: string | null;
  title?: string | null;
  city?: string | null;
  emails?: string[];
  phoneNumbers?: string[];
  avatarUrl?: string | null;
  linkedinUrl?: string | null;
};

/**
 * A node in the network graph. `kind` is what it represents:
 *   owner        you, always present, always first
 *   contact      a person in your book
 *   organization a company two or more of them share
 *   domain       a mail domain two or more of them share
 *
 * `strength` is 0-1, how tied to you this is, derived server-side from real
 * interaction history. It drives both size and distance from the centre.
 */
export type GraphNode = {
  id: string;
  kind: "owner" | "contact" | "organization" | "domain";
  name: string;
  strength: number;
  company?: string | null;
  title?: string | null;
  city?: string | null;
  lastAt?: string | null;
  /** Which surface the last contact happened on, when the rollup knows. */
  lastChannel?: "email" | "calendar" | "message" | "note" | null;
  count90d?: number;
  memberCount?: number;
  /** Which groups this person belongs to, by key. Empty for most people. */
  groupKeys?: string[];
  /** Other names this dot stands for, when two cards were folded into one. */
  aliases?: string[];
  /** How many address-book cards this one dot represents. 1 unless merged. */
  mergedCount?: number;
  /** "person" or "place". A dentist's office is a contact, not a friend. */
  entity?: "person" | "place";
  /** Where this person came into the book from, best first: apple, google, mcp… */
  origins?: string[];
};

/**
 * A company or school two or more contacts share.
 *
 * MEMBERSHIP IS A LIST, NOT A PLACE. The server sends the ids; the client
 * colors them and lights them on demand. Nothing about where a dot sits on
 * screen says anything about which groups it is in, which is the only way to
 * stop the picture claiming colleagues the data never asserted.
 */
export type NetworkGroup = {
  key: string;
  id: string;
  label: string;
  kind: "organization" | "domain" | "category";
  memberCount: number;
  memberIds: string[];
};

export const getEdges = (token: string) =>
  call<{
    nodes?: GraphNode[];
    edges: Edge[];
    groups?: NetworkGroup[];
    count: number;
    stats?: {
      people: number;
      places?: number;
      cards?: number;
      merged?: number;
      clusters: number;
      edges: number;
    };
  }>("/v1/me/network/edges", {}, token);

export const getContacts = (token: string) =>
  call<{ contacts: Contact[] } | Contact[]>("/v1/me/contacts", {}, token);

/**
 * A fact somebody observed about this person, and an experience shared with
 * them. Both are read-only on the web; writing either stays on the phone.
 */
export type Fact = {
  id?: string;
  text?: string | null;
  fact_text?: string | null;
  source?: string | null;
  observed_at?: string | null;
  status?: string | null;
};

export type Experience = {
  id?: string | number;
  title?: string | null;
  body?: string | null;
  summary?: string | null;
  kind?: string | null;
  occurred_at?: string | null;
  starts_at?: string | null;
};

export const getFacts = (token: string, contactId: string) =>
  call<{ facts?: Fact[] }>(
    `/v1/me/contacts/${encodeURIComponent(contactId)}/facts`,
    {},
    token,
  );

export const getExperiences = (token: string, contactId: string) =>
  call<{ experiences?: Experience[] }>(
    `/v1/me/contacts/${encodeURIComponent(contactId)}/experiences`,
    {},
    token,
  );

/** The Six Dimensions of Health, in the canonical order. Never reorder. */
export const DIMENSIONS = [
  "spiritual",
  "emotional",
  "physical",
  "intellectual",
  "social",
  "financial",
] as const;

export type DimensionName = (typeof DIMENSIONS)[number];

export type ContactCardPayload = {
  dimensions?: {
    scores?: Partial<Record<DimensionName, number>>;
    dominant?: string | null;
    observationCount?: number;
    computed?: boolean;
  };
  rank?: {
    score?: number;
    warmth?: number;
    completeness?: number;
    observationCount?: number;
  } | null;
};

export const getCard = (token: string, contactId: string) =>
  call<Record<string, unknown> & ContactCardPayload>(
    `/v1/me/contacts/${encodeURIComponent(contactId)}/profile`,
    {},
    token,
  );

export type Provenance = {
  contactId: string;
  name: string | null;
  primarySource: string | null;
  primaryTrust: number;
  summary: string;
  sources: {
    source: string;
    trust: number;
    trustLabel: string;
    externalId: string | null;
    firstSeen: string | null;
    lastSeen: string | null;
    contributed: {
      name: string | null;
      emails: string[];
      phones: string[];
      company: string | null;
    };
  }[];
  fields: { field: string; source: string; trust: number; trustLabel: string }[];
  identityKeys: { phone: number; email: number; source: number };
  merges: { mergeId: string; absorbed: number; origin: string | null; mergedAt: string | null }[];
};

export const getProvenance = (token: string, contactId: string) =>
  call<Provenance>(
    `/v1/me/contacts/${encodeURIComponent(contactId)}/provenance`,
    {},
    token,
  );

export type Cadence = {
  contactId: string;
  total: {
    firstAt: string | null;
    lastAt: string | null;
    count30d: number;
    count90d: number;
    countAll: number;
    daysSinceLast: number | null;
  };
  channels: {
    channel: string;
    label: string;
    firstAt: string | null;
    lastAt: string | null;
    count30d: number;
    count90d: number;
    countAll: number;
    accounts: number;
    trend: "warming" | "cooling" | "steady";
  }[];
  primaryChannel: string | null;
  rhythm: { everyDays: number | null; label: string | null; trend: "warming" | "cooling" | "steady" };
  reciprocity: { inbound: number; outbound: number; outboundShare: number; lean: string } | null;
  accountSpan: number;
  summary: string;
};

/**
 * How often you two are actually in touch. Counts only -- there is no message
 * content anywhere in this response, which is why a scoped web token is allowed
 * to ask for it.
 */
export const getCadence = (token: string, contactId: string) =>
  call<Cadence>(
    `/v1/me/contacts/${encodeURIComponent(contactId)}/cadence`,
    {},
    token,
  );

/** A search hit says WHY it matched, so a card found by its company is explicable. */
export type SearchHit = Contact & { matchedOn?: string; why?: string };

export const searchContacts = (token: string, q: string) =>
  call<{ contacts?: SearchHit[]; results?: SearchHit[]; count?: number }>(
    `/v1/me/contacts/search?q=${encodeURIComponent(q)}`,
    {},
    token,
  );

/** The list endpoint has answered in two shapes over its life. Take either. */
export function asContactList(payload: unknown): Contact[] {
  if (Array.isArray(payload)) return payload as Contact[];
  const o = payload as Record<string, unknown>;
  for (const key of ["contacts", "results", "items"]) {
    if (Array.isArray(o?.[key])) return o[key] as Contact[];
  }
  return [];
}

export const displayName = (c: Contact) =>
  c.fullName || c.name || "Unnamed contact";
