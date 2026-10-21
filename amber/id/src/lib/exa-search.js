/**
 * Exa web retrieval — the live-web primitive behind the chat path.
 *
 * TWO STAGES, ON PURPOSE.
 *
 *   exaSearch()   — BREADTH. One /search call: find candidate pages and take a
 *                   snippet of each. Cheap, one round trip, and enough to answer
 *                   "is Balthazar open on Sunday".
 *   exaContents() — DEPTH. One /contents call: pull the FULL text of specific
 *                   pages. This is what makes "scan this page and find X" and
 *                   "list ten VPs of finance in New York" possible at all.
 *
 * Why depth has to be a separate call. /search returns a snippet per page, and a
 * snippet is the top of the document — the nav, the headline, the standfirst. The
 * ten names you asked for are in a table two thirds of the way down, and no snippet
 * length short enough to be worth sending across ten pages will ever contain them.
 * So the pipeline is: search wide and shallow to decide WHICH pages matter, then
 * read those few pages deeply. That is the same shape as reading search results
 * yourself, and it is the difference between an answer that names three people and
 * one that names ten.
 *
 * HIGHLIGHTS. /search can also be asked for the sentences in each page most
 * relevant to a query, rather than its opening. Cheap, and it means even the breadth
 * pass surfaces the part of the page that bears on the question.
 *
 * EVERYTHING IS FAIL-SAFE. Every failure path — no key, blank input, network,
 * timeout, non-2xx, bad JSON, throw — resolves to an empty array. Nothing here
 * throws to the caller, because the caller's fallback is a perfectly good
 * no-web answer and an exception would replace that with an error screen.
 */

const EXA_SEARCH_URL = "https://api.exa.ai/search";
const EXA_CONTENTS_URL = "https://api.exa.ai/contents";

// Breadth is latency-sensitive (it blocks the whole answer); depth is allowed
// longer because it is doing the actual reading and only runs when it will change
// the answer.
const SEARCH_TIMEOUT_MS = Number(process.env.EXA_SEARCH_TIMEOUT_MS || 6000);
const CONTENTS_TIMEOUT_MS = Number(process.env.EXA_CONTENTS_TIMEOUT_MS || 12000);

/** Snippet length for the breadth pass. */
const SNIPPET_CHARS = 1200;
/** Per-page ceiling for the depth pass. */
const DEEP_CHARS_DEFAULT = 8000;
const DEEP_CHARS_MAX = 24000;
/** Never read more than this many pages deeply in one turn. */
const MAX_DEEP_PAGES = 8;

const clampChars = (n, fallback) => {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return fallback;
  return Math.min(DEEP_CHARS_MAX, Math.max(500, Math.floor(v)));
};

const oneLine = (s, cap) =>
  typeof s === "string" ? s.replace(/\s+/g, " ").trim().slice(0, cap) : "";

/** Shape one Exa result row into what the chat path consumes. */
function mapResult(r, cap) {
  const highlights = Array.isArray(r?.highlights)
    ? r.highlights.map((h) => oneLine(h, 600)).filter(Boolean).slice(0, 5)
    : [];
  return {
    title: typeof r?.title === "string" ? r.title : "",
    url: typeof r?.url === "string" ? r.url : "",
    text: oneLine(r?.text, cap),
    // The sentences Exa judged most relevant to the query, when asked for.
    highlights,
    // Both optional and both worth having: a claim about the present is only as
    // good as the date of the page it came from, and the answer is told to say so.
    publishedDate: typeof r?.publishedDate === "string" ? r.publishedDate : null,
    author: typeof r?.author === "string" ? r.author : null,
  };
}

/**
 * BREADTH. Find candidate pages for a query.
 *
 *   exaSearch({ query, numResults, highlightQuery, maxCharacters, includeDomains })
 *     -> [{ title, url, text, highlights, publishedDate, author }]
 */
/**
 * Is web retrieval actually configured?
 *
 * WHY THIS IS EXPORTED. `exaSearch` returns [] when there is no key — deliberately,
 * so a missing key degrades to a no-web answer instead of a 500. The cost of that
 * choice is that "no key" and "the web had nothing" look identical from the outside,
 * and the model then improvises an answer with no sources and no links, which is
 * exactly what the app was doing. Anything that decides to search should be able to
 * say out loud which of the two happened.
 */
export function exaConfigured(apiKey = process.env.EXA_API_KEY) {
  return typeof apiKey === "string" && apiKey.trim().length > 0;
}

export async function exaSearch({
  query,
  numResults = 5,
  /** Ask for the sentences most relevant to this (usually the user's question). */
  highlightQuery = null,
  maxCharacters = SNIPPET_CHARS,
  includeDomains = null,
  /**
   * THE LEVERS THE CALLER NEVER HAD, and they are the difference between a
   * search that knows who is asking and one that does not. See lib/search-brief:
   * a model picks these from the user's profile and their situation, because
   * the code has no way to know whether place matters to a given question.
   *
   *   category  narrows the index to a KIND of page. "VP of finance" against
   *             "linkedin profile" returns people; against nothing it returns
   *             listicles about what a VP of finance does.
   *   userLocation a two-letter country code Exa biases toward.
   *   startPublishedDate everything before this is stale for this question.
   */
  category = null,
  userLocation = null,
  startPublishedDate = null,
  fetchImpl = globalThis.fetch,
  apiKey = process.env.EXA_API_KEY,
} = {}) {
  if (!apiKey) {
    // Loud, because a silent [] here is indistinguishable from "the web had nothing"
    // and produces an ungrounded answer that looks like a model quality problem.
    console.error("[exa] EXA_API_KEY is not set — web search DISABLED, returning no results");
    return [];
  }
  if (typeof fetchImpl !== "function") return [];
  if (typeof query !== "string" || !query.trim()) return [];
  // Ceiling raised from 10 to 25. A "list ten VPs of finance in New York" answer
  // cannot be built out of five pages: after dedupe and after dropping the pages
  // that turn out to be listicles about something else, five pages routinely yields
  // three usable rows. The per-page text cap is what bounds the payload, not the
  // page count.
  const n = Math.max(1, Math.min(Number(numResults) || 5, 25));
  const cap = clampChars(maxCharacters, SNIPPET_CHARS);
  const contents = { text: { maxCharacters: cap } };
  if (typeof highlightQuery === "string" && highlightQuery.trim()) {
    contents.highlights = {
      query: highlightQuery.trim().slice(0, 400),
      numSentences: 3,
      highlightsPerUrl: 3,
    };
  }
  try {
    const resp = await fetchImpl(EXA_SEARCH_URL, {
      method: "POST",
      headers: { "x-api-key": apiKey, "content-type": "application/json" },
      body: JSON.stringify({
        query: query.trim(),
        numResults: n,
        contents,
        ...(Array.isArray(includeDomains) && includeDomains.length > 0
          ? { includeDomains: includeDomains.slice(0, 20) }
          : {}),
        // Each one omitted entirely when absent. Exa rejects an unknown
        // category outright, so a wrong value here would cost the whole search
        // rather than a little precision -- which is why search-brief checks
        // them against its own list before they get this far.
        ...(typeof category === "string" && category.trim() ? { category: category.trim() } : {}),
        ...(typeof userLocation === "string" && /^[A-Za-z]{2}$/.test(userLocation.trim())
          ? { userLocation: userLocation.trim().toUpperCase() }
          : {}),
        ...(typeof startPublishedDate === "string" && startPublishedDate.trim()
          ? { startPublishedDate: startPublishedDate.trim() }
          : {}),
      }),
      signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
    });
    if (!resp || !resp.ok) {
      // THE LAST SILENT PATH, and the one that was actually firing. Every other
      // failure in this file logs; a non-2xx did not, so "the key is set and search
      // returns nothing" produced no explanation anywhere. The status is the whole
      // diagnosis: 401 is a bad or revoked key, 402/403 is billing or quota, 429 is
      // rate limiting, 5xx is Exa. The body is truncated because it can echo the
      // query, and never contains the key.
      const detail = await resp?.text?.().catch(() => "");
      console.error(
        `[exa] search HTTP ${resp?.status}: ${String(detail || "").slice(0, 300)}`,
      );
      return [];
    }
    const data = await resp.json();
    const results = Array.isArray(data?.results) ? data.results : [];
    const mapped = results.map((r) => mapResult(r, cap)).filter((r) => r.url);
    if (mapped.length === 0) {
      console.warn(`[exa] search returned 0 usable results for: ${query.trim().slice(0, 120)}`);
    }
    return mapped;
  } catch (e) {
    // Logged, not swallowed. Timeouts and 401s were both invisible before.
    console.error(`[exa] search FAILED: ${e?.name || ""} ${e?.message || e}`);
    return []; // never throws; chat degrades to the no-web answer
  }
}

/**
 * DEPTH. Read specific pages in full.
 *
 *   exaContents({ urls, maxCharacters, highlightQuery })
 *     -> [{ title, url, text, highlights, publishedDate, author }]
 *
 * The request key is sent as `urls`, and on a 4xx it is retried as `ids`. That is
 * not superstition: Exa's /contents endpoint took `ids` first and `urls` later, both
 * have been accepted at different times, and this cannot be verified from inside a
 * sandbox with no route to api.exa.ai. One extra request on a rejected shape is a
 * cheaper failure than the whole deep-read path silently returning nothing on
 * whichever version the account is pinned to. Both attempts are fail-safe.
 */
export async function exaContents({
  urls,
  maxCharacters = DEEP_CHARS_DEFAULT,
  highlightQuery = null,
  fetchImpl = globalThis.fetch,
  apiKey = process.env.EXA_API_KEY,
} = {}) {
  if (!apiKey) {
    console.error("[exa] EXA_API_KEY is not set — deep page read DISABLED");
    return [];
  }
  if (typeof fetchImpl !== "function") return [];
  const list = (Array.isArray(urls) ? urls : [])
    .filter((u) => typeof u === "string" && /^https?:\/\//i.test(u))
    .slice(0, MAX_DEEP_PAGES);
  if (list.length === 0) return [];

  const cap = clampChars(maxCharacters, DEEP_CHARS_DEFAULT);
  const body = {
    text: { maxCharacters: cap },
    // "fallback" = use Exa's cached copy when it has one, crawl live when it does
    // not. Always-live would be slower on every call for a fresher copy we mostly
    // do not need; never-live would silently skip any page not already indexed,
    // which is exactly the page a user pastes a link to.
    livecrawl: "fallback",
  };
  if (typeof highlightQuery === "string" && highlightQuery.trim()) {
    body.highlights = {
      query: highlightQuery.trim().slice(0, 400),
      numSentences: 4,
      highlightsPerUrl: 5,
    };
  }

  for (const key of ["urls", "ids"]) {
    try {
      const resp = await fetchImpl(EXA_CONTENTS_URL, {
        method: "POST",
        headers: { "x-api-key": apiKey, "content-type": "application/json" },
        body: JSON.stringify({ ...body, [key]: list }),
        signal: AbortSignal.timeout(CONTENTS_TIMEOUT_MS),
      });
      if (!resp) continue;
      if (!resp.ok) {
        // Only a rejected REQUEST SHAPE is worth retrying under the other key. A
        // 401 is a bad key and a 5xx is Exa being down; retrying either is just a
        // second failure and another second of the user's time.
        if (resp.status === 400 || resp.status === 422) continue;
        return [];
      }
      const data = await resp.json();
      const results = Array.isArray(data?.results) ? data.results : [];
      const mapped = results.map((r) => mapResult(r, cap)).filter((r) => r.url);
      // An empty 200 under the first key is a real answer, not a shape problem —
      // the pages had no extractable text. Do not retry it.
      return mapped;
    } catch {
      continue; // network / timeout / bad JSON — try the other shape, then give up
    }
  }
  return [];
}

/**
 * The http(s) URLs a user typed into a message, deduped and in order.
 *
 * This is what turns "read this and tell me X" into an actual read of THAT page
 * rather than a search for words that appear in its address. Trailing punctuation
 * is stripped because a link at the end of a sentence usually has a full stop
 * welded to it, and a URL ending in "." is a 404.
 */
export function urlsInMessage(message, { max = 3 } = {}) {
  const found = String(message || "").match(/https?:\/\/[^\s<>"')\]]+/gi) || [];
  const out = [];
  for (const raw of found) {
    const url = raw.replace(/[.,;:!?]+$/, "");
    if (url.length > 2000) continue; // absurd length: not a link anyone typed
    if (!out.includes(url)) out.push(url);
    if (out.length >= max) break;
  }
  return out;
}

// ── People on the open web ──────────────────────────────────────────────────────

/**
 * Is this question asking for PEOPLE (rather than places, facts or products)?
 *
 * Used to decide whether to also run a LinkedIn-targeted pass. Deliberately narrow:
 * a false positive costs one extra search, a false negative costs the whole feature,
 * and a question about "the best coffee in DUMBO" must not go looking for profiles.
 */
// EVERY ROLE IS PLURALISABLE, and forgetting that broke the whole feature on the most
// natural phrasing there is. `\bvp\b` does not match "VPs" — the trailing "s" means
// there is no word boundary after "vp" — so "list out 5 VPs of finance in nyc", the
// exact thing that was asked, failed the test and never ran a people search.
export const PEOPLE_ROLE_RE =
  /\b(vps?|vice presidents?|heads? of|directors?|chiefs?|c[fteo]os?|cxos?|founders?|co-?founders?|partners?|principals?|managers?|leads?|engineers?|designers?|recruiters?|analysts?|associates?|presidents?|executives?|officers?|scientists?|marketers?|consultants?|advisors?)\b/i;
const PEOPLE_INTENT_RE = /\b(who|people|profiles?|candidates?|contacts?|names?|list|find|top)\b/i;

export function looksLikePeopleSearch(message) {
  const text = String(message || "");
  return PEOPLE_ROLE_RE.test(text) && PEOPLE_INTENT_RE.test(text);
}

/**
 * Parse a LinkedIn profile page title into something a card can render.
 *
 * Exa returns titles in LinkedIn's own format, which is remarkably consistent:
 *   "Jane Doe - VP Finance - Acme Corp | LinkedIn"
 *   "Jane Doe | LinkedIn"
 *   "Jane Doe - Acme Corp | LinkedIn"
 *
 * DELIBERATELY NOT AN LLM CALL. The whole point of these cards is that the user can
 * VERIFY them, so every field has to come from the page itself. A model asked to
 * "extract the name and title" will happily produce a plausible name for a page that
 * did not contain one, which is the exact failure the cards exist to prevent. String
 * splitting cannot hallucinate: if the title does not carry a company, the card simply
 * has no company on it.
 *
 * Returns null when the URL is not an individual profile (/company/, /jobs/, /pulse/,
 * a directory page) or when there is no name to show.
 */
export function parseLinkedInProfile(result) {
  const url = typeof result?.url === "string" ? result.url : "";
  if (!/^https?:\/\/([a-z]{2,3}\.)?linkedin\.com\/in\//i.test(url)) return null;
  const raw = typeof result?.title === "string" ? result.title : "";
  // Drop the trailing " | LinkedIn" (and localised variants that still use the pipe).
  const cleaned = raw.split("|")[0].trim();
  if (!cleaned) return null;
  const parts = cleaned.split(/\s+-\s+/).map((x) => x.trim()).filter(Boolean);
  const name = parts[0] || "";
  // A "name" with no letters, or one long enough to obviously be a sentence, is a
  // directory or article page that slipped through the URL test.
  if (!/[a-z]/i.test(name) || name.length > 60) return null;
  return {
    name,
    title: parts[1] || null,
    company: parts[2] || null,
    url,
    // One line of page text, so the card can show something concrete under the name
    // when LinkedIn's title was just "Name | LinkedIn".
    snippet:
      typeof result?.text === "string" && result.text.trim()
        ? result.text.replace(/\s+/g, " ").trim().slice(0, 160)
        : null,
  };
}

/**
 * Find real, checkable people for a people-shaped question.
 *
 * Restricted to linkedin.com so every row comes back with a profile the user can open
 * and confirm. That restriction is the feature: a general web search for "VPs of
 * finance in NYC" returns listicles and vendor pages, which is how you end up with an
 * answer full of names and nothing to click.
 *
 * Fail-safe like everything else here: [] on any problem, and the caller falls back to
 * its ordinary grounded answer.
 */
export async function exaFindPeople({
  query,
  limit = 10,
  fetchImpl = globalThis.fetch,
  apiKey = process.env.EXA_API_KEY,
} = {}) {
  const results = await exaSearch({
    query: `${String(query || "").trim()} LinkedIn profile`,
    numResults: Math.max(5, Math.min(25, limit * 2)),
    includeDomains: ["linkedin.com"],
    // Profile pages are short and the useful part is the header, so a small text cap
    // keeps this pass cheap even at 20 results.
    maxCharacters: 900,
    highlightQuery: query,
    fetchImpl,
    apiKey,
  });
  const seen = new Set();
  const people = [];
  // NOT FIVE PEOPLE WITH THE SAME SURNAME.
  //
  // A question about hardware engineers came back as five profiles all named
  // Patel, and the user's reaction was the right one: "there should be no bias
  // in the answers... maybe one or two is fine, but all five is a little weird."
  //
  // The cause that day was upstream (a corrupted transcript put a contact's name
  // INTO the query -- see voice-common-words.js), and this is the guard that
  // would have contained it: a result set that collapses onto one surname is a
  // degenerate answer to a question about a ROLE, whatever caused it. Exa
  // returns them in relevance order, so keeping the first two of a surname keeps
  // the best of them and lets the rest of the list be other people.
  //
  // IT NEVER FIRES WHEN THE SURNAME WAS ASKED FOR. "other people at Patel
  // Industries", "engineers like Meet Patel" -- if the name is in the question,
  // the cap is off for that name, because then it is the subject rather than an
  // artefact.
  const askedFor = String(query || "").toLowerCase();
  const MAX_PER_SURNAME = 2;
  const surnameCount = new Map();
  const surnameOf = (name) => {
    const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
    return parts.length > 1 ? parts[parts.length - 1].toLowerCase().replace(/[^a-z]/g, "") : "";
  };
  for (const r of results) {
    const p = parseLinkedInProfile(r);
    if (!p) continue;
    // One card per profile URL, and one per person name, so the same human indexed
    // under two URLs does not appear twice.
    const key = p.url.toLowerCase().replace(/\/+$/, "");
    const nameKey = p.name.toLowerCase();
    if (seen.has(key) || seen.has(nameKey)) continue;
    const surname = surnameOf(p.name);
    if (surname && !askedFor.includes(surname)) {
      const n = surnameCount.get(surname) ?? 0;
      if (n >= MAX_PER_SURNAME) {
        console.warn(
          `[exa] skipping a ${surname} profile: already ${n} of them and the ` +
            `question did not ask for that name`,
        );
        continue;
      }
      surnameCount.set(surname, n + 1);
    }
    seen.add(key);
    seen.add(nameKey);
    people.push(p);
    if (people.length >= limit) break;
  }
  if (people.length === 0 && results.length > 0) {
    console.warn(`[exa] people search matched ${results.length} pages but no /in/ profiles`);
  }
  return people;
}
