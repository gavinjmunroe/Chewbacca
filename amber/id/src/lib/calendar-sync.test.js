/**
 * SYNCING A CALENDAR, AND THE FOUR WAYS IT GOES WRONG.
 *
 *   THE SELF-MEETING   every invite carries the connected account's own
 *                      address. People have a contact card for themselves, so
 *                      matching it credits somebody with a meeting with
 *                      themselves every day -- and since these rows feed
 *                      contact_interaction_stats, the rollup would rank them
 *                      their own closest relationship.
 *   THE LOST PERSON    a meeting written with no contact on it is a rectangle on
 *                      a day view. Attached to Mina it is an interaction with
 *                      Mina, which is the entire reason for syncing at all.
 *   THE DUPLICATE DAY  a sync runs again over the same events. Without a stable
 *                      external id, Tuesday appears twice, then three times.
 *   THE SILENT DEATH   a revoked token, a throttled tenant. If that throws, one
 *                      dead account stops every other account's sync.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  credentialsFromEnv,
  syncCalendarAccount,
  syncAllCalendars,
} from "./calendar-sync.js";

const OWNER = "11111111-1111-1111-1111-111111111111";
const ACCOUNT = {
  id: "acc-1",
  owner_id: OWNER,
  provider: "google",
  account_email: "me@work.com",
  refresh_token: "r1",
  scopes: null,
};

function harness({
  items = [],
  tokenOk = true,
  listStatus = 200,
  contacts = {},
} = {}) {
  const upserts = [];
  const syncs = [];
  const matchCalls = [];
  const fetchImpl = async (url) => {
    if (String(url).includes("oauth2.googleapis.com/token")) {
      return tokenOk
        ? { ok: true, json: async () => ({ access_token: "at" }) }
        : { ok: false, status: 400, json: async () => ({}) };
    }
    if (String(url).includes("/calendarList"))
      return {
        ok: true,
        json: async () => ({
          items: [
            { id: "primary", primary: true, selected: true, timeZone: "UTC" },
          ],
        }),
      };
    if (listStatus !== 200)
      return { ok: false, status: listStatus, json: async () => ({}) };
    return { ok: true, json: async () => ({ items }) };
  };
  const deps = {
    fetch: fetchImpl,
    // Injected rather than read from the shell. See credentialsFromEnv: the
    // first version of these tests only passed when the environment happened to
    // carry the app's real client id.
    credentials: () => ({ clientId: "cid", clientSecret: "secret" }),
    matchAttendeesToContacts: async (ownerId, emails, opts) => {
      matchCalls.push({ ownerId, emails, opts });
      const self = new Set(
        (opts?.selfEmails ?? []).map((e) => e.toLowerCase()),
      );
      return (emails ?? [])
        .map((e) => String(e).toLowerCase())
        .filter((e) => !self.has(e))
        .filter((e) => contacts[e])
        .map((e) => ({ contactId: contacts[e], email: e }));
    },
    upsertSyncedEvent: async (ownerId, accountId, ev) => {
      upserts.push(ev);
      return { eventId: `e-${upserts.length}` };
    },
    recordSync: async (id, info) => syncs.push({ id, ...info }),
  };
  return { deps, upserts, syncs, matchCalls };
}

const gEvent = (over = {}) => ({
  id: "ev-1",
  summary: "Lunch with Mina",
  start: { dateTime: "2026-09-10T12:00:00Z" },
  end: { dateTime: "2026-09-10T13:00:00Z" },
  attendees: [{ email: "me@work.com" }, { email: "mina@corp.com" }],
  organizer: { email: "me@work.com" },
  ...over,
});

test("THE SELF-MEETING: the connected account's own address is never matched", async () => {
  const { deps, upserts, matchCalls } = harness({
    items: [gEvent()],
    contacts: { "me@work.com": "contact-me", "mina@corp.com": "contact-mina" },
  });
  const res = await syncCalendarAccount(ACCOUNT, deps);
  assert.equal(res.error, null);
  // The matcher is TOLD who not to match, rather than the caller filtering
  // afterwards -- the exclusion has to happen where the emails are compared.
  assert.deepEqual(matchCalls[0].opts.selfEmails, ["me@work.com"]);
  assert.equal(
    upserts[0].contactId,
    "contact-mina",
    "the owner was booked with themselves",
  );
  assert.deepEqual(upserts[0].participantContactIds, []);
});

test("THE LOST PERSON: a matched attendee lands on the event, and the rest become participants", async () => {
  const { deps, upserts } = harness({
    items: [
      gEvent({
        attendees: [
          { email: "me@work.com" },
          { email: "mina@corp.com" },
          { email: "rowan@street.co" },
          { email: "stranger@nowhere.io" },
        ],
      }),
    ],
    contacts: { "mina@corp.com": "c-mina", "rowan@street.co": "c-rowan" },
  });
  await syncCalendarAccount(ACCOUNT, deps);
  assert.equal(upserts[0].contactId, "c-mina");
  assert.deepEqual(upserts[0].participantContactIds, ["c-rowan"]);
  // Somebody who is not in the address book is simply not a contact. The event
  // is still written -- it is on your day either way.
  assert.equal(upserts.length, 1);
});

test("an event with nobody recognizable is still written, just unattached", async () => {
  const { deps, upserts } = harness({
    items: [gEvent({ attendees: [] })],
    contacts: {},
  });
  await syncCalendarAccount(ACCOUNT, deps);
  assert.equal(upserts.length, 1);
  assert.equal(upserts[0].contactId, null);
});

test("THE DUPLICATE DAY: the provider's id rides along so the write can be an upsert", async () => {
  const { deps, upserts } = harness({
    items: [gEvent({ id: "abc" }), gEvent({ id: "def", summary: "Standup" })],
  });
  await syncCalendarAccount(ACCOUNT, deps);
  assert.deepEqual(
    upserts.map((u) => u.externalId),
    ["abc", "def"],
  );
  // An event with no id cannot be upserted, so it is skipped rather than
  // written as a row no future sync can find again.
  const second = harness({ items: [gEvent({ id: "" })] });
  await syncCalendarAccount(ACCOUNT, second.deps);
  assert.equal(second.upserts.length, 0);
});

test("a cancelled event is passed through as cancelled, not dropped", async () => {
  // It may already be in the table from an earlier sync. Skipping it would
  // leave a meeting on somebody's day that they know was called off.
  const { deps, upserts } = harness({
    items: [gEvent({ status: "cancelled" })],
  });
  await syncCalendarAccount(ACCOUNT, deps);
  assert.equal(upserts.length, 1);
  assert.equal(upserts[0].cancelled, true);
});

test("an all-day event retains its flag and calendar-local midnight", async () => {
  const { deps, upserts } = harness({
    items: [
      gEvent({ start: { date: "2026-09-10" }, end: { date: "2026-09-11" } }),
    ],
  });
  await syncCalendarAccount(ACCOUNT, deps);
  assert.equal(upserts[0].startsAt, "2026-09-10T00:00:00.000Z");
  assert.equal(upserts[0].allDay, true);
});

test("THE SILENT DEATH: a dead token is recorded on the account and never thrown", async () => {
  const { deps, syncs, upserts } = harness({ tokenOk: false });
  const res = await syncCalendarAccount(ACCOUNT, deps);
  assert.equal(res.error, "no_token");
  assert.equal(upserts.length, 0);
  // The account SAYS it is broken, so the UI can show it rather than showing an
  // empty calendar that looks like an empty life.
  assert.match(syncs[0].error, /refresh/);
});

test("a provider error is recorded and the sync returns rather than throwing", async () => {
  const { deps, syncs } = harness({ listStatus: 503 });
  const res = await syncCalendarAccount(ACCOUNT, deps);
  assert.match(res.error, /google 503/);
  assert.match(syncs[0].error, /google 503/);
});

test("ONE DEAD ACCOUNT DOES NOT STOP THE OTHERS", async () => {
  // The failure that matters at scale: a user with three calendars, one of them
  // revoked, must still get the other two.
  const good = harness({ items: [gEvent()] });
  //
  // TARGETED BY REFRESH TOKEN, not by counting calls. The first version of this
  // counted fetches and broke "the second call", which is account one's event
  // LIST -- each account makes two requests. It tested the wrong thing and
  // passed for the wrong reason. The broken account is now identified by
  // something that actually belongs to it.
  //
  const deps = {
    ...good.deps,
    fetch: async (url, init) => {
      const isToken = String(url).includes("oauth2.googleapis.com/token");
      if (
        isToken &&
        String(init?.body ?? "").includes("refresh_token=revoked")
      ) {
        return { ok: false, status: 400, json: async () => ({}) };
      }
      return good.deps.fetch(url, init);
    },
  };
  const results = await syncAllCalendars(
    [
      { ...ACCOUNT, id: "a1" },
      { ...ACCOUNT, id: "a2", refresh_token: "revoked" },
      { ...ACCOUNT, id: "a3" },
    ],
    deps,
  );
  assert.equal(results.length, 3, "the run stopped at the broken account");
  assert.equal(results[1].error, "no_token");
  assert.equal(results[0].error, null);
  assert.equal(results[2].error, null);
});

test("a successful sync clears the last error, so a fixed account stops looking broken", async () => {
  const { deps, syncs } = harness({ items: [gEvent()] });
  await syncCalendarAccount(ACCOUNT, deps);
  assert.equal(syncs.at(-1).error, null);
});

test("an account with no refresh token is refused before any request is made", async () => {
  let fetched = false;
  const res = await syncCalendarAccount(
    { ...ACCOUNT, refresh_token: null },
    {
      fetch: async () => {
        fetched = true;
        return { ok: false, status: 400, json: async () => ({}) };
      },
      credentials: () => ({ clientId: "cid", clientSecret: "secret" }),
      recordSync: async () => {},
      upsertSyncedEvent: async () => null,
      matchAttendeesToContacts: async () => [],
    },
  );
  assert.equal(res.error, "no_token");
  assert.equal(
    fetched,
    false,
    "a token request was made with no refresh token",
  );
});

test("credentialsFromEnv reads the names the OAuth callbacks actually write", () => {
  // A guessed env name is a sync that refreshes nothing and blames the account.
  // MS_OAUTH_*, not MICROSOFT_OAUTH_* -- checked against the callback itself.
  const env = {
    GOOGLE_OAUTH_CLIENT_ID: "g-id",
    GOOGLE_OAUTH_CLIENT_SECRET: "g-secret",
    MS_OAUTH_CLIENT_ID: "m-id",
    MS_OAUTH_CLIENT_SECRET: "m-secret",
  };
  assert.deepEqual(credentialsFromEnv("google", env), {
    clientId: "g-id",
    clientSecret: "g-secret",
  });
  assert.deepEqual(credentialsFromEnv("microsoft", env), {
    clientId: "m-id",
    clientSecret: "m-secret",
  });

  const ms = readFileSync(
    new URL("../oauth/microsoft/callback.js", import.meta.url),
    "utf8",
  );
  assert.match(
    ms,
    /MS_OAUTH_CLIENT_ID/,
    "the Microsoft callback no longer uses this name",
  );
  assert.match(ms, /MS_OAUTH_CLIENT_SECRET/);
  const g = readFileSync(
    new URL("../oauth/google/callback.js", import.meta.url),
    "utf8",
  );
  assert.match(
    g,
    /GOOGLE_OAUTH_CLIENT_ID/,
    "the Google callback no longer uses this name",
  );
});

test("BOTH OAUTH CALLBACKS RECORD A CALENDAR ACCOUNT", () => {
  // The whole multi-account feature rests on this: without the calendar_accounts
  // write, connecting a second Google still overwrites the first in the secrets
  // bag and nothing anywhere notices. Checked structurally because the callbacks
  // need a live OAuth round trip to exercise.
  for (const p of ["google", "microsoft"]) {
    const src = readFileSync(
      new URL(`../oauth/${p}/callback.js`, import.meta.url),
      "utf8",
    );
    assert.match(
      src,
      /connectCalendarAccount/,
      `${p} does not record a calendar account`,
    );
    assert.match(
      src,
      /resolveAmberIdByPrivyDid/,
      `${p} does not resolve the owner`,
    );
  }
});
