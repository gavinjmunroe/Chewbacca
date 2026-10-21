/**
 * THE PRIVACY POLICY AND TERMS, AT A URL THAT WILL NOT MOVE.
 *
 *   GET /legal/privacy
 *   GET /legal/terms
 *   GET /legal            both, linked
 *
 * App Store Connect wants a privacy policy URL in the listing metadata, the App
 * Store page shows it before anybody downloads anything, and Guideline 1.2 wants
 * terms a user with an account can reach from inside the app. All three are the
 * same two documents, so they are served from the service that is already
 * deployed rather than from a marketing site that does not exist yet.
 *
 * UNAUTHENTICATED, AND THAT IS THE REQUIREMENT. Apple's reviewer opens the
 * privacy URL from the listing before signing in, and a person deciding whether
 * to install has no account at all. A policy behind a login is not a published
 * policy.
 *
 * PUBLIC AND CACHEABLE, unlike the /u/:username page next door -- that one is
 * no-store because it redirects into a custom scheme and a stale copy is
 * useless. This is a static document, it is fetched by link previews and
 * reviewers and crawlers, and an hour of cache is the difference between a page
 * that loads and one that waits on a cold database connection it never uses.
 */

import { PRIVACY_HTML, TERMS_HTML, SUPPORT_HTML } from "../lib/legal-docs.js";

const CACHE = "public, max-age=3600";

/**
 * A document response.
 *
 * The Content-Type carries the charset explicitly: the documents contain typographic
 * characters, and a browser guessing latin-1 renders them as mojibake in the middle
 * of a legal page.
 */
function send(reply, html) {
  return reply
    .code(200)
    .header("content-type", "text/html; charset=utf-8")
    .header("cache-control", CACHE)
    // A policy page has no reason to be framed by anybody, and the App Store
    // listing links to it directly.
    .header("x-frame-options", "DENY")
    .header("x-content-type-options", "nosniff")
    .send(html);
}

export function registerLegalRoutes(app) {
  app.get("/support", async (_request, reply) => send(reply, SUPPORT_HTML));
  app.get("/legal/privacy", async (_request, reply) => send(reply, PRIVACY_HTML));
  app.get("/legal/terms", async (_request, reply) => send(reply, TERMS_HTML));

  /**
   * The bare path, because somebody will trim the URL back to it and a 404 there
   * reads as "these documents are not really hosted here".
   */
  app.get("/legal", async (_request, reply) =>
    send(
      reply,
      `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Legal — Amber</title>
<style>:root{color-scheme:light dark}body{margin:0 auto;padding:48px 20px;max-width:44rem;
font:16px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;
color:#1c1a17;background:#fdfcfa}
@media(prefers-color-scheme:dark){body{color:#ece8e2;background:#16150f}}
h1{font-size:1.6rem;margin:0 0 1em}li{margin:.5em 0}a{color:inherit}</style>
</head><body><h1>Amber</h1><ul>
<li><a href="/legal/privacy">Privacy Policy</a></li>
<li><a href="/legal/terms">Terms of Service</a></li>
</ul></body></html>`,
    ),
  );
}

export default registerLegalRoutes;
