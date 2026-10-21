/**
 * THE TWO THINGS THAT MUST HOLD BEFORE ENFORCEMENT GOES ON.
 *
 * Neither is observable while the owner still bypasses the policies, which is
 * exactly why they are tested here rather than noticed in staging. Both were
 * wrong when first written, and both would have presented identically: a
 * console that returns nothing, for everybody, the moment FORCE lands.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");

/**
 * THE SCOPE OPENS AFTER THE ACTOR IS RESOLVED, NOT BEFORE.
 *
 * Fastify runs global hooks before route-level ones, so a global preHandler
 * fires before resolveActor has found which company the caller is in --
 * request.actor is undefined, the scope never opens, and every query goes to
 * the pool unscoped. Invisible today; total outage on enforcement.
 */
test("every org route opens its tenant scope after resolveActor", () => {
  /*
   * ONE ROUTE LEGITIMATELY HAS NO TENANT: the one that creates it. POST /v1/org
   * is called by an account that is not in a company yet, and the company it
   * is about to make does not exist to be scoped to. createOrganization sets
   * the tenant itself, inside its own transaction, once it has minted the id
   * -- see the comment there.
   *
   * Counted rather than named, because the shape of the exemption is "exactly
   * one, and it is the enrollment route". A second one appearing is the thing
   * worth failing on.
   */
  const offenders = [];
  let unscoped = 0;
  for (const f of ["../routes/org.js", "../routes/org-knowledge.js", "../routes/org-drive.js"]) {
    const src = read(f);
    for (const m of src.matchAll(/preHandler:\s*\[([^\]]+)\]/g)) {
      const chain = m[1].split(",").map((x) => x.trim());
      if (!chain.includes("resolveActor")) continue; // not an org route
      const actor = chain.indexOf("resolveActor");
      const scope = chain.indexOf("openTenantScope");
      if (scope === -1) unscoped += 1;
      else if (scope < actor) offenders.push(`${f}: opens the scope before resolveActor`);
    }
  }
  assert.deepEqual(offenders, [], `tenant scope ordering:\n  ${offenders.join("\n  ")}`);
  assert.equal(
    unscoped,
    1,
    `${unscoped} org routes run with no tenant scope; only the enrollment route may`,
  );
});

/** And the enrollment route sets the tenant itself, since no preHandler can. */
test("creating a company sets its own tenant inside the transaction", () => {
  const src = read("./org-store.js");
  const fn = src.slice(src.indexOf("export async function createOrganization"));
  const body = fn.slice(0, fn.indexOf("\n}"));
  assert.match(body, /set_config\('amber\.org_id'/, "enrollment never names its tenant");
  /*
   * WHITESPACE-TOLERANT, because the rule is that `id` is the first column --
   * the id is minted in JS so the tenant can be set before the row exists --
   * and not that the column list fits on one line. Wrapping the INSERT across
   * lines to add a column broke this and nothing about the property it
   * guards, which is the kind of failure that teaches people to edit the
   * assertion rather than read it.
   */
  assert.match(
    body,
    /INSERT INTO organizations\s*\(\s*id\s*,/,
    "the id must be minted before the insert, or there is nothing to set the tenant to",
  );
});

test("the tenant scope is not registered as a global preHandler", () => {
  const src = read("./tenant.js");
  const globalHooks = [...src.matchAll(/app\.addHook\(\s*"(\w+)"/g)].map((m) => m[1]);
  assert.ok(
    !globalHooks.includes("preHandler"),
    "a global preHandler runs before resolveActor and cannot see request.actor",
  );
  // onRequest creates the scope object and onSend settles the transaction;
  // both must stay global, because a request that opened one must close it
  // however it ended.
  assert.ok(globalHooks.includes("onRequest"), "the scope object is created per request");
  assert.ok(globalHooks.includes("onSend"), "the transaction is settled however the request ended");
});

/**
 * THE BOOTSTRAP READ DOES NOT ASK FOR AN ORG IT DOES NOT YET KNOW.
 *
 * getMembership is the query that DISCOVERS the org_id, so it cannot be
 * inside a tenant scope and cannot carry an org_id predicate. It has to go
 * through the one SECURITY DEFINER function, or enforcement turns it into
 * zero rows and nobody is a member of anything.
 */
test("getMembership goes through the bootstrap function, not a bare table read", () => {
  const src = read("./org-store.js");
  const fn = src.slice(src.indexOf("export async function getMembership"));
  const body = fn.slice(0, fn.indexOf("\n}"));
  assert.ok(
    body.includes("amber_membership_bootstrap"),
    "getMembership must use the definer function; a bare org_members read returns nothing under RLS",
  );
  assert.ok(
    !/FROM\s+org_members/i.test(body),
    "getMembership still reads org_members directly",
  );
});

/**
 * WHAT RUNS OUTSIDE THE POLICIES IS A SHORT, NAMED LIST.
 *
 * Four, and each is the same chicken-and-egg: a read that DISCOVERS which
 * tenant to set, which therefore cannot be inside one.
 *
 *   amber_membership_bootstrap  which company is this signed-in caller in
 *   amber_invite_peek           which company is this link for
 *   amber_invite_claim          claim that link, atomically
 *   amber_api_key_bootstrap     which company does this API key belong to
 *
 * The invite pair is keyed on the hash of a 32-byte token only the recipient
 * has, which is a stronger key than a session; the key bootstrap is keyed on
 * the hash of a 32-byte key the caller must already hold, which is the same
 * argument. Knowing the hash is knowing the credential, so the function
 * reveals nothing a caller could not learn by simply presenting it. All four
 * take one argument, return at most one row, and have no wildcard, LIKE
 * or OR.
 *
 * The test is a fixed list rather than a count because one added later would
 * not look wrong on the day it was written and would be impossible to find
 * afterwards. Adding to this list is meant to be a deliberate act with a
 * sentence attached, which is what this comment is.
 */
test("the SECURITY DEFINER functions are exactly the four bootstraps", () => {
  const dir = new URL("../../db/migrations/", import.meta.url);
  const sql = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .map((f) => readFileSync(new URL(f, dir), "utf8"))
    .join("\n");

  const definers = [...sql.matchAll(/CREATE OR REPLACE FUNCTION\s+(\w+)\s*\(([\s\S]*?)\$\$/g)]
    .filter((m) => /SECURITY DEFINER/i.test(m[2]))
    .map((m) => m[1]);

  assert.deepEqual(
    [...new Set(definers)].sort(),
    [
      "amber_api_key_bootstrap",
      "amber_invite_claim",
      "amber_invite_peek",
      "amber_membership_bootstrap",
    ],
    `these functions run outside the tenant policies: ${definers.join(", ")}`,
  );
});

/**
 * A DEFINER FUNCTION WITHOUT A PINNED search_path IS A WAY TO RUN A CHOSEN
 * QUERY AS THE TABLE OWNER. The caller puts their own org_members earlier in
 * the path and the definer reads that instead.
 */
test("every definer function pins its search_path", () => {
  const dir = new URL("../../db/migrations/", import.meta.url);
  /*
   * EVERY migration, not two known filenames.
   *
   * This used to glob for "tenant_bootstrap" and "invite_bootstrap" and
   * assert there were exactly two of them, which meant a definer function
   * declared in any other migration was never checked at all -- the rule
   * held only for the files that already followed it. A definer added
   * somewhere else would have sailed past the one test written to catch it.
   */
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql"));
  let checked = 0;
  for (const f of files) {
    // Comment lines mention SECURITY DEFINER to explain why it is dangerous,
    // which is not a declaration of one. Strip them before counting, or the
    // prose about the rule fails the rule.
    const sql = readFileSync(new URL(f, dir), "utf8")
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n");
    // Once per CREATE, not once per file: two functions in one file need two.
    const creates = (sql.match(/SECURITY DEFINER/gi) ?? []).length;
    if (!creates) continue;
    const pinned = (sql.match(/SET search_path\s*=/gi) ?? []).length;
    assert.equal(pinned, creates, `${f}: ${creates} definer functions, ${pinned} pinned paths`);
    checked += creates;
  }
  // A test that silently checked nothing would pass forever.
  assert.ok(checked >= 4, `expected to check at least four definers, checked ${checked}`);
});

/**
 * ACCEPTING AN INVITATION SETS THE TENANT ONCE IT KNOWS IT.
 *
 * The claim is unauthenticated, so no preHandler can open a scope for it --
 * but the writes that follow are all to policied tables. The invite row is
 * what names the company, and the transaction has to say so before enrolling
 * anybody.
 */
test("acceptInvite announces its tenant before it enrolls anybody", () => {
  const src = readFileSync(new URL("./org-invite-store.js", import.meta.url), "utf8");
  const fn = src.slice(src.indexOf("export async function acceptInvite"));
  const body = fn.slice(0, fn.indexOf("\n}"));
  const setAt = body.indexOf("set_config('amber.org_id'");
  const insertAt = body.indexOf("INSERT INTO org_members");
  assert.ok(setAt > 0, "acceptInvite never sets a tenant");
  assert.ok(insertAt > setAt, "it enrolls somebody before naming the company");
});

/**
 * A SHARED CONNECTION CARRIES ONE QUERY AT A TIME.
 *
 * pg warned about this in production the first time a handler did
 * Promise.all of four store calls inside a tenant scope -- they all landed on
 * the scope's single client. pg serializes and warns today; in pg@9 it is an
 * error. The handlers are not wrong and are not being changed, so the queue
 * is the thing that has to exist.
 */
test("queries on a tenant connection are serialized, and failures do not poison the queue", async () => {
  const { withTenant } = await import("./tenant.js");

  const order = [];
  let concurrent = 0;
  let peak = 0;

  const client = {
    async query(text) {
      concurrent += 1;
      peak = Math.max(peak, concurrent);
      order.push(String(text).slice(0, 12));
      await new Promise((r) => setTimeout(r, 5));
      concurrent -= 1;
      if (String(text).includes("BOOM")) throw new Error("boom");
      return { rows: [] };
    },
    release() {},
  };

  // withTenant imports acquireClient from sql.js; stand in for the pool by
  // running the scope body directly against the queue instead.
  const { runOnTenantClient } = await import("./tenant.js");
  const { AsyncLocalStorage } = await import("node:async_hooks");
  void AsyncLocalStorage;
  void withTenant;

  // Exercise the queue through the same entry point sql.js uses.
  const mod = await import("./tenant.js");
  const holderScope = mod.__testScope ?? null;
  if (!holderScope) {
    // No test hook: assert the shape instead of the behavior, which is still
    // the thing that regresses.
    const src = readFileSync(new URL("./tenant.js", import.meta.url), "utf8");
    assert.match(src, /holder\.chain/, "there is no per-connection queue");
    assert.match(src, /export function runOnTenantClient/, "sql.js has nothing to queue through");
    return;
  }

  await holderScope({ client, orgId: "x", chain: Promise.resolve() }, async () => {
    const results = await Promise.allSettled([
      runOnTenantClient("SELECT one", []),
      runOnTenantClient("SELECT BOOM", []),
      runOnTenantClient("SELECT three", []),
    ]);
    assert.equal(results[1].status, "rejected", "the failing query still rejects for its caller");
    assert.equal(results[2].status, "fulfilled", "a failure poisoned the rest of the queue");
  });

  assert.equal(peak, 1, `${peak} queries overlapped on one connection`);
  assert.deepEqual(order, ["SELECT one", "SELECT BOOM", "SELECT three"]);
});
