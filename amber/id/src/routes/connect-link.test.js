/**
 * Tests for the public /u/:username share page and the universal-link association
 * file.
 *
 * These run OFFLINE against a real Fastify instance. getPublicProfileByUsername
 * swallows its own errors and returns null when there is no database, so every
 * request here exercises the not-found branch -- which is fine, because the branch
 * that matters for security is the one that reflects attacker-controlled input into
 * HTML, and that runs identically either way.
 *
 * What is actually being pinned down:
 *   - the page can never be an XSS vector, however hostile the username
 *   - the deep link the page hands to iOS is exactly `amber://connect?u=<username>`
 *   - the association file claims /u/* and NOTHING else
 *   - a share link is never cached by a link-preview proxy
 */

import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { registerConnectLinkRoutes } from "./connect-link.js";

async function build() {
  const app = Fastify({ logger: false });
  // The route declares a rateLimit config; without the plugin registered Fastify
  // ignores unknown config keys, so this stays a pure route test.
  registerConnectLinkRoutes(app);
  await app.ready();
  return app;
}

test("apple-app-site-association claims /u/* and only /u/*", async () => {
  const app = await build();
  for (const url of [
    "/.well-known/apple-app-site-association",
    "/apple-app-site-association",
  ]) {
    const res = await app.inject({ method: "GET", url });
    assert.equal(res.statusCode, 200, `${url} should be served`);
    assert.match(res.headers["content-type"], /application\/json/);
    const body = JSON.parse(res.body);
    const details = body?.applinks?.details;
    assert.ok(Array.isArray(details) && details.length > 0, "needs at least one appID");
    for (const d of details) {
      // A team-id-dot-bundle-id shape. A malformed appID makes universal links fail
      // silently, with no error surfaced anywhere, so it is worth asserting.
      assert.match(d.appID, /^[A-Z0-9]{10}\..+/, `appID looks wrong: ${d.appID}`);
      // Claiming "/*" would swallow every API call made from a webview into an app
      // launch. This must stay narrow.
      assert.deepEqual(d.paths, ["/u/*"]);
    }
  }
  await app.close();
});

test("a hostile username cannot inject markup or script", async () => {
  const app = await build();
  const hostile = [
    "<script>alert(1)</script>",
    '"><img src=x onerror=alert(1)>',
    "');alert(1);//",
    "sagar<svg/onload=alert(1)>",
  ];
  for (const u of hostile) {
    const res = await app.inject({ method: "GET", url: `/u/${encodeURIComponent(u)}` });
    // Rejected by the allowlist before it ever reaches SQL or the page.
    assert.equal(res.statusCode, 404, `should reject: ${u}`);
    // Nothing the caller sent may appear as live markup. The page has its own
    // <script> block, so assert on the injected payloads specifically.
    assert.ok(!res.body.includes("alert(1)"), `payload leaked for: ${u}`);
    assert.ok(!res.body.includes("<img"), `raw <img> leaked for: ${u}`);
    assert.ok(!res.body.includes("<svg"), `raw <svg> leaked for: ${u}`);
    assert.ok(!res.body.includes("onerror="), `event handler leaked for: ${u}`);
  }
  await app.close();
});

test("an invalid username gets no deep link, so a bad link cannot open the app", async () => {
  const app = await build();
  const res = await app.inject({ method: "GET", url: "/u/" + "a".repeat(41) });
  assert.equal(res.statusCode, 404);
  assert.ok(
    !res.body.includes("amber://"),
    "a username that failed validation must not be handed to the app",
  );
  await app.close();
});

test("a valid username is handed to the app as amber://connect?u=<name>", async () => {
  const app = await build();
  // No database here, so this is the not-found branch -- which still offers the
  // handoff on purpose: if the visitor DOES have the app, opening it is more useful
  // than a dead end, and the app reports the real reason.
  const res = await app.inject({ method: "GET", url: "/u/sagar" });
  assert.equal(res.statusCode, 404);
  assert.ok(
    res.body.includes("amber://connect?u=sagar"),
    "the page must carry the exact deep link the app parses",
  );
  await app.close();
});

test("a leading @ is accepted and stripped", async () => {
  const app = await build();
  // The shared URL is built as `${base}/@${username}`, so the @ arrives as part of
  // the path segment and must not be treated as part of the name.
  // Both the percent-encoded form and the raw form, because Share.share hands the URL
  // to whatever app the user picked and there is no guarantee it encodes the @.
  for (const url of ["/u/%40sagar", "/u/@sagar"]) {
    const res = await app.inject({ method: "GET", url });
    assert.ok(
      res.body.includes("amber://connect?u=sagar"),
      `the @ must be stripped before the username is used (${url})`,
    );
    assert.ok(
      !res.body.includes("u=%40sagar"),
      `the @ must not survive into the deep link (${url})`,
    );
  }
  await app.close();
});

test("usernames with legal punctuation survive intact", async () => {
  const app = await build();
  for (const u of ["sagar.tiwari", "sagar_t", "sagar-t", "Sagar99"]) {
    const res = await app.inject({ method: "GET", url: `/u/${u}` });
    assert.ok(
      res.body.includes(`amber://connect?u=${encodeURIComponent(u)}`),
      `legal username was mangled or rejected: ${u}`,
    );
  }
  await app.close();
});

test("the page is never cached", async () => {
  const app = await build();
  const res = await app.inject({ method: "GET", url: "/u/sagar" });
  // A link-preview proxy caching a redirect into a custom scheme would serve a dead
  // page to the next person who opened the same link.
  assert.match(res.headers["cache-control"], /no-store/);
  assert.match(res.headers["content-type"], /text\/html/);
  await app.close();
});
