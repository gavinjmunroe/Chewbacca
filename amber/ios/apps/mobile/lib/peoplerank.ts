import { Image } from 'react-native';
import { callMedhaId, type MedhaIdResult } from './medhaId';

// PeopleRank client. Ranking is done SERVER-SIDE by medha-id
// (POST /v1/me/people-rank), DID-scoped to the authenticated caller via the
// shared session bearer (lib/medhaId.ts). The backend reads the caller's own
// synced contacts from Firestore, scores them with its pure scorer (proximity +
// recency carry the ranking today), and returns a Perplexity-style natural-
// language answer grounded only in those ranked people.
//
// Pinecone semantic relevance and graph centrality exist as server-side seams
// but are currently OFF (centrality forced to 0; relevance behind a backend
// flag), so the components map will report them as 0 for now.

export type RankComponents = {
  // Renamed from `warmth`. `warmth` stays optional for the deploy window where
  // the backend may still send the old key (mapComponents fills proximity from
  // whichever arrives).
  proximity: number;
  warmth?: number;
  centrality: number;
  recency: number;
  relevance: number;
};

export type PersonLinkType = 'linkedin' | 'twitter' | 'github' | 'website' | string;

export type PersonLink = {
  type: PersonLinkType;
  url: string;
};

export type PersonProfile = {
  email?: string;
  phone?: string;
  lastContactAt?: string;
  source?: string;
  avatarUrl?: string;
};

export type RankedPerson = {
  id: string;
  name: string;
  company?: string;
  title?: string;
  phone?: string;
  score: number;
  reason?: string;
  // New rank-response signals. `drivers` = what helped them rank; `missing` =
  // what data would let Amber rank them better. Optional — older responses omit
  // them, so always guard for undefined.
  drivers?: string[];
  missing?: string[];
  components?: RankComponents;
  profile?: PersonProfile;
  links: PersonLink[];
  // WHY THIS PERSON IS ON SCREEN. 'mentioned' = the note named them.
  // 'recalled' = the network surfaced them because of what the note was about
  // (a place, a topic). Undefined on older payloads and on search results,
  // where every result is the answer and the distinction does not apply.
  kind?: 'mentioned' | 'recalled';
};

// One inline answer citation: maps a [[p:CONTACT_ID]] marker in `answer`
// to a person so the Amber screen can render a tappable chip.
export type PeopleRankCitation = {
  marker: string;
  contactId: string;
  name: string;
  company?: string;
  title?: string;
  score?: number;
  rank?: number;
};

export type PeopleRankResult = {
  people: RankedPerson[];
  answer: string | null;
  answerStatus: string;
  query: string | null;
  citations: PeopleRankCitation[];
};

// Shape of POST /v1/me/people-rank's 200 body (branch feat/people-rank-citations).
// Every nested field is treated as optional at runtime so a missing block
// degrades gracefully instead of crashing the screen.
type PeopleRankResponse = {
  query?: string | null;
  count?: number;
  people?: {
    contactId: string;
    name: string;
    company?: string | null;
    title?: string | null;
    phone?: string | null;
    score: number;
    components?: RankComponents;
    reason?: string;
    drivers?: string[] | null;
    missing?: string[] | null;
    profile?: {
      email?: string | null;
      phone?: string | null;
      lastContactAt?: string | null;
      source?: string | null;
      avatarUrl?: string | null;
    } | null;
    links?: { type?: string | null; url?: string | null }[] | null;
  }[];
  answer?: string | null;
  answer_status?: string;
  citations?: {
    marker?: string | null;
    contactId?: string | null;
    name?: string | null;
    company?: string | null;
    title?: string | null;
    score?: number | null;
    rank?: number | null;
  }[] | null;
};

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

// Map a raw components object into RankComponents, tolerating the warmth→
// proximity rename: proximity is filled from `proximity ?? warmth ?? 0`, so it
// works whether the backend sends the new or the old key during the deploy.
function mapComponents(raw: unknown): RankComponents | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const c = raw as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  return {
    proximity: num(c.proximity ?? c.warmth),
    warmth: typeof c.warmth === 'number' ? c.warmth : undefined,
    centrality: num(c.centrality),
    recency: num(c.recency),
    relevance: num(c.relevance),
  };
}

// Normalize a raw string[] (drivers / missing) — drop blanks, trim, undefined
// when empty so callers can `?.length`-guard.
function strArray(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = v
    .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
    .map((x) => x.trim());
  return out.length > 0 ? out : undefined;
}

// The caller's own profile, sent so the backend's proximity signal (which compares
// the caller's city/occupation to each contact's) can actually fire. All
// optional; empty fields are omitted from the request.
export type MeProfile = {
  city?: string;
  occupation?: string;
  bio?: string;
};

function cleanMe(me?: MeProfile): MeProfile | undefined {
  if (!me) return undefined;
  const out: MeProfile = {};
  const city = me.city?.trim();
  const occupation = me.occupation?.trim();
  const bio = me.bio?.trim();
  if (city) out.city = city;
  if (occupation) out.occupation = occupation;
  if (bio) out.bio = bio;
  return Object.keys(out).length > 0 ? out : undefined;
}

// Optional per-call controls. `signal` lets the screen cancel an in-flight
// rank when the user fires a newer query, so a slow stale answer can never
// land on top of a fresh one. `me` carries the caller's profile for the proximity
// signal (city/occupation/bio); omitted entirely when absent.
export type AskPeopleRankOptions = {
  limit?: number;
  signal?: AbortSignal;
  me?: MeProfile;
};

export async function askPeopleRank(
  query: string,
  opts: AskPeopleRankOptions = {},
): Promise<MedhaIdResult<PeopleRankResult>> {
  const q = query.trim();
  const limit = opts.limit ?? 15;
  const res = await callMedhaId<PeopleRankResponse>({
    path: '/v1/me/people-rank',
    method: 'POST',
    requireAuth: true,
    // `me` (city/occupation/bio) lets the backend proximity signal fire — it was
    // always 0 because the caller's profile was never sent. Omitted when absent.
    body: { query: q || undefined, limit: Math.min(limit, 50), me: cleanMe(opts.me) },
    signal: opts.signal,
  });
  if (!res.ok) return res;

  const data = res.data;
  const { people, citations } = ingestPeople(data?.people, data?.citations);

  return {
    ok: true,
    status: res.status,
    data: {
      people,
      answer: data?.answer ?? null,
      answerStatus: data?.answer_status ?? 'error',
      query: data?.query ?? (q || null),
      citations,
    },
  };
}

// Map a raw people[] + citations[] payload (from /v1/me/people-rank OR the
// streaming /v1/chat `people` event) into the app's RankedPerson /
// PeopleRankCitation shapes AND prime the person cache, so the rabbit-hole
// screen (person/[id]) can render a tapped person without a refetch. Exported
// so the streaming chat client reuses the exact mapping + caching the one-shot
// path uses; tolerant of `unknown` input since the SSE payload is untyped.
export function ingestPeople(
  rawPeople: unknown,
  rawCitations: unknown,
): { people: RankedPerson[]; citations: PeopleRankCitation[] } {
  const peopleArr = (
    Array.isArray(rawPeople) ? rawPeople : []
  ) as NonNullable<PeopleRankResponse['people']>;
  const citationArr = (
    Array.isArray(rawCitations) ? rawCitations : []
  ) as NonNullable<PeopleRankResponse['citations']>;

  const people: RankedPerson[] = peopleArr
    // Drop anyone without a real contact id: those come from a note captured
    // while the name was still unresolved, and a card built on a null id opens
    // to "we lost this person". Resolved people (and all search results) keep
    // their id and stay tappable.
    .filter((p) => p && p.contactId)
    .map((p) => ({
    id: p.contactId,
    name: str(p.name) ?? 'Unknown',
    company: str(p.company ?? undefined),
    title: str(p.title ?? undefined),
    phone: str(p.phone ?? undefined),
    score: normalizeScore(p.score),
    reason: str(p.reason),
    drivers: strArray(p.drivers),
    missing: strArray(p.missing),
    components: mapComponents(p.components),
    profile: mapProfile(p.profile),
    links: mapLinks(p.links),
    kind:
      (p as { kind?: string }).kind === 'recalled'
        ? ('recalled' as const)
        : (p as { kind?: string }).kind === 'mentioned'
          ? ('mentioned' as const)
          : undefined,
  }));

  const citations: PeopleRankCitation[] = citationArr
    .map((c): PeopleRankCitation | null => {
      const contactId = str(c?.contactId ?? undefined);
      if (!contactId) return null;
      return {
        marker: str(c?.marker ?? undefined) ?? `[[p:${contactId}]]`,
        contactId,
        name: str(c?.name ?? undefined) ?? 'Unknown',
        company: str(c?.company ?? undefined),
        title: str(c?.title ?? undefined),
        score: typeof c?.score === 'number' ? c.score : undefined,
        rank: typeof c?.rank === 'number' ? c.rank : undefined,
      };
    })
    .filter((c): c is PeopleRankCitation => c !== null);

  for (const p of people) personCache.set(p.id, p);

  return { people, citations };
}

// In-memory cache of the people last returned by askPeopleRank, so the person
// rabbit-hole screen can render known fields by contactId without re-fetching.
// We intentionally do NOT enrich/fetch live data on the detail screen.
const personCache = new Map<string, RankedPerson>();

// Cleared on sign-out: these are ranked people from the previous account's
// network, keyed only by contact id, and they would otherwise be served to the
// next account from a warm process. Also unbounded, so clearing reclaims memory.
export function clearPersonCache(): void {
  personCache.clear();
}

export function getCachedPerson(id: string): RankedPerson | undefined {
  return personCache.get(id);
}

/**
 * Seed the cache from a LIST ROW, so the detail screen has a name and a title to
 * paint on its very first frame.
 *
 * Opening a contact from chat was already instant, because askPeopleRank had put the
 * person in this cache on the way past. Opening the same contact from the People
 * list was not: nothing had ever cached it, so the screen mounted with no data and
 * the push animation slid a gray skeleton card in, which then snapped to the real
 * photo and name a beat later. Same contact, two completely different first frames,
 * and the bad one is the path a demo takes.
 *
 * NEVER OVERWRITES. A row knows a name and maybe a title; a ranked entry knows
 * drivers, components, links and a score. Seeding over that would throw away the
 * richer record to save a frame it was already saving.
 */
export function seedCachedPerson(seed: {
  id: string;
  name: string;
  company?: string;
  title?: string;
}): void {
  if (!seed.id || !seed.name) return;
  if (personCache.has(seed.id)) return;
  personCache.set(seed.id, {
    id: seed.id,
    name: seed.name,
    company: seed.company,
    title: seed.title,
    // Not a ranked result. score 0 and no links is the honest representation of
    // "this is a placeholder from a list row", and the live query replaces it.
    score: 0,
    links: [],
  });
}

// Lets a screen push a corrected/edited person back into the cache so it wins
// the `cached ?? snapshot ?? live` priority on the next mount (e.g. after
// saving a contact edit) instead of the stale entry ingestPeople last set.
export function setCachedPerson(person: RankedPerson): void {
  personCache.set(person.id, person);
}

function mapProfile(
  raw: NonNullable<PeopleRankResponse['people']>[number]['profile'],
): PersonProfile | undefined {
  if (!raw) return undefined;
  const profile: PersonProfile = {
    email: str(raw.email ?? undefined),
    phone: str(raw.phone ?? undefined),
    lastContactAt: str(raw.lastContactAt ?? undefined),
    source: str(raw.source ?? undefined),
    avatarUrl: str(raw.avatarUrl ?? undefined),
  };
  const hasAny = Object.values(profile).some((v) => v !== undefined);
  return hasAny ? profile : undefined;
}

function mapLinks(raw: NonNullable<PeopleRankResponse['people']>[number]['links']): PersonLink[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((l) => {
      const url = str(l?.url ?? undefined);
      if (!url) return null;
      return { type: str(l?.type ?? undefined) ?? 'website', url } satisfies PersonLink;
    })
    .filter((l): l is PersonLink => l !== null);
}

// Look up a citation/person by contactId for inline chip rendering.
export function findPerson(
  result: PeopleRankResult,
  contactId: string,
): { name: string; company?: string; title?: string } | undefined {
  const person = result.people.find((p) => p.id === contactId);
  if (person) return { name: person.name, company: person.company, title: person.title };
  const cite = result.citations.find((c) => c.contactId === contactId);
  if (cite) return { name: cite.name, company: cite.company, title: cite.title };
  return undefined;
}

// Normalize a score to 0..1 for bar rendering. The backend already returns
// 0..1 composites, so this is a clamp; >1 is treated as a percentage for safety.
export function normalizeScore(score: number): number {
  if (!Number.isFinite(score) || score <= 0) return 0;
  if (score > 1) return Math.min(score / 100, 1);
  return Math.min(score, 1);
}

// Single regex used for both rendering inline chips and flattening the answer
// to shareable plain text. Keep it module-scoped so callers share one source.
const ANSWER_MARKER_RE = /\[\[p:([^\]]+)\]\]/g;

// Resolve [[p:CONTACT_ID]] markers in the answer to the person's name, yielding
// clean prose suitable for copy and share. Unknown markers degrade to "someone"
// rather than leaking an internal id to the clipboard.
export function resolveAnswerText(result: PeopleRankResult): string {
  const answer = result.answer?.trim();
  if (!answer) return '';
  return answer
    .replace(ANSWER_MARKER_RE, (_full, id, offset: number, str: string) => {
      const person = findPerson(result, String(id).trim());
      const name = person?.name ?? 'someone';
      // The backend emits "Name [[p:ID]]": if the prose immediately before the
      // marker already ends with this person's name, drop the marker entirely so
      // copied text reads "Name" once, not "Name Name". Otherwise substitute it.
      if (person?.name) {
        const before = str.slice(0, offset).replace(/\s+$/, '');
        if (before.toLowerCase().endsWith(person.name.toLowerCase())) return '';
      }
      return name;
    })
    // WHITESPACE IS COLLAPSED, BUT NEWLINES SURVIVE.
    //
    // This used to be `.replace(/\s+/g, ' ')`, which flattened the entire answer onto
    // one line. That was harmless when the only consumer was PeopleRank prose. It is
    // not harmless now: the chat answer is markdown, and a markdown table is defined by
    // its rows being on separate lines. Flattening turned every table into
    // "| Cafe | Address | |---|---| | Butler | 40 Water St |" as literal body text, and
    // every "- " list into a run-on sentence. The renderer was working correctly on
    // input that had already been destroyed one function earlier.
    //
    // So: runs of spaces and tabs collapse (which is what the marker substitution
    // above actually needs), newlines do not. Trailing spaces around a newline go, and
    // three or more blank lines cap at one, so a chatty model cannot pad the answer
    // with vertical space.
    .replace(/[^\S\n]+/g, ' ')
    .replace(/[ \t]*\n[ \t]*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Warm the avatar cache for the people most likely to be tapped next, so the
// person rabbit-hole opens with the photo already painted. Network/image
// failures are swallowed: prefetch is a best-effort optimization, never a
// blocker. personCache is already primed by askPeopleRank, so the card data
// itself is instant; this only covers the remote avatar fetch.
export function prefetchTopPeople(people: RankedPerson[], count = 3): void {
  for (const person of people.slice(0, Math.max(0, count))) {
    const url = person.profile?.avatarUrl;
    if (url) {
      void Image.prefetch(url).catch(() => {});
    }
  }
}
