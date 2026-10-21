/**
 * THE RELATIONSHIP LEDGER, FROM THE BROWSER.
 *
 * One node per relationship, which may be a person or a firm. Every source
 * the company has connected writes into the same ledger, and this is the
 * read side of it.
 *
 * TWO COUNTS ON EVERY NODE AND THE DIFFERENCE IS THE POINT. `interactions`
 * is what this viewer may actually read; `company_interactions` is the whole
 * relationship, summed from edges, which are company-visible by design. A
 * screen showing both can say "fourteen touches across three people, four of
 * them yours" -- the honest version, and more useful than either alone.
 */

import { call, tokenNow } from "./amber";

const t = () => tokenNow() ?? undefined;

export type Identity = { kind: string; value: string };

export type PersonRow = {
  id: string;
  display_name: string;
  title: string | null;
  company: string | null;
  owner_id: string | null;
  owner_name: string | null;
  visibility: "org" | "private";
  account_id: string | null;
  account_name: string | null;
  interactions: number | null;
  last_at: string | null;
  strength: string | number | null;
  /** Every address on this person, not just the first. */
  emails?: string[];
  /** The one address the list query surfaces, kept for older callers. */
  email?: string | null;
  /** What somebody has written about them. */
  note?: string | null;
  /** True when their address is on the company's own domain. */
  internal?: boolean;
  /** Set once they have an account here. Null means known but not joined. */
  member_amber_id?: string | null;
  member_name?: string | null;
};

export type PersonDetail = PersonRow & {
  note: string | null;
  identities: Identity[];
  account_domain: string | null;
  company_interactions: number;
  company_last_at: string | null;
  /** How many other nodes were merged into this one. */
  merged_count: number;
  created_at: string;
  updated_at: string;
};

export type Knower = {
  member_id: string;
  member_name: string | null;
  title: string | null;
  interactions: number;
  first_at: string | null;
  last_at: string | null;
  strength: string | number;
};

export type Interaction = {
  id: string;
  kind: string;
  source: string;
  summary: string | null;
  artifact_url: string | null;
  occurred_at: string;
  member_id: string | null;
  member_name: string | null;
  visibility: "org" | "private";
  /** Present on an account timeline: which person at the firm it was with. */
  person_id?: string;
  person_name?: string;
};

export type AccountRow = {
  id: string;
  name: string;
  domain: string | null;
  kind: string;
  owner_id: string | null;
  owner_name: string | null;
  people: number;
  knowers: number;
  interactions: number;
  last_at: string | null;
  strength: string | number | null;
};

export type ColdRow = {
  id: string;
  display_name: string;
  company: string | null;
  account_id: string | null;
  account_name: string | null;
  member_id: string;
  member_name: string | null;
  last_at: string;
  interactions: number;
  strength: string | number;
  days_since: number;
};

export type DuplicateGroup = {
  n: number;
  signal: "name" | "address";
  suggestedKeepId: string | null;
  people: {
    id: string;
    display_name: string;
    account_name: string | null;
    emails: string[];
    interactions: number;
    last_at: string | null;
  }[];
};

const q = (params: Record<string, string | number | boolean | null | undefined>) => {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== null && v !== undefined && v !== "" && v !== false) s.set(k, String(v));
  }
  const out = s.toString();
  return out ? `?${out}` : "";
};

/* --------------------------------------------------------------- people */

export const listPeople = (
  opts: { q?: string; mine?: boolean; account?: string; scope?: "internal" | "external" } = {},
) =>
  call<{ people: PersonRow[] }>(
    `/v1/org/memory/people${q({
      q: opts.q,
      mine: opts.mine,
      account: opts.account,
      scope: opts.scope,
      limit: 300,
    })}`,
    {},
    t(),
  ).then((r) => r.people);

export const getPerson = (personId: string) =>
  call<{
    person: PersonDetail;
    whoKnows: Knower[];
    history: Interaction[];
    hidden: number;
  }>(`/v1/org/memory/people/${personId}`, {}, t());

export const patchPerson = (
  personId: string,
  body: Partial<{
    /** Only a person may write this. A producer may only upgrade an address. */
    displayName: string;
    note: string;
    ownerId: string;
    title: string;
    company: string;
    visibility: "org" | "private";
  }>,
) =>
  call<{ person: PersonDetail }>(
    `/v1/org/memory/people/${personId}`,
    { method: "PATCH", body: JSON.stringify(body) },
    t(),
  ).then((r) => r.person);

/* ------------------------------------------------------------- accounts */

export const listAccounts = (opts: { q?: string; mine?: boolean } = {}) =>
  call<{ accounts: AccountRow[] }>(
    `/v1/org/memory/accounts${q({ q: opts.q, mine: opts.mine, limit: 300 })}`,
    {},
    t(),
  ).then((r) => r.accounts);

export const getAccount = (accountId: string) =>
  call<{
    account: AccountRow & { note: string | null };
    people: PersonRow[];
    whoKnows: (Knower & { people: number })[];
    history: Interaction[];
    hidden: number;
  }>(`/v1/org/memory/accounts/${accountId}`, {}, t());

export const patchAccount = (
  accountId: string,
  body: Partial<{ name: string; kind: string; note: string; ownerId: string }>,
) =>
  call<{ account: AccountRow }>(
    `/v1/org/memory/accounts/${accountId}`,
    { method: "PATCH", body: JSON.stringify(body) },
    t(),
  ).then((r) => r.account);

/* --------------------------------------------------------- nudges, dupes */

export const goingCold = (opts: { mine?: boolean; days?: number } = {}) =>
  call<{ people: ColdRow[] }>(
    `/v1/org/memory/cold${q({ mine: opts.mine, days: opts.days, limit: 25 })}`,
    {},
    t(),
  ).then((r) => r.people);

export const duplicates = () =>
  call<{ groups: DuplicateGroup[] }>("/v1/org/memory/duplicates", {}, t()).then((r) => r.groups);

export const mergePeople = (keepId: string, mergeIds: string[]) =>
  call<{ ok: boolean; merged: number }>(
    "/v1/org/memory/merge",
    { method: "POST", body: JSON.stringify({ keepId, mergeIds }) },
    t(),
  );

export const unmergePerson = (personId: string) =>
  call<{ ok: boolean }>(`/v1/org/memory/merge/${personId}`, { method: "DELETE" }, t());

/* ------------------------------------------------------- sharing, import */

export const shareInteraction = (interactionId: string, note?: string) =>
  call<{ ok: boolean }>(
    `/v1/org/memory/interactions/${interactionId}/share`,
    { method: "POST", body: JSON.stringify({ note: note ?? null }) },
    t(),
  );

export const unshareInteraction = (interactionId: string) =>
  call<{ ok: boolean }>(
    `/v1/org/memory/interactions/${interactionId}/share`,
    { method: "DELETE" },
    t(),
  );

/**
 * Upload an assistant export.
 *
 * Dry run unless `commit`, because the first question anybody asks is what
 * this would put in their graph, and answering it by writing the rows and
 * showing the result is the same answer at a much worse price.
 */
export async function importAiExport(
  file: File,
  commit = false,
  /**
   * Per-document sharing, keyed by CONVERSATION ID rather than by position.
   *
   * The preview is sorted strongest-first and the commit call re-derives that
   * order from the same file. Keying by index would pass every test and then,
   * the one time a conversation scored differently, publish the wrong
   * document to the company. There is no taking that back.
   */
  reach: Record<string, string> = {},
) {
  const body = new FormData();
  body.set("file", file);
  if (Object.keys(reach).length > 0) body.set("reach", JSON.stringify(reach));
  return call<{
    ok: boolean;
    provider: string;
    conversations: number;
    matched: number;
    people: number;
    written: number;
    unusable: number;
    sample: { person: string; via: string; title: string; at: string | null }[];
  }>(`/v1/org/memory/import${commit ? "?commit=1" : ""}`, { method: "POST", body }, t());
}

/* ---------------------------------------------------------------- copilot */

export type CopilotStatus = {
  /** Whether THIS DEPLOYMENT has a Microsoft application registered. */
  configured: boolean;
  /** Whether THIS COMPANY's administrator has approved it. */
  connected: boolean;
  tenantId: string | null;
  consentedAt: string | null;
  scope: string;
  /** Present when `configured` is false: whose problem it is and what fixes it. */
  reason: string | null;
};

/**
 * TWO FLAGS, NOT ONE, and the screen has to keep them apart.
 *
 * "Nobody has approved this yet" is the customer's administrator and takes
 * one click. "This deployment has no Microsoft application" is ours and no
 * amount of clicking will fix it. Collapsing them into `connected: false`
 * produces a button that cannot work and says nothing about why.
 */
export const copilotStatus = () =>
  call<CopilotStatus>(`/v1/org/copilot/status`, {}, t());

/**
 * Start the admin-consent flow.
 *
 * WHY THIS IS A FETCH AND THEN A REDIRECT, rather than a link.
 *
 * The previous version pointed the browser straight at the API. A top-level
 * navigation carries no Authorization header, so that request arrived
 * anonymous, the server could not tell which company was connecting, and it
 * 404'd -- which is exactly what was happening in production. The
 * authenticated page asks for the URL, with its token, and then sends the
 * browser there. Still one press.
 */
export async function copilotConsentUrl(returnTo = "/org") {
  return call<{ url: string; scope: string; expiresInSeconds: number }>(
    `/v1/org/copilot/consent-url`,
    { method: "POST", body: JSON.stringify({ returnTo }) },
    t(),
  );
}

/** How long ago, in the shortest form that is still true. */
export function ago(iso: string | null | undefined): string {
  if (!iso) return "never";
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  const months = Math.round(days / 30);
  if (months < 18) return `${months}mo ago`;
  return `${Math.round(days / 365)}y ago`;
}

/**
 * A name worth showing, when the only thing we were given is an address.
 *
 * Of 515 guest entries on a real calendar, 5 carried a display name: the
 * provider fills it only when it already knows the person. So a node is
 * usually named after its address, and `sagartiw@stanford.edu` as a heading
 * makes a relationship graph nobody can read.
 *
 * A dotted local part is a name people actually write down -- first.last is
 * a convention, not a guess -- so it is unpacked. Anything else keeps its
 * local part, which is at least shorter than the whole address. The real fix
 * is a person typing the right name, which the node page offers; this is
 * what the screen shows until they do.
 */
export function readableName(raw: string): string {
  const name = String(raw ?? "").trim();
  if (!name.includes("@")) return name;

  const local = name.split("@")[0];
  const parts = local.split(/[._-]+/).filter(Boolean);
  const cased = parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1));

  // Two or more parts is a convention worth trusting. One is a guess, and
  // "Sagartiw" reads worse than the address it came from.
  return cased.length >= 2 ? cased.join(" ") : local;
}

/* ------------------------------------------------------------- first run */

/**
 * Pull everything connected and build the graph. One call.
 *
 * The alternative is a setup wizard, and the failure a wizard produces is
 * the one that matters: somebody connects a calendar, is returned to an
 * empty screen, and concludes the product does not work. The consent
 * succeeded and the sync succeeded and they were shown nothing.
 */
export const syncMemory = () =>
  call<{
    ok: boolean;
    reason?: string;
    hint?: string;
    calendars: number;
    synced: { account: string; events: number; error: string | null }[];
    written: number;
    people: number;
    accounts: number;
    /** Relationships this member personally has, as opposed to the company's. */
    mine: number;
  }>("/v1/org/memory/sync", { method: "POST" }, t());

/**
 * A PERSON'S WIKI PAGE: the record, plus what we have written that names
 * them and which rooms they are in.
 *
 * `circles: null` means they are not one of us -- different from being in
 * none, and the screen says so rather than showing an empty list that reads
 * like a missing feature.
 */
export const getPersonProfile = (personId: string) =>
  call<{
    person: PersonDetail;
    whoKnows: Knower[];
    history: Interaction[];
    hidden: number;
    pages: { id: string; slug: string; title: string; excerpt: string | null }[];
    circles: { id: string; name: string; purpose?: string | null }[] | null;
  }>(`/v1/org/memory/people/${personId}/profile`, {}, t());

/**
 * NAME THE PEOPLE WHO ARE STILL ADDRESSES.
 *
 * Splits what has a separator in it, asks a model about what does not, and
 * refuses any answer the address cannot account for. Runs at the end of a
 * sync too; this is the button for a company that synced last week and has
 * a graph full of addresses NOW, because telling them to re-sync twenty
 * thousand events to fix a label is not an answer.
 */
export const fillInNames = () =>
  call<{
    ok: true;
    people: { named?: number; considered?: number };
    firms: { named?: number };
  }>("/v1/org/memory/names", { method: "POST" }, t());

/* ------------------------------------------------- links between people */

export type PersonLink = {
  id: string;
  from_person: string;
  to_person: string;
  from_name: string;
  to_name: string;
  kind: "introduced" | "knows" | "met_at" | "worked_with";
  note: string | null;
  source: "human" | "inferred";
  accepted_at: string | null;
};

export const listLinks = () =>
  call<{ links: PersonLink[] }>("/v1/org/memory/links", {}, t()).then((r) => r.links ?? []);

export const addLink = (body: {
  fromPerson: string;
  toPerson: string;
  kind?: PersonLink["kind"];
  note?: string | null;
}) =>
  call<{ ok: true; link: PersonLink }>(
    "/v1/org/memory/links",
    { method: "POST", body: JSON.stringify(body) },
    t(),
  );

export const removeLink = (linkId: string) =>
  call<{ ok: true }>(`/v1/org/memory/links/${linkId}`, { method: "DELETE" }, t());

/* ------------------------------------------------------ saying it aloud */

export type CaptureResult = {
  transcript: string;
  notes: { personId: string; personName: string; text: string; category: string | null }[];
  links: {
    fromId: string;
    fromName: string;
    toId: string;
    toName: string;
    kind: PersonLink["kind"];
    note: string | null;
  }[];
  ambiguous: { said: string; text: string; candidates: { id: string; name: string }[] }[];
  unmatched: { said: string; text: string }[];
};

/** Hand over what was said -- typed or spoken -- and get back proposals. */
export const captureSpoken = (body: {
  text?: string;
  audioBase64?: string;
  mimeType?: string;
}) =>
  call<CaptureResult & { ok: true }>(
    "/v1/org/memory/capture",
    { method: "POST", body: JSON.stringify(body) },
    t(),
  );

/* -------------------------------------------------- writing to somebody */

/**
 * Send from the company's own domain, now or at a time.
 *
 * The address must be one this person actually has: the server checks it
 * against their identities rather than trusting the body, so this cannot be
 * turned into a way to send from the company to anywhere.
 */
export const emailPerson = (
  personId: string,
  body: {
    to: string;
    subject: string;
    body: string;
    sendAt?: string | null;
    attachments?: { filename: string; content: string }[];
  },
) =>
  call<{ ok: true; to: string; scheduledFor: string | null }>(
    `/v1/org/memory/people/${personId}/email`,
    { method: "POST", body: JSON.stringify(body) },
    t(),
  );
