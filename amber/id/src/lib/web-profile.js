/**
 * Read a person's public profile page and pull out the fields a contact card
 * actually has slots for.
 *
 * WHY THIS EXISTS. Saving someone found in web search used to record their
 * profile URL as PROVENANCE only — a contact_sources row saying "came from the
 * web". The contacts table has had linkedin_url, website, twitter_url,
 * github_url, emails, phone_primary, company, title, city, location and
 * avatar_url the whole time, and the person card reads linkedin_url. Nothing
 * wrote it, so a stranger you saved had a name and nothing else.
 *
 * TWO PASSES, and the split matters:
 *   1. webUrlFields()  — PURE, no network. The URL you saved them from IS a
 *      field: a linkedin.com link is their LinkedIn, anything else is their
 *      website. This is written synchronously on save, so the link is on the
 *      card the instant it exists, even with no API keys and no network.
 *   2. extractProfileFields() — reads the page and asks a model for the rest.
 *      Runs in the background; may find nothing; can never break the save.
 *
 * WHAT IT WILL AND WILL NOT FIND. Public LinkedIn rarely exposes an email or a
 * phone, so those two are usually null from a LinkedIn save and often present
 * from a personal site, a firm bio, or a conference page. Everything asserted
 * here comes from the page text — the model is told to return null rather than
 * infer, and every value is then re-validated locally, because "plausible" is
 * not the same as "on the page".
 *
 * A generic company inbox (info@, press@) is NOT a person's email. Those are
 * rejected as a field and kept as an extra note instead, so the information
 * survives without a wrong value landing in the email column.
 */

import { exaContents } from "./exa-search.js";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
// Extraction from supplied text is a reading task, not a reasoning one, and it
// runs once per saved contact. Haiku is the right cost here.
const MODEL = process.env.WEB_PROFILE_MODEL || "claude-haiku-4-5-20251001";
const EXTRACT_TIMEOUT_MS = 15000;
// Enough of a profile to cover the headline, the current role and the about
// section. Past that it is job history we capture elsewhere.
const PAGE_CHARS = 9000;
const MAX_EXTRAS = 6;

/** Placeholders a model returns instead of admitting it found nothing. */
const NOT_A_VALUE_RE =
  /^(n\/?a|na|none|null|nil|unknown|undefined|not (found|available|listed|specified|provided|public)|no(t)? (data|info(rmation)?)|-{1,2}|—|\?+)$/i;

export function cleanText(value, max = 200) {
  if (typeof value !== "string") return null;
  const s = value.replace(/\s+/g, " ").trim();
  if (!s || NOT_A_VALUE_RE.test(s)) return null;
  return s.length > max ? s.slice(0, max).trimEnd() : s;
}

const EMAIL_RE = /^[^\s@,;:<>()[\]]+@[^\s@,;:<>()[\]]+\.[a-z]{2,}$/i;
// Not this person's address: a documentation placeholder, a social network's own
// domain (scraped from a share link), or a role inbox that belongs to a company.
const EMAIL_REJECT_RE =
  /(^|@)(example|test|domain|email|yourcompany)\.(com|org|net)$|@(linkedin|twitter|x|facebook|instagram|github|gravatar)\.com$|^(no-?reply|do-?not-?reply|postmaster|mailer-daemon|support|info|contact|hello|hi|team|sales|press|media|admin|webmaster|careers|jobs|recruiting|privacy|legal|abuse|billing|help)@/i;

export function cleanEmail(value) {
  const s = cleanText(value, 160);
  if (!s) return null;
  const e = s.toLowerCase();
  if (!EMAIL_RE.test(e)) return null;
  if (EMAIL_REJECT_RE.test(e)) return null;
  return e;
}

export function cleanPhone(value) {
  const s = cleanText(value, 40);
  if (!s) return null;
  const digits = s.replace(/\D/g, "");
  // Shorter than 10 is an extension or a year; longer than 15 breaks E.164.
  if (digits.length < 10 || digits.length > 15) return null;
  // A repeated or sequential digit run is a form placeholder, not a number.
  if (/^(\d)\1+$/.test(digits) || digits.startsWith("1234567890")) return null;
  return s;
}

/**
 * Which contact column a URL belongs in. Returns null for anything that is not
 * an http(s) URL, so a bare "linkedin.com/in/x" never becomes a stored link
 * that cannot be opened.
 */
export function classifyUrl(url) {
  if (typeof url !== "string") return null;
  let host;
  try {
    const u = new URL(url.trim());
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    host = u.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
  const is = (d) => host === d || host.endsWith(`.${d}`);
  if (is("linkedin.com")) return "linkedin_url";
  if (is("twitter.com") || is("x.com")) return "twitter_url";
  if (is("github.com")) return "github_url";
  // Search engines, aggregators and social feeds are not "their website".
  if (
    is("google.com") ||
    is("bing.com") ||
    is("duckduckgo.com") ||
    is("facebook.com") ||
    is("instagram.com") ||
    is("tiktok.com") ||
    is("youtube.com") ||
    is("reddit.com")
  ) {
    return null;
  }
  return "website";
}

/**
 * The link columns implied by a set of URLs, first URL winning each slot.
 * `primary` is the URL the contact was saved from and is considered first, so
 * the page you actually looked at is the one that lands on the card.
 *
 *   webUrlFields("https://www.linkedin.com/in/x", ["https://x.dev"])
 *     -> { linkedin_url: "https://www.linkedin.com/in/x", website: "https://x.dev" }
 */
export function webUrlFields(primary, others = []) {
  const out = {};
  const all = [primary, ...(Array.isArray(others) ? others : [])];
  for (const raw of all) {
    if (typeof raw !== "string") continue;
    const url = raw.trim();
    if (url.length > 500) continue;
    const slot = classifyUrl(url);
    if (!slot || out[slot]) continue;
    out[slot] = url;
  }
  return out;
}

/**
 * Keep only the leftovers worth writing down: short, factual, and not already
 * said by a field we are storing. Anything that merely repeats the title, the
 * company or another extra is dropped, so the note is not the card again.
 */
export function pickExtras(raw, core = {}) {
  const said = Object.values(core)
    .filter((v) => typeof v === "string" && v.trim())
    .map((v) => v.toLowerCase());
  const out = [];
  for (const item of Array.isArray(raw) ? raw : []) {
    const s = cleanText(item, 240);
    if (!s) continue;
    const lower = s.toLowerCase();
    if (said.some((v) => lower === v || (v.length > 6 && lower.includes(v) && lower.length < v.length + 12))) continue;
    if (out.some((prev) => prev.toLowerCase() === lower)) continue;
    out.push(s);
    if (out.length >= MAX_EXTRAS) break;
  }
  return out;
}

/**
 * Shape a model reply into { core, links, extras }. Pure, so every rule above is
 * testable without a network call. Unknown keys are ignored; a value that fails
 * validation becomes null rather than being stored as-is.
 */
export function normalizeExtracted(parsed, { profileUrl } = {}) {
  const p = parsed && typeof parsed === "object" ? parsed : {};
  const core = {
    fullName: cleanText(p.fullName, 200),
    title: cleanText(p.title, 200),
    company: cleanText(p.company, 200),
    city: cleanText(p.city, 120),
    email: cleanEmail(p.email),
    phone: cleanPhone(p.phone),
  };
  const links = webUrlFields(profileUrl, p.links);
  // A rejected email is still information — it just is not THIS person's
  // address, so it goes to the notes rather than the column.
  const rejectedEmail =
    !core.email && typeof p.email === "string" && EMAIL_RE.test(p.email.trim().toLowerCase())
      ? `Listed contact address: ${p.email.trim()}`
      : null;
  const extras = pickExtras(
    [...(Array.isArray(p.extras) ? p.extras : []), ...(rejectedEmail ? [rejectedEmail] : [])],
    core,
  );
  return { core, links, extras };
}

const SYSTEM = [
  "You read one public web page about one person and report ONLY what the page states.",
  "Return STRICT JSON, no prose, no code fence, with exactly these keys:",
  '{"fullName":string|null,"title":string|null,"company":string|null,"city":string|null,',
  '"email":string|null,"phone":string|null,"links":string[],"extras":string[]}',
  "",
  "RULES.",
  "null means the page does not say. Never infer, never guess from a name, a company",
  "or a job title. A city is only a city the page names for THIS person — not the",
  "company headquarters unless the page says that is where they are.",
  "title is their CURRENT role. company is their CURRENT employer.",
  "email and phone: only an address or number printed on the page for this person.",
  "links: absolute http(s) URLs the page gives for this person — personal site,",
  "LinkedIn, GitHub, X. Never a link to a company page, an article, or a login.",
  "extras: up to 6 short factual statements the other fields do not already cover —",
  "previous roles, education, a board seat, a focus area, a language. One clause each.",
  "No adjectives of praise, no summary of how impressive they are, nothing you cannot",
  "point at in the text.",
].join("\n");

/**
 * The page text for a profile URL, via Exa (cached copy, live crawl as
 * fallback). Returns "" when there is nothing readable — LinkedIn blocks most
 * crawlers, so an empty read is normal and is logged, never treated as an error.
 */
export async function fetchProfileText({ url, log = null, contents = exaContents } = {}) {
  if (typeof url !== "string" || !/^https?:\/\//i.test(url)) return "";
  const results = await contents({ urls: [url], maxCharacters: PAGE_CHARS }).catch((err) => {
    log?.warn?.({ err: err?.message, url }, "[web-profile] page read threw");
    return [];
  });
  const text = String(results?.[0]?.text || "").trim();
  if (!text) log?.info?.({ url }, "[web-profile] page read returned no text");
  return text;
}

/**
 * Ask the model for the fields, from the page text plus whatever the search
 * card already showed. Returns null — never throws, never a partial object —
 * when there is no key, no material, or no parseable reply. Every one of those
 * paths logs, so "the card is still empty" is always answerable from the logs.
 */
export async function extractProfileFields({
  profileUrl,
  name = null,
  pageText = "",
  snippet = null,
  log = null,
  fetchImpl = globalThis.fetch,
  apiKey = process.env.ANTHROPIC_API_KEY,
} = {}) {
  if (!apiKey) {
    log?.warn?.("[web-profile] ANTHROPIC_API_KEY is not set — field extraction DISABLED");
    return null;
  }
  const material = [
    name ? `Reported name: ${name}` : null,
    profileUrl ? `Page URL: ${profileUrl}` : null,
    snippet ? `Search snippet: ${String(snippet).slice(0, 600)}` : null,
    pageText ? `Page text:\n${String(pageText).slice(0, PAGE_CHARS)}` : null,
  ]
    .filter(Boolean)
    .join("\n\n");
  // A URL and a name alone are not material to read. Bailing here is what stops
  // a blocked page from turning into a confidently invented profile.
  if (!pageText && !snippet) {
    log?.info?.({ profileUrl }, "[web-profile] nothing readable to extract from — skipped");
    return null;
  }
  let resp;
  try {
    resp = await fetchImpl(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 900,
        temperature: 0,
        system: SYSTEM,
        messages: [{ role: "user", content: `${material}\n\nJSON:` }],
      }),
      signal: AbortSignal.timeout(EXTRACT_TIMEOUT_MS),
    });
  } catch (err) {
    log?.warn?.({ err: err?.message, profileUrl }, "[web-profile] extraction call failed");
    return null;
  }
  if (!resp?.ok) {
    log?.warn?.({ status: resp?.status, profileUrl }, "[web-profile] extraction HTTP not ok");
    return null;
  }
  let parsed;
  try {
    const raw = String((await resp.json())?.content?.[0]?.text || "").trim();
    const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start < 0 || end <= start) {
      log?.warn?.({ profileUrl }, "[web-profile] extraction reply had no JSON object");
      return null;
    }
    parsed = JSON.parse(cleaned.slice(start, end + 1));
  } catch (err) {
    log?.warn?.({ err: err?.message, profileUrl }, "[web-profile] extraction reply unparseable");
    return null;
  }
  return normalizeExtracted(parsed, { profileUrl });
}
