/**
 * Social-link extraction, dedupe, canonicalization, and verification for the
 * ENRICH function (spec §2, item 170).
 *
 * The in-path signal extractor (people-rank-signals.js → extractSignals) does a
 * FAST first-match classification of URLs into { linkedin, twitter, github }.
 * That is good enough to feed the ranking signal, but it is NOT clean enough to
 * render on a contact card: it can carry tracking query params, mixed casing,
 * http vs https, duplicate handles across twitter.com / x.com, and it has no
 * notion of a personal website.
 *
 * This module is the contact-card-grade pass. Given the raw enrichment sources
 * plus whatever the fast signal extractor already found, it produces a single,
 * canonical, verified set of links:
 *
 *   { linkedin?, twitter?, github?, website? }
 *
 * Every value is a canonical https URL with tracking params stripped, hosts
 * normalized (www. dropped, twitter.com → x.com), at most one entry per slot,
 * and verified to be a structurally valid public URL. Pure + synchronous +
 * never throws so it is trivial to unit-test and safe on the request path.
 */

// Query params that are pure tracking noise, stripped from every canonical URL.
const TRACKING_PARAMS = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "fbclid",
  "gclid",
  "mc_cid",
  "mc_eid",
  "igshid",
  "ref",
  "ref_src",
  "ref_url",
  "source",
  "trk",
  "originalSubdomain",
]);

// Hosts that are never a person's own "website", social, aggregators, search,
// and content farms. Kept small and specific; anything else with a real path is
// a plausible personal/company site.
const NON_WEBSITE_HOSTS = [
  "linkedin.com",
  "twitter.com",
  "x.com",
  "github.com",
  "facebook.com",
  "instagram.com",
  "youtube.com",
  "tiktok.com",
  "medium.com",
  "substack.com",
  "wikipedia.org",
  "crunchbase.com",
  "google.com",
  "bing.com",
  "reddit.com",
  "pinterest.com",
  "amazon.com",
];

/** Lowercased hostname with a leading www. removed, or null for a bad URL. */
function hostOf(parsed) {
  if (!parsed) return null;
  const h = parsed.hostname.toLowerCase();
  return h.startsWith("www.") ? h.slice(4) : h;
}

/** Parse a string into a URL, only accepting http(s). Returns the URL or null. */
function parseHttpUrl(raw) {
  if (typeof raw !== "string" || !raw.trim()) return null;
  let parsed;
  try {
    parsed = new URL(raw.trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  // A real public host has at least one dot (rejects "localhost", bare hosts).
  if (!parsed.hostname.includes(".")) return null;
  return parsed;
}

/**
 * Canonicalize ANY http(s) URL: force https, drop www., strip tracking params,
 * sort the surviving params for stable equality, drop the hash, and trim a
 * trailing slash on non-root paths. Returns the canonical string or null.
 */
export function canonicalizeUrl(raw) {
  const parsed = parseHttpUrl(raw);
  if (!parsed) return null;

  parsed.protocol = "https:";
  parsed.hostname = hostOf(parsed);
  parsed.hash = "";
  // Trim a trailing slash on a non-root PATH for stable dedupe, before the query
  // is reattached ("/in/p/?x=1" and "/in/p?x=1" must canonicalize the same).
  if (parsed.pathname.length > 1 && parsed.pathname.endsWith("/")) {
    parsed.pathname = parsed.pathname.slice(0, -1);
  }

  // Strip tracking params, keep the rest in a stable (sorted) order.
  const kept = [];
  for (const [k, v] of parsed.searchParams.entries()) {
    if (!TRACKING_PARAMS.has(k)) kept.push([k, v]);
  }
  kept.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  parsed.search = "";
  for (const [k, v] of kept) parsed.searchParams.append(k, v);

  return parsed.toString();
}

/**
 * Classify a canonical URL into a social slot, returning [slot, canonicalUrl]
 * or null. Twitter and x.com both canonicalize to the "twitter" slot with an
 * x.com host so the two never produce duplicate entries.
 */
export function classifyLink(raw) {
  const canon = canonicalizeUrl(raw);
  if (!canon) return null;
  const parsed = new URL(canon);
  const host = parsed.hostname;
  const path = parsed.pathname;

  if (host.endsWith("linkedin.com")) {
    // Only an actual profile/company path counts (drops linkedin.com/feed, etc.).
    if (/^\/(in|pub|company|school)\//i.test(path)) return ["linkedin", canon];
    return null;
  }
  if (host === "twitter.com" || host === "x.com" || host.endsWith(".x.com")) {
    // Unify on x.com and drop non-handle paths (/home, /search, /i/...).
    if (/^\/[A-Za-z0-9_]{1,15}\/?$/.test(path)) {
      const handle = path.replace(/\//g, "");
      return ["twitter", `https://x.com/${handle}`];
    }
    return null;
  }
  if (host.endsWith("github.com")) {
    if (/^\/[A-Za-z0-9-]+\/?$/.test(path)) return ["github", canon];
    return null;
  }
  return null;
}

/** True when a canonical URL is a plausible personal/company website. */
function isWebsiteCandidate(canon) {
  if (!canon) return false;
  const host = new URL(canon).hostname;
  return !NON_WEBSITE_HOSTS.some(
    (bad) => host === bad || host.endsWith(`.${bad}`),
  );
}

/**
 * Build the canonical, deduped, verified social-link set for a contact card.
 *
 *   extractSocialLinks(sources, prior?) -> { linkedin?, twitter?, github?, website? }
 *
 * `sources` is the enrichment source list ([{ title, url, date }]); `prior` is
 * whatever the fast signal extractor already classified (signals.social_links).
 * Prior values are canonicalized and win the slot (they are the most
 * identity-anchored), then source URLs fill any empty slot. The first valid
 * website candidate (shortest path wins, preferring a bare domain) is attached.
 *
 * Never throws. Returns {} when nothing usable is present.
 */
export function extractSocialLinks(sources, prior = {}) {
  const out = {};

  // 1. Seed from the prior fast-classified links (canonicalized + re-verified).
  for (const slot of ["linkedin", "twitter", "github"]) {
    const hit = classifyLink(prior?.[slot]);
    if (hit && hit[0] === slot && !out[slot]) out[slot] = hit[1];
  }
  if (typeof prior?.website === "string") {
    const canon = canonicalizeUrl(prior.website);
    if (canon && isWebsiteCandidate(canon)) out.website = canon;
  }

  // 2. Fill remaining social slots + collect website candidates from sources.
  const websiteCandidates = [];
  for (const s of Array.isArray(sources) ? sources : []) {
    const url = s?.url;
    const hit = classifyLink(url);
    if (hit) {
      if (!out[hit[0]]) out[hit[0]] = hit[1];
      continue;
    }
    const canon = canonicalizeUrl(url);
    if (canon && isWebsiteCandidate(canon)) websiteCandidates.push(canon);
  }

  // 3. Pick the best website: shortest path (a root domain beats a deep link).
  if (!out.website && websiteCandidates.length) {
    websiteCandidates.sort(
      (a, b) => new URL(a).pathname.length - new URL(b).pathname.length,
    );
    out.website = websiteCandidates[0];
  }

  return out;
}

// ── source credibility ranking (item 174) ─────────────────────────────────────

// Domains we treat as more authoritative when ordering otherwise-equal sources.
// Order-independent membership test; tiers keep the most credible press first.
const CREDIBILITY_TIERS = [
  [
    "sec.gov",
    "reuters.com",
    "bloomberg.com",
    "wsj.com",
    "ft.com",
    "apnews.com",
  ],
  [
    "nytimes.com",
    "forbes.com",
    "techcrunch.com",
    "theinformation.com",
    "axios.com",
  ],
  ["crunchbase.com", "linkedin.com", "businesswire.com", "prnewswire.com"],
];

/** A 0..1 credibility weight for a source URL by its host (0.5 default). */
export function sourceCredibility(url) {
  const parsed = parseHttpUrl(url);
  const host = hostOf(parsed);
  if (!host) return 0;
  for (let tier = 0; tier < CREDIBILITY_TIERS.length; tier++) {
    if (
      CREDIBILITY_TIERS[tier].some((d) => host === d || host.endsWith(`.${d}`))
    ) {
      return 1 - tier * 0.2; // tier 0 -> 1.0, tier 1 -> 0.8, tier 2 -> 0.6
    }
  }
  return 0.5;
}

function sourceDateMs(s) {
  const raw = s?.date || s?.last_updated || null;
  if (!raw) return null;
  const t = Date.parse(raw);
  return Number.isNaN(t) ? null : t;
}

/**
 * Order sources so the freshest, most credible citations show first (item 174).
 * Primary sort: newest date desc (undated sinks below any dated source).
 * Tie-break: credibility desc, then original input order for stability. Pure;
 * returns a NEW array and never mutates the input.
 */
export function rankSources(sources) {
  const list = Array.isArray(sources) ? sources : [];
  return list
    .map((s, i) => ({
      s,
      i,
      ms: sourceDateMs(s),
      cred: sourceCredibility(s?.url),
    }))
    .sort((a, b) => {
      const am = a.ms == null ? -Infinity : a.ms;
      const bm = b.ms == null ? -Infinity : b.ms;
      if (bm !== am) return bm - am;
      if (b.cred !== a.cred) return b.cred - a.cred;
      return a.i - b.i;
    })
    .map(({ s }) => s);
}
