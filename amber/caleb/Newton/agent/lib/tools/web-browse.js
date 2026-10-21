/**
 * web-browse.js — Fetch rendered web pages as clean markdown + take screenshots.
 *
 * Uses Firecrawl (firecrawl.dev) which:
 *   - Runs a headless Chromium per request (JS-rendered SPAs work)
 *   - Strips nav/footer/ads → returns content-focused markdown
 *   - Returns PNG screenshots
 *   - One API, no local browser install
 *
 * Complements exa_get_contents which uses neural snippet extraction;
 * web_fetch_markdown returns full-fidelity rendered page.
 *
 * Per-user secret: FIRECRAWL_API_KEY via lib/secrets.js.
 * Fallback: process.env.FIRECRAWL_API_KEY during migration.
 *
 * All handlers return { error: "…" } on failure, never throw.
 */

import { getSecret } from "../secrets.js";
import { registerCapability } from "../capabilities.js";

registerCapability("_tools_WebBrowse", [
  "Fetch a URL as plain text — no API key, works for static pages (web_fetch_text)",
  "Fetch JS-rendered web page as clean markdown (web_fetch_markdown)",
  "Capture a full-page screenshot of any URL (web_screenshot)",
]);

/**
 * Lightweight HTML → text. Strips scripts/styles/HTML tags, collapses
 * whitespace, decodes a few common entities. Good enough for static
 * pages, news articles, blog posts — anything that doesn't need a
 * headless browser to render. Falls back to truncated raw body when the
 * stripping produces nothing useful (e.g. JSON / plaintext endpoints).
 */
function htmlToText(html) {
  if (!html || typeof html !== "string") return "";
  // Drop scripts + styles entirely (they contain noise we never want).
  let out = html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ");

  // flaw #47 — preserve link context. Before stripping tags wholesale,
  // rewrite anchor tags as "text [href]" so the URL survives the strip.
  // Without this, "click here" became orphaned and useless. The model
  // (and humans) need to know what was being linked.
  out = out.replace(
    /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
    (_, href, inner) => {
      const innerText = inner
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      if (!innerText) return ` [${href}] `;
      // If the visible text already IS the URL, don't double it.
      if (innerText === href) return ` ${href} `;
      return ` ${innerText} [${href}] `;
    },
  );

  // Strip remaining tags but keep their text content.
  out = out.replace(/<[^>]+>/g, " ");
  // Decode a handful of common HTML entities. We deliberately don't
  // pull in a full entity decoder — these cover ~99% of real content.
  out = out
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
  // Collapse runs of whitespace.
  return out.replace(/\s+/g, " ").trim();
}

function extractTitle(html) {
  if (!html || typeof html !== "string") return null;
  const m = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return m ? m[1].trim() : null;
}

// flaw #46 — find <link rel="canonical"> and <link rel="amphtml"> URLs.
// We surface these in the result; we deliberately do NOT auto-follow
// because that creates loop / cycle risk on misbehaving sites.
function extractLinkRel(html, rel) {
  if (!html || typeof html !== "string") return null;
  // Match both <link rel="canonical" href="..."> and the href-first ordering.
  const re = new RegExp(
    `<link[^>]*\\brel=["']${rel}["'][^>]*\\bhref=["']([^"']+)["']`,
    "i",
  );
  const m1 = html.match(re);
  if (m1) return m1[1].trim();
  const re2 = new RegExp(
    `<link[^>]*\\bhref=["']([^"']+)["'][^>]*\\brel=["']${rel}["']`,
    "i",
  );
  const m2 = html.match(re2);
  return m2 ? m2[1].trim() : null;
}

// flaw #50 — parse OpenGraph + standard meta tags. Returns an object
// with title / description / image / site_name. Each falls back to
// document defaults if its specific meta isn't present.
function extractOpenGraph(html, fallbackTitle) {
  if (!html || typeof html !== "string") return null;
  const meta = (property) => {
    // Try property="og:foo" first (OpenGraph spec uses property=).
    const re1 = new RegExp(
      `<meta[^>]*\\bproperty=["']${property}["'][^>]*\\bcontent=["']([^"']*)["']`,
      "i",
    );
    const m1 = html.match(re1);
    if (m1) return m1[1].trim();
    // Some sites use name= instead of property=.
    const re2 = new RegExp(
      `<meta[^>]*\\bname=["']${property}["'][^>]*\\bcontent=["']([^"']*)["']`,
      "i",
    );
    const m2 = html.match(re2);
    if (m2) return m2[1].trim();
    // Content-first ordering.
    const re3 = new RegExp(
      `<meta[^>]*\\bcontent=["']([^"']*)["'][^>]*\\b(?:property|name)=["']${property}["']`,
      "i",
    );
    const m3 = html.match(re3);
    return m3 ? m3[1].trim() : null;
  };
  const ogTitle = meta("og:title") || fallbackTitle || null;
  const ogDesc = meta("og:description") || meta("description") || null;
  const ogImg = meta("og:image") || null;
  const ogSite = meta("og:site_name") || null;
  if (!ogTitle && !ogDesc && !ogImg && !ogSite) return null;
  return {
    title: ogTitle,
    description: ogDesc,
    image: ogImg,
    site_name: ogSite,
  };
}

// flaw #49 — small LRU cache for URL fetches. 50 entries, 10-minute
// TTL. Same URL fetched twice in 10 minutes returns the cached body so
// the second call doesn't re-hit the network. We key on the full URL
// (no normalization — different query strings are different resources).
const URL_CACHE_LIMIT = 50;
const URL_CACHE_TTL_MS = 10 * 60 * 1000;
const urlCache = new Map(); // url -> { result, at }

function cacheGet(url) {
  const entry = urlCache.get(url);
  if (!entry) return null;
  if (Date.now() - entry.at > URL_CACHE_TTL_MS) {
    urlCache.delete(url);
    return null;
  }
  // Touch for LRU ordering: re-insert to move to end.
  urlCache.delete(url);
  urlCache.set(url, entry);
  return entry.result;
}

function cacheSet(url, result) {
  urlCache.set(url, { result, at: Date.now() });
  while (urlCache.size > URL_CACHE_LIMIT) {
    const oldest = urlCache.keys().next().value;
    urlCache.delete(oldest);
  }
}

/**
 * No-API-key URL fetcher. Uses Node's native fetch with a sane UA, hard
 * timeout, and a 1MB response cap. Returns title + plain-text body,
 * truncated to keep the model context tight. This is the *primary* path
 * for "Medha got sent a link" — Firecrawl is reserved for JS-rendered
 * SPAs where this fetcher can't see the content.
 *
 * flaws #46 / #48 / #49 / #50 — surface canonical/AMP URLs, retry with
 * a longer timeout when the first attempt 8-second-fails, serve an
 * in-memory LRU cache when the same URL is fetched twice in 10 min,
 * and parse OpenGraph + standard meta tags into a `metadata` block.
 */
async function fetchOnce(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        // Identify ourselves honestly. Some sites 403 a default UA.
        "User-Agent":
          "Mozilla/5.0 (compatible; AmberAgent/1.0; +https://amber.ai)",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });
    clearTimeout(timer);
    return { res };
  } catch (err) {
    clearTimeout(timer);
    return { err };
  }
}

async function webFetchText(input) {
  const { url, max_chars } = input || {};
  if (!url || typeof url !== "string") {
    return { error: "url is required" };
  }
  if (!/^https?:\/\//i.test(url)) {
    return { error: "url must start with http:// or https://" };
  }
  const cap = Math.max(
    500,
    Math.min(parseInt(max_chars, 10) || 20_000, 50_000),
  );

  // flaw #49 — cache hit short-circuit. We re-truncate to the caller's
  // requested cap (the cached `text` is uncut) so a cached entry can
  // serve multiple callers with different max_chars.
  const cached = cacheGet(url);
  if (cached) {
    return {
      ...cached,
      text: (cached.text || "").slice(0, cap),
      truncated: (cached.original_length || 0) > cap,
      cache_hit: true,
    };
  }

  // flaw #48 — graceful timeout extension: 8s first, retry once at 15s
  // on AbortError. If the second attempt also times out, surface a
  // structured error with a hint so the model can choose a better path
  // (quoted excerpt, exa_get_contents, etc.).
  let attempt = await fetchOnce(url, 8_000);
  if (attempt.err && attempt.err?.name === "AbortError") {
    console.warn(`[web-fetch] first attempt timed out (8s), retrying ${url}`);
    attempt = await fetchOnce(url, 15_000);
    if (attempt.err && attempt.err?.name === "AbortError") {
      return {
        error: "url_too_slow",
        url,
        hint: "the page is slow — maybe try a quoted excerpt instead",
      };
    }
  }
  if (attempt.err) {
    const msg = String(attempt.err).slice(0, 200);
    return { error: `fetch failed: ${msg}`, url };
  }
  const res = attempt.res;
  const contentType = res.headers.get("content-type") || "";
  if (!res.ok) {
    return { error: `fetch ${res.status} ${url}`, url };
  }
  // Cap the response to ~1MB so a misbehaving server can't OOM us.
  let raw;
  try {
    raw = await res.text();
  } catch (err) {
    return { error: `read body failed: ${err.message?.slice(0, 200)}`, url };
  }
  const body = raw.slice(0, 1_000_000);
  const isHtml = /html|xml/i.test(contentType) || /<html/i.test(body);
  const title = isHtml ? extractTitle(body) : null;
  const text = isHtml ? htmlToText(body) : body;
  const finalUrl = res.url || url;

  // flaw #46 — surface canonical + AMP variants. We don't auto-follow
  // (that risks loops on misbehaving sites); the model can decide
  // whether to re-fetch the canonical if the body is thin.
  let canonical = null;
  let amphtml = null;
  if (isHtml) {
    canonical = extractLinkRel(body, "canonical");
    amphtml = extractLinkRel(body, "amphtml");
    if (canonical === finalUrl) canonical = null;
  }

  // flaw #50 — OpenGraph extraction.
  const metadata = isHtml ? extractOpenGraph(body, title) : null;

  const truncated = text.length > cap;
  const result = {
    url,
    final_url: finalUrl,
    content_type: contentType || null,
    status: res.status,
    title,
    text: text.slice(0, cap),
    truncated,
    original_length: text.length,
    // flaw #46 — non-auto-followed canonical hints
    canonical_url: canonical,
    amphtml_url: amphtml,
    // flaw #50 — OG/meta block (null when no meta tags found)
    metadata,
  };

  // flaw #49 — cache the FULL result (uncut text + meta) so subsequent
  // hits within TTL can re-truncate to a different cap without
  // re-fetching. cache_hit flag is added on read, not stored.
  cacheSet(url, {
    ...result,
    text, // store the uncut text
    truncated: false, // cache stores the canonical/full version
  });

  return result;
}

const FC_SCRAPE = "https://api.firecrawl.dev/v1/scrape";
const DEFAULT_TIMEOUT_MS = 45_000;

async function getKey(tenant) {
  return getSecret(tenant, "FIRECRAWL_API_KEY", {
    fallbackEnv: "FIRECRAWL_API_KEY",
  });
}

async function firecrawlScrape(tenant, body) {
  const key = await getKey(tenant);
  if (!key) return { error: "FIRECRAWL_API_KEY not configured for tenant" };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const res = await fetch(FC_SCRAPE, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      return { error: `firecrawl ${res.status}: ${t.slice(0, 300)}` };
    }
    const data = await res.json();
    if (!data.success) {
      return { error: data.error || "firecrawl returned success=false" };
    }
    return { data: data.data };
  } catch (err) {
    clearTimeout(timer);
    return { error: `web-browse failed: ${String(err).slice(0, 200)}` };
  }
}

// ── Tool handlers ────────────────────────────────────────────────────────────

async function webFetchMarkdown(input, tenant) {
  const { url, wait_for_selector } = input || {};
  if (!url) return { error: "url is required" };

  const body = {
    url,
    formats: ["markdown"],
    onlyMainContent: true,
  };
  if (wait_for_selector) {
    body.waitFor = 3000;
  }
  const result = await firecrawlScrape(tenant, body);
  if (result.error) return result;

  const markdown = result.data?.markdown || "";
  return {
    url,
    title: result.data?.metadata?.title || null,
    markdown: markdown.slice(0, 50_000), // hard cap
    truncated: markdown.length > 50_000,
    source_url: result.data?.metadata?.sourceURL || url,
  };
}

async function webScreenshot(input, tenant) {
  const { url, full_page } = input || {};
  if (!url) return { error: "url is required" };

  const body = {
    url,
    formats: [full_page === false ? "screenshot" : "screenshot@fullPage"],
  };
  const result = await firecrawlScrape(tenant, body);
  if (result.error) return result;

  const screenshotUrl = result.data?.screenshot || null;
  if (!screenshotUrl) return { error: "no screenshot returned" };
  return {
    url,
    screenshot_url: screenshotUrl,
    title: result.data?.metadata?.title || null,
  };
}

// ── Tool schemas ─────────────────────────────────────────────────────────────

export const WEB_BROWSE_TOOLS = [
  {
    name: "web_fetch_text",
    description:
      "Fetch a URL with native HTTP and return its plain text body + page title. No API key needed, no headless browser — fast and works for static pages, news articles, blog posts, READMEs, raw text/JSON endpoints. THIS is your default tool when someone texts you a link and you need to know what's on the other side. Use web_fetch_markdown only if this returns empty text (e.g. JS-rendered SPA).",
    input_schema: {
      type: "object",
      properties: {
        url: { type: "string", description: "URL to fetch (http or https)." },
        max_chars: {
          type: "integer",
          description: "Cap on returned text length. Default 20000, max 50000.",
        },
      },
      required: ["url"],
    },
  },
  {
    name: "web_fetch_markdown",
    description:
      "Fetch a web page rendered by a headless browser (handles JavaScript SPAs, lazy-loaded content) and return it as clean markdown with nav/footer/ads stripped out. Use this when a simple HTTP fetch won't work or you need readable content from a modern web app.",
    input_schema: {
      type: "object",
      properties: {
        url: { type: "string", description: "URL to fetch." },
        wait_for_selector: {
          type: "boolean",
          description:
            "Set true to wait up to 3s for dynamic content to appear before extracting.",
        },
      },
      required: ["url"],
    },
  },
  {
    name: "web_screenshot",
    description:
      "Capture a screenshot of any URL (full-page by default). Returns a hosted PNG URL that can be shared or attached.",
    input_schema: {
      type: "object",
      properties: {
        url: { type: "string", description: "URL to screenshot." },
        full_page: {
          type: "boolean",
          description: "If false, only capture viewport. Default true.",
        },
      },
      required: ["url"],
    },
  },
];

export async function executeWebBrowseTool(toolName, input, ctx = {}) {
  const tenant = ctx.tenant || null;
  switch (toolName) {
    case "web_fetch_text":
      return webFetchText(input);
    case "web_fetch_markdown":
      return webFetchMarkdown(input, tenant);
    case "web_screenshot":
      return webScreenshot(input, tenant);
    default:
      return { error: `unknown web-browse tool: ${toolName}` };
  }
}
