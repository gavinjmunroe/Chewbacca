/**
 * THE LEGAL PAGES.
 *
 * These look like the least interesting routes in the service and they are the
 * two whose failure costs the most: the privacy URL is in the App Store listing
 * metadata, so a 404 or a login wall there is a rejection before a reviewer
 * opens the app, and the terms link is inside a shipped build where a broken
 * link cannot be fixed without another release.
 *
 * What is pinned is therefore not the prose. It is that the pages exist, are
 * reachable with no credentials, and still contain the specific clauses that
 * are there for a reason -- the Guideline 1.2 no-tolerance sentence above all,
 * which is the one a later tidy-up of the terms would drop without noticing.
 *
 * Run with:  node --test src/routes/legal.test.js
 */
import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";

import { registerLegalRoutes } from "./legal.js";

async function build() {
  const app = Fastify({ logger: false });
  registerLegalRoutes(app);
  return app;
}

test("BOTH DOCUMENTS SERVE WITHOUT A SESSION", async () => {
  // A reviewer reads the privacy policy from the store listing, before an
  // account exists. A policy behind a login is not a published policy.
  const app = await build();
  for (const url of ["/legal", "/legal/privacy", "/legal/terms"]) {
    const res = await app.inject({ method: "GET", url });
    assert.equal(res.statusCode, 200, url);
    assert.match(res.headers["content-type"], /text\/html/, url);
    assert.match(res.headers["content-type"], /charset=utf-8/, `${url} would render mojibake`);
    assert.ok(res.body.length > 200, `${url} is a stub`);
  }
  await app.close();
});

test("THE NO-TOLERANCE CLAUSE IS IN THE TERMS", async () => {
  /**
   * Guideline 1.2 requires terms where the user agrees there is no tolerance
   * for objectionable content or abusive users. It is the single sentence that
   * makes this document necessary rather than a link to Apple's standard EULA,
   * and it is the first thing a rewrite for readability would soften.
   */
  const app = await build();
  const body = (await app.inject({ method: "GET", url: "/legal/terms" })).body;
  assert.match(body, /no tolerance for objectionable content or abusive users/i);
  assert.match(body, /\bblock\b/i, "the terms do not mention blocking");
  assert.match(body, /\breport\b/i, "the terms do not mention reporting");
  assert.match(body, /24 hours/i, "no stated review window");
  await app.close();
});

test("the privacy policy says the things a store listing is checked against", async () => {
  const app = await build();
  const body = (await app.inject({ method: "GET", url: "/legal/privacy" })).body;
  // Each of these is a question App Store Connect's privacy questionnaire asks
  // and a reviewer spot-checks against the page.
  assert.match(body, /do not sell your personal information/i);
  assert.match(body, /Delete your account/i, "no stated deletion path");
  assert.match(body, /contacts/i);
  assert.match(body, /mailto:/, "no contact address");
  await app.close();
});

test("NO EXTERNAL REQUESTS, because a policy page must render behind anything", async () => {
  /**
   * A stylesheet or font from a CDN turns a legal document into a page that
   * sometimes renders. Reviewers sit behind proxies; users open these links on
   * bad connections.
   */
  const app = await build();
  for (const url of ["/legal", "/legal/privacy", "/legal/terms"]) {
    const body = (await app.inject({ method: "GET", url })).body;
    assert.ok(!/<script/i.test(body), `${url} runs script`);
    assert.ok(!/https?:\/\/(?!www\.w3\.org)/i.test(body.replace(/mailto:[^"]+/g, "")), `${url} loads something remote`);
  }
  await app.close();
});

test("the index links to both, and both are cacheable", async () => {
  const app = await build();
  const index = await app.inject({ method: "GET", url: "/legal" });
  assert.match(index.body, /href="\/legal\/privacy"/);
  assert.match(index.body, /href="\/legal\/terms"/);
  // Static documents fetched by crawlers and link previews. no-store here would
  // mean every preview of a shared link hits the service.
  assert.match(index.headers["cache-control"], /max-age=\d+/);
  assert.equal(index.headers["x-frame-options"], "DENY");
  assert.equal(index.headers["x-content-type-options"], "nosniff");
  await app.close();
});
