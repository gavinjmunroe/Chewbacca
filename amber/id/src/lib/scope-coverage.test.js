/**
 * EVERY ROUTE A BROWSER CAN REACH IS IN A SCOPE, OR IS NAMED HERE AS NOT.
 *
 * THE BUG THIS EXISTS TO CATCH, which already happened once and cost a day:
 * /v1/org/connectors and /v1/org/api-keys were built, registered, deployed and
 * tested, and were in no scope list at all. scopeAllows fails closed, so every
 * browser session got "this session is not allowed to do that" — including the
 * owner's, on a workspace they created. The API had the capability, the UI had
 * the screen, and the two could not be connected by anybody.
 *
 * That is the worst shape of bug in an authorization system: nothing errors,
 * no test fails, and the feature is simply unreachable in production while
 * being perfectly reachable from curl with an unscoped token. A route missing
 * from a scope list does not look like a mistake anywhere — it looks like
 * absence, and absence is invisible.
 *
 * So the check is the other way round. Rather than asking "do the scopes name
 * real routes", which the existing tests already cover, this asks: for every
 * /v1/org route this service actually registers, is there a scope that can
 * reach it? A new endpoint fails this on the day it is written, which is the
 * only day the answer is cheap.
 *
 * EXEMPTIONS ARE A NAMED LIST WITH REASONS, not a pattern, for the same reason
 * the purge test keeps one: an exemption should cost somebody a sentence.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { knownScopes, scopeAllows } from "./token-scope.js";

const ROUTES_DIR = fileURLToPath(new URL("../routes/", import.meta.url));

/**
 * Routes that are deliberately outside every browser scope.
 *
 * Each is here because a SCOPED SESSION TOKEN is not how it is authenticated,
 * so being unreachable by one is correct rather than broken.
 */
const EXEMPT = new Map([
  [
    "GET /v1/api/openapi.json",
    "unauthenticated by design: Copilot Studio fetches it before any credential exists, and it describes the API's shape rather than any company's data",
  ],

  /*
   * THE WAY IN.
   *
   * Every route below runs for somebody who does not have a session yet --
   * that is the entire point of them. Requiring a scoped session token to
   * reach the endpoint that issues a scoped session token is the circle these
   * are outside of. Each one does its own gating on something the caller
   * genuinely holds: an invite token, an email code, a password, or a signed
   * OAuth state.
   */
  ["GET /v1/org/invites/preview", "shows what an invite link is for, before anybody has signed in"],
  ["POST /v1/org/invites/accept", "claims an invite; the 32-byte token IS the credential"],
  ["POST /v1/org/auth/email/request", "sends a sign-in code to an address"],
  ["POST /v1/org/auth/email/verify", "exchanges that code for a session"],
  ["POST /v1/org/auth/email/signup", "creates an account, which by definition has no session yet"],
  ["POST /v1/org/auth/register", "the same, with a password"],
  ["POST /v1/org/auth/password", "exchanges a password for a session"],
  ["GET /v1/org/auth/methods", "says which ways in this deployment offers, so the sign-in page can render"],
  ["GET /v1/org/auth/google/start", "begins the OAuth redirect"],
  ["GET /v1/org/auth/google/callback", "Google calls this one, carrying signed state"],
]);

/** Anything under /v1/api/ is key-authenticated, never session-authenticated. */
const KEY_AUTHENTICATED = /^\/v1\/api\//;

function registeredOrgRoutes() {
  const found = new Map();
  for (const file of readdirSync(ROUTES_DIR)) {
    if (!file.endsWith(".js") || file.endsWith(".test.js")) continue;
    const src = readFileSync(join(ROUTES_DIR, file), "utf8");
    // app.get("/v1/org/…"  /  app.post(\n  "/v1/org/…"
    const re = /app\.(get|post|put|patch|delete)\(\s*["'`](\/v1\/(?:org|api)[^"'`]*)["'`]/g;
    for (const m of src.matchAll(re)) {
      const key = `${m[1].toUpperCase()} ${m[2]}`;
      if (!found.has(key)) found.set(key, file);
    }
  }
  return found;
}

test("every /v1/org route a session can reach is covered by some scope", () => {
  const routes = registeredOrgRoutes();
  assert.ok(
    routes.size > 40,
    `only found ${routes.size} routes — the matcher has probably stopped matching, which would make this test pass by seeing nothing`,
  );

  const scopes = knownScopes();
  const uncovered = [];

  for (const [route, file] of routes) {
    if (EXEMPT.has(route)) continue;
    const [method, pattern] = route.split(" ");
    if (KEY_AUTHENTICATED.test(pattern)) continue;

    // Reachable by ANY one scope is enough: a session carries several, and a
    // route only has to be in one of them.
    const reachable = scopes.some((s) => scopeAllows([s], method, pattern));
    if (!reachable) uncovered.push(`${route}  (${file})`);
  }

  assert.deepEqual(
    uncovered,
    [],
    "these routes are registered but in no scope, so every browser session is refused them:\n  " +
      uncovered.join("\n  "),
  );
});

test("the exemption list is still about routes that exist", () => {
  const routes = registeredOrgRoutes();
  const stale = [...EXEMPT.keys()].filter((r) => !routes.has(r));
  assert.deepEqual(
    stale,
    [],
    "exempted routes that are no longer registered — delete them from EXEMPT rather than leaving a note about a route nobody has",
  );
});
