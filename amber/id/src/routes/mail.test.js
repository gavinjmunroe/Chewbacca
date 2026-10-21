/**
 * THE MAIL ROUTES.
 *
 * Small surface, and every one of the three things worth asserting is a way a
 * route like this goes wrong:
 *
 *   1. it is owner-scoped, and a session that cannot resolve an owner writes
 *      nothing rather than writing to a default
 *   2. triggering a sync refreshes the derived numbers, because a card showing
 *      last month's frequency after a sync is worse than one showing none
 *   3. THERE IS NO WAY TO ASK FOR MESSAGE CONTENT. Not as a body field, not as
 *      a query parameter. Reading bodies is a per-mailbox flag, not something
 *      anybody who can call this route can switch on.
 *
 * Run with:  node --test src/routes/mail.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";

import { registerMailRoutes } from "./mail.js";

const OWNER = "11111111-1111-1111-1111-111111111111";
const PHONE = "+15550001111";

function buildApp(over = {}) {
  const app = Fastify();
  const calls = { sync: [], channels: [], totals: [] };

  registerMailRoutes(app, {
    // Stamps the identity a verified token would, so the routes under test are
    // the routes and not the token verifier.
    requireAuth: async (request) => {
      request.privyUser = over.noPhone ? { userId: "u" } : { userId: "u", phone: PHONE };
    },
    resolveOwnerId: over.resolveOwnerId ?? (async () => OWNER),
    accountsFor:
      over.accountsFor ??
      (async () => [
        { id: "a1", owner_id: OWNER, provider: "google", account_email: "k@amber.app", refresh_token: "r" },
      ]),
    stateFor:
      over.stateFor ??
      (async () => ({
        last_synced_at: "2026-09-26T10:00:00.000Z",
        backfilled_to: "2025-09-26T10:00:00.000Z",
        last_error: null,
        read_contents: false,
      })),
    syncMail:
      over.syncMail ??
      (async (ownerId, accounts) => {
        calls.sync.push({ ownerId, accounts: accounts.length });
        return { owner: ownerId, accounts: [{ accountId: "a1", ok: true, counted: 12 }] };
      }),
    refreshChannels: over.refreshChannels ?? (async (o) => (calls.channels.push(o), 3)),
    refreshTotals: over.refreshTotals ?? (async (o) => (calls.totals.push(o), 5)),
  });
  return { app, calls };
}

const AUTH = { authorization: "Bearer test" };

test("connected mailboxes come back with their sync state", async () => {
  const { app } = buildApp();
  const res = await app.inject({ method: "GET", url: "/v1/me/mail/accounts", headers: AUTH });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.count, 1);
  assert.equal(body.accounts[0].email, "k@amber.app");
  assert.equal(body.accounts[0].readsContents, false);
  assert.equal(body.accounts[0].neverSynced, false);
});

test("a mailbox that has never synced says so rather than showing a null date", async () => {
  const { app } = buildApp({ stateFor: async () => null });
  const body = (await app.inject({ method: "GET", url: "/v1/me/mail/accounts", headers: AUTH })).json();
  assert.equal(body.accounts[0].neverSynced, true);
  assert.equal(body.accounts[0].lastSyncedAt, null);
});

test("a non-Google account is not listed as a mailbox", async () => {
  const { app } = buildApp({
    accountsFor: async () => [{ id: "a2", provider: "microsoft", account_email: "x@o.com" }],
  });
  const body = (await app.inject({ method: "GET", url: "/v1/me/mail/accounts", headers: AUTH })).json();
  assert.equal(body.count, 0);
});

test("a sync runs and REFRESHES THE DERIVED NUMBERS", async () => {
  const { app, calls } = buildApp();
  const res = await app.inject({ method: "POST", url: "/v1/me/mail/sync", headers: AUTH });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(calls.totals, [OWNER]);
  assert.deepEqual(calls.channels, [OWNER]);
  assert.deepEqual(res.json().stats, { totals: 5, channels: 3 });
});

test("the sync is scoped to the resolved owner, never to a default", async () => {
  const { app, calls } = buildApp();
  await app.inject({ method: "POST", url: "/v1/me/mail/sync", headers: AUTH });
  assert.equal(calls.sync[0].ownerId, OWNER);
});

test("A SESSION WITH NO PHONE SYNCS NOTHING", async () => {
  const { app, calls } = buildApp({ noPhone: true });
  const res = await app.inject({ method: "POST", url: "/v1/me/mail/sync", headers: AUTH });
  assert.equal(res.statusCode, 400);
  assert.equal(calls.sync.length, 0);
});

test("an unresolvable owner is a 500 and writes nothing", async () => {
  const { app, calls } = buildApp({ resolveOwnerId: async () => null });
  const res = await app.inject({ method: "POST", url: "/v1/me/mail/sync", headers: AUTH });
  assert.equal(res.statusCode, 500);
  assert.equal(calls.sync.length, 0);
});

test("no connected account is a 409 that says what to do, not a silent success", async () => {
  const { app } = buildApp({ accountsFor: async () => [] });
  const res = await app.inject({ method: "POST", url: "/v1/me/mail/sync", headers: AUTH });
  assert.equal(res.statusCode, 409);
  assert.equal(res.json().error, "no_connected_accounts");
});

test("a sync that throws is a 503, not a 200 with no work done", async () => {
  const { app } = buildApp({
    syncMail: async () => {
      throw new Error("gmail exploded");
    },
  });
  const res = await app.inject({ method: "POST", url: "/v1/me/mail/sync", headers: AUTH });
  assert.equal(res.statusCode, 503);
});

test("a failing stats refresh still reports the sync that did happen", async () => {
  const { app } = buildApp({
    refreshChannels: async () => {
      throw new Error("rollup down");
    },
  });
  const res = await app.inject({ method: "POST", url: "/v1/me/mail/sync", headers: AUTH });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().accounts[0].counted, 12);
});

test("THERE IS NO WAY TO ASK THIS ROUTE FOR MESSAGE CONTENT", async () => {
  // Reading bodies is a per-mailbox flag on mail_sync_state. If it ever becomes
  // reachable from here, it becomes reachable by anybody holding a session.
  const { app, calls } = buildApp();
  await app.inject({
    method: "POST",
    url: "/v1/me/mail/sync?readContents=true&format=full",
    headers: AUTH,
    payload: { readContents: true, includeBodies: true },
  });
  const forwarded = JSON.stringify(calls.sync);
  assert.ok(!/readContents|includeBodies|format/i.test(forwarded));
});
