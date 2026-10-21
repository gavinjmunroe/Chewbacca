import { dropAll } from "./cache";

/**
 * THE ONLY PLACE THIS SITE TALKS TO AMBER.
 *
 * Everything the web session can do is here, and it is a short list on purpose:
 * sign in, read your network, read a card, search your own contacts. The token
 * the API mints for `client: "web"` carries `network:read` and `contacts:read`
 * and the server rejects it everywhere else, so this file cannot grow past what
 * the credential is actually allowed to do without the server saying no first.
 *
 * WHERE THE TOKEN LIVES, AND WHY THAT CHANGED. It was sessionStorage, which
 * dies with the tab -- defensible for a credential nobody can revoke from
 * another device, and wrong for a tool a company has open all day. It meant
 * signing in again after every browser restart, and on a deployment where the
 * other door is an emailed link that may never arrive, "sign in again" is not
 * a small ask.
 *
 * localStorage, then, paired with a server session that renews itself while it
 * is being used. The honest accounting: both are readable by any script that
 * runs on this origin, so this does not change what an XSS can steal, only how
 * long it stays useful. The real fix is an httpOnly cookie, which needs
 * credentialed CORS and CSRF protection and is a change to make deliberately
 * rather than in passing.
 *
 * Every access is in a try/catch because Safari in private mode throws rather
 * than returning null, and a thrown storage read should log somebody out, not
 * white-screen them.
 */

/**
 * The one place that decides which storage a session lives in.
 *
 * Signing out clears BOTH, because sessions written by the previous version
 * are in sessionStorage and a sign-out that leaves one of them behind is a
 * sign-out that did not happen.
 */
function store(): Storage {
  return localStorage;
}

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

export async function apiBase(): Promise<string> {
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
    const token = store().getItem(TOKEN_KEY);
    if (!token) return null;
    const raw = store().getItem(SCOPE_KEY);
    return { token, scope: raw ? (JSON.parse(raw) as string[]) : null };
  } catch {
    return null;
  }
}

export function writeSession(s: Session) {
  try {
    store().setItem(TOKEN_KEY, s.token);
    store().setItem(SCOPE_KEY, JSON.stringify(s.scope ?? null));
  } catch {
    /* private mode: the session lives in memory for this page only */
  }
}

/**
 * THE TOKEN AS IT IS RIGHT NOW, read from storage at the moment of the call.
 *
 * THIS EXISTS BECAUSE OF A REAL BUG, and it is worth naming. The org setup
 * wizard read the session once into React state at mount and passed that string
 * down to every step. Creating a company re-mints the token -- the old one was
 * issued when the caller was not yet an admin -- and the new one went into
 * storage while the component kept handing out the stale one. Every call after
 * step one came back "this session can only read your network and your
 * contacts", and refreshing the page fixed it, which is the signature of
 * exactly this mistake.
 *
 * A token is not component state. It is a credential that something else can
 * replace underneath you, so it is read when it is used.
 */
export function tokenNow(): string | null {
  return readSession()?.token ?? null;
}

export function clearSession() {
  try {
    store().removeItem(TOKEN_KEY);
    sessionStorage.removeItem(TOKEN_KEY);
    store().removeItem(SCOPE_KEY);
    sessionStorage.removeItem(SCOPE_KEY);
  } catch {
    /* nothing to clear */
  }
  /*
   * AND EVERYTHING THE CACHE IS HOLDING.
   *
   * lib/cache.ts keeps one account's feed, files and roster at module scope so
   * tab clicks are instant. That memory survives a route change, so without
   * this the next person to sign in on this browser — or the same person
   * switching workspaces — gets a first frame painted from the previous
   * account's data before the refresh lands.
   */
  try {
    dropAll();
  } catch {
    /* the cache not clearing is not a reason to fail a sign-out */
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

/**
 * EXPORTED so lib/org.ts can reach the API through the same door: one base-URL
 * resolution, one CORS diagnosis, one "that was not JSON" check, one error
 * shape. A second fetch wrapper would be a second place for all four of those
 * to be subtly different, and the comments above are what that cost last time.
 */
export async function call<T>(path: string, init: RequestInit = {}, token?: string): Promise<T> {
  /*
   * ONE RETRY, ONLY FOR "ASK ME AGAIN".
   *
   * The API answers 503 lookup_unavailable when it could not reach its own
   * database to resolve the caller -- a real thing that happens for a second
   * at a time and used to surface as "Account not found" on a console that
   * had already loaded with the company's name on it.
   *
   * It is retried HERE rather than left to each screen, because every screen
   * would have to remember and the one that forgets is the one somebody is
   * looking at. Only this status is retried: a 4xx will say the same thing
   * twice, and retrying a POST that already succeeded is a second invitation.
   */
  const retryable = !init.method || init.method.toUpperCase() === "GET";
  try {
    return await callOnce<T>(path, init, token);
  } catch (e) {
    if (
      retryable &&
      e instanceof AmberError &&
      (e.status === 503 || e.code === "lookup_unavailable")
    ) {
      await new Promise((r) => setTimeout(r, 600));
      return callOnce<T>(path, init, token);
    }
    throw e;
  }
}

async function callOnce<T>(path: string, init: RequestInit = {}, token?: string): Promise<T> {
  const base = await apiBase();
  let res: Response;
  try {
    /*
     * NEVER SET content-type FOR FormData, AND THIS BROKE EVERY UPLOAD.
     *
     * A multipart body needs a boundary in its content-type header --
     * `multipart/form-data; boundary=----WebKitFormBoundaryXyz` -- and only
     * the browser knows the boundary it generated. Forcing
     * `application/json` here meant the server was told JSON and handed a
     * body starting `------WebKitFormBoundary...`, which it dutifully tried
     * to parse.
     *
     * The error that came back was "No number after minus sign in JSON at
     * position 1": position 1 is the second character of that boundary. It
     * reads like a corrupt file and it is a header we sent.
     *
     * Nothing uploaded through this client has ever worked.
     */
    const isForm = typeof FormData !== "undefined" && init.body instanceof FormData;

    res = await fetch(`${base}${path}`, {
      ...init,
      headers: {
        ...(isForm ? {} : { "content-type": "application/json" }),
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

  /*
   * A FRESHER SESSION, IF THE SERVER SENT ONE.
   *
   * Scope is baked into a token at mint time, so a browser signed in before a
   * feature shipped holds a credential that predates it and gets refused on
   * the new screens with no clue that signing out would fix it. The server now
   * notices a stale browser session and puts a replacement on this header;
   * storing it here means every page in the app is repaired by whatever
   * request happens to go out first, rather than each one needing to know.
   */
  const refreshed = res.headers.get("x-amber-session");
  if (refreshed) {
    try {
      writeSession({ token: refreshed, scope: null });
    } catch {
      /* a session that cannot be stored is not a reason to fail the call */
    }
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

// ── your own account ────────────────────────────────────────────────────────

/**
 * THE WRITES A BROWSER CAN NOW DO.
 *
 * The web token used to carry `network:read` and `contacts:read` and nothing
 * else, which was right while this site was a viewer beside an iOS app. It
 * stopped being right the moment somebody could set up a company here: an
 * account that cannot say its own name, and an address book that can only be
 * filled by a phone, is not an account anybody can actually use.
 *
 * The server grants these one route at a time (lib/token-scope.js). Deleting,
 * merging and anything that spends money on enrichment are deliberately NOT in
 * that list and stay on the phone.
 */
export type MyProfile = {
  displayName?: string | null;
  fullName?: string | null;
  currentCity?: string | null;
  occupation?: string | null;
  bio?: string | null;
  phone?: string | null;
};

export const getMe = (token: string) =>
  call<{ profile?: MyProfile; phone?: string | null } & MyProfile>("/v1/me", {}, token);

export const updateMe = (token: string, fields: Partial<MyProfile>) =>
  call<Record<string, unknown>>(
    "/v1/me",
    { method: "PATCH", body: JSON.stringify(fields) },
    token,
  );

export const createContact = (
  token: string,
  person: { name: string; email?: string; phone?: string; company?: string; title?: string; city?: string },
) =>
  call<{ ok?: boolean; contactId?: string; id?: string }>(
    "/v1/me/contacts/create",
    { method: "POST", body: JSON.stringify(person) },
    token,
  );

/**
 * A .vcf or .csv, posted as text rather than multipart.
 *
 * The server sniffs the format from the bytes and does not trust the filename,
 * and the import goes through the same resolver a phone sync does — so a file
 * holding people already in the book updates their cards instead of doubling
 * them.
 */
export const importContactFile = (
  token: string,
  content: string,
  filename?: string,
  source?: string,
) =>
  call<{
    created: number;
    merged: number;
    updated: number;
    failed: number;
    deduped: number;
    format?: string;
    source?: string;
  }>(
    "/v1/me/contacts/import-file",
    { method: "POST", body: JSON.stringify({ content, filename, source }) },
    token,
  );

/**
 * ASK, AND READ THE ANSWER AS IT IS WRITTEN.
 *
 * WHY THIS IS NOT `call()`. call() resolves once, with a parsed body, which
 * is the right shape for every other endpoint and the wrong one here: the
 * whole point is that the evidence lands immediately and the sentences
 * arrive behind it. Retrieval is a few hundred milliseconds and the model is
 * two or three seconds; waiting for the last token before showing the first
 * thing is what made this feel broken rather than busy.
 *
 * SERVER-SENT EVENTS, READ BY HAND. EventSource cannot POST and cannot carry
 * an Authorization header, so this is fetch plus a reader. Frames are
 * separated by a blank line and may arrive split across chunks, which is why
 * the buffer keeps the tail rather than assuming a chunk is a frame -- that
 * assumption works on a fast connection and drops words on a slow one.
 */
export type AskEvent =
  | { type: "evidence"; payload: unknown }
  | { type: "token"; text: string }
  | { type: "done"; payload: { grounded: boolean; answer?: string | null } };

export async function askStream(
  q: string,
  onEvent: (e: AskEvent) => void,
  token?: string,
  signal?: AbortSignal,
  /** Person ids currently on screen. "These" in a question means these. */
  focus?: string[],
): Promise<void> {
  const base = await apiBase();
  const res = await fetch(`${base}/v1/org/ask/stream`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      accept: "text/event-stream",
    },
    body: JSON.stringify(focus?.length ? { q, focus } : { q }),
    signal,
  });

  if (!res.ok || !res.body) {
    throw new AmberError(res.status, "ask_failed", "Could not ask that.");
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";
    for (const frame of frames) {
      const lines = frame.split("\n");
      const event = lines.find((l) => l.startsWith("event:"))?.slice(6).trim();
      const data = lines.find((l) => l.startsWith("data:"))?.slice(5).trim();
      if (!event || !data) continue;
      let payload: { t?: string; grounded?: boolean; answer?: string | null };
      try {
        payload = JSON.parse(data);
      } catch {
        continue;
      }
      if (event === "evidence") onEvent({ type: "evidence", payload });
      else if (event === "token") onEvent({ type: "token", text: String(payload.t ?? "") });
      else if (event === "done")
        onEvent({
          type: "done",
          payload: { grounded: Boolean(payload.grounded), answer: payload.answer ?? null },
        });
    }
  }
}
