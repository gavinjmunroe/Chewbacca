/**
 * THE SYNC, WITHOUT GMAIL.
 *
 * Every dependency is injected, so these run against fixtures and assert the
 * things that would otherwise only be discovered against a real mailbox with
 * ten years of mail in it:
 *
 *   - NO BODY IS EVER REQUESTED. The single most important property in the
 *     file, and the cheapest to verify: every message URL must ask for
 *     format=metadata. A future edit that drops it would start pulling email
 *     bodies across the wire in production and nothing else would notice.
 *   - a first run is bounded, and says when it stopped early
 *   - a revoked token on one mailbox does not stop the others
 *   - the owner's OTHER connected address counts as the owner
 *
 * Run with:  node --test src/lib/gmail-sync.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { syncMailAccount, syncOwnerMail } from "./gmail-sync.js";

const OWNER = "11111111-1111-1111-1111-111111111111";
const ACCOUNT = {
  id: "22222222-2222-2222-2222-222222222222",
  owner_id: OWNER,
  provider: "google",
  account_email: "karthik@amber.app",
  refresh_token: "refresh-abc",
};

function msg(i, over = {}) {
  return {
    id: `m${i}`,
    threadId: `t${i}`,
    payload: {
      headers: [
        { name: "Message-ID", value: `<mid-${i}@mail.gmail.com>` },
        { name: "Date", value: "Tue, 22 Sep 2026 10:00:00 -0700" },
        { name: "From", value: "Sagar <sagar@x.com>" },
        { name: "To", value: "karthik@amber.app" },
        ...(over.headers ?? []),
      ],
    },
  };
}

/** A fake Gmail. Records every URL it was asked for. */
function fakeGmail({ ids = ["m1", "m2"], messages = null, listStatus = 200 } = {}) {
  const urls = [];
  const byId = new Map((messages ?? ids.map((_, i) => msg(i + 1))).map((m) => [m.id, m]));
  const fetchImpl = async (url) => {
    urls.push(url);
    if (url.includes("/messages?")) {
      if (listStatus !== 200) return { ok: false, status: listStatus };
      return {
        ok: true,
        status: 200,
        json: async () => ({ messages: ids.map((id) => ({ id })) }),
      };
    }
    if (url.includes("oauth2.googleapis.com/token")) {
      return { ok: true, status: 200, json: async () => ({ access_token: "at-1" }) };
    }
    const id = decodeURIComponent(url.split("/messages/")[1].split("?")[0]);
    const m = byId.get(id);
    return m
      ? { ok: true, status: 200, json: async () => m }
      : { ok: false, status: 404 };
  };
  return { fetchImpl, urls };
}

const deps = (over = {}) => {
  const recorded = [];
  return {
    recorded,
    deps: {
      record: async (_owner, list) => {
        recorded.push(...list);
        return { messages: list.length, participants: list.length, created: 0, skipped: 0 };
      },
      readState: async () => null,
      saveState: async () => true,
      ownAddresses: ["karthik@amber.app"],
      ...over,
    },
  };
};

test("NO MESSAGE IS EVER FETCHED WITH A BODY", async () => {
  const gmail = fakeGmail();
  const { deps: d } = deps();
  process.env.GOOGLE_OAUTH_CLIENT_ID = "cid";
  process.env.GOOGLE_OAUTH_CLIENT_SECRET = "csecret";
  await syncMailAccount(ACCOUNT, { ...d, fetchImpl: gmail.fetchImpl });

  const messageReads = gmail.urls.filter((u) => /\/messages\/[^?]+\?/.test(u));
  assert.ok(messageReads.length > 0, "nothing was read at all");
  for (const u of messageReads) {
    assert.ok(u.includes("format=metadata"), `a read did not ask for metadata only: ${u}`);
    assert.ok(!u.includes("format=full"), "a read asked for the full message");
    assert.ok(!u.includes("format=raw"), "a read asked for the raw message");
  }
});

test("the metadata headers requested carry no content", async () => {
  const gmail = fakeGmail();
  const { deps: d } = deps();
  await syncMailAccount(ACCOUNT, { ...d, fetchImpl: gmail.fetchImpl });
  const read = gmail.urls.find((u) => /\/messages\/[^?]+\?/.test(u));
  assert.ok(!/metadataHeaders=Subject/i.test(read), "the subject line was requested");
  assert.ok(/metadataHeaders=From/.test(read));
  assert.ok(/metadataHeaders=Message-ID/i.test(read));
});

test("parsed messages reach the writer", async () => {
  const gmail = fakeGmail({ ids: ["m1", "m2", "m3"] });
  const { deps: d, recorded } = deps();
  const r = await syncMailAccount(ACCOUNT, { ...d, fetchImpl: gmail.fetchImpl });
  assert.equal(r.ok, true);
  assert.equal(recorded.length, 3);
  assert.equal(r.counted, 3);
});

test("A NEWSLETTER IS LISTED AND NOT COUNTED", async () => {
  const messages = [
    msg(1),
    msg(2, { headers: [{ name: "List-Unsubscribe", value: "<mailto:u@x>" }] }),
  ];
  const gmail = fakeGmail({ ids: ["m1", "m2"], messages });
  const { deps: d } = deps();
  const r = await syncMailAccount(ACCOUNT, { ...d, fetchImpl: gmail.fetchImpl });
  assert.equal(r.listed, 2);
  assert.equal(r.counted, 1, "a newsletter was counted as a relationship");
});

test("a run that hits its ceiling says so, so a scheduler comes back", async () => {
  const gmail = fakeGmail({ ids: ["m1", "m2", "m3", "m4"] });
  const { deps: d } = deps();
  const r = await syncMailAccount(ACCOUNT, {
    ...d,
    fetchImpl: gmail.fetchImpl,
    maxMessages: 2,
  });
  assert.equal(r.read, 2);
  assert.equal(r.more, true);
});

test("a message Gmail refuses is counted as a failure, not silently dropped", async () => {
  const gmail = fakeGmail({ ids: ["m1", "missing"] });
  const { deps: d } = deps();
  const r = await syncMailAccount(ACCOUNT, { ...d, fetchImpl: gmail.fetchImpl });
  assert.equal(r.fetchFailed, 1);
  assert.equal(r.counted, 1);
});

test("A REVOKED TOKEN IS REPORTED, and the cursor records why", async () => {
  const errors = [];
  const r = await syncMailAccount(ACCOUNT, {
    ...deps().deps,
    fetchImpl: async () => ({ ok: false, status: 400 }),
    saveState: async (_o, _a, patch) => {
      errors.push(patch.error);
      return true;
    },
  });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "token_refresh_failed");
  assert.deepEqual(errors, ["token_refresh_failed"]);
});

test("a 403 is named as scope or quota, because those are the two causes", async () => {
  const gmail = fakeGmail({ listStatus: 403 });
  const r = await syncMailAccount(ACCOUNT, { ...deps().deps, fetchImpl: gmail.fetchImpl });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "scope_or_quota");
});

test("a non-Google account is refused by name rather than no-opped", async () => {
  const r = await syncMailAccount({ ...ACCOUNT, provider: "microsoft" }, deps().deps);
  assert.equal(r.ok, false);
  assert.equal(r.reason, "provider_unsupported");
});

test("an account with no owner is refused before any request", async () => {
  let called = false;
  const r = await syncMailAccount(
    { id: "x" },
    { ...deps().deps, fetchImpl: async () => ((called = true), { ok: false }) },
  );
  assert.equal(r.ok, false);
  assert.equal(called, false);
});

// ── several mailboxes ──────────────────────────────────────────────────────

test("ONE BROKEN MAILBOX DOES NOT STOP THE OTHERS", async () => {
  const good = fakeGmail();
  let call = 0;
  const fetchImpl = async (url) => {
    // The first account's token refresh fails; the second works.
    if (url.includes("oauth2.googleapis.com/token")) {
      call += 1;
      return call === 1
        ? { ok: false, status: 400 }
        : { ok: true, status: 200, json: async () => ({ access_token: "at" }) };
    }
    return good.fetchImpl(url);
  };
  const r = await syncOwnerMail(
    OWNER,
    [
      { ...ACCOUNT, id: "a1", account_email: "work@amber.app" },
      { ...ACCOUNT, id: "a2", account_email: "k@personal.com" },
    ],
    { ...deps().deps, fetchImpl },
  );
  assert.equal(r.accounts.length, 2);
  assert.equal(r.accounts[0].ok, false);
  assert.equal(r.accounts[1].ok, true);
});

test("EVERY CONNECTED ADDRESS COUNTS AS THE OWNER, across all their mailboxes", async () => {
  // Mail from the work account to the personal one is a note to self, not a
  // relationship, and only knowing both addresses makes that visible.
  const messages = [
    msg(1, { headers: [] }),
  ];
  messages[0].payload.headers = [
    { name: "Message-ID", value: "<self@x>" },
    { name: "Date", value: "Tue, 22 Sep 2026 10:00:00 -0700" },
    { name: "From", value: "work@amber.app" },
    { name: "To", value: "k@personal.com" },
  ];
  const gmail = fakeGmail({ ids: ["m1"], messages });
  const { deps: d, recorded } = deps();
  await syncOwnerMail(
    OWNER,
    [
      { ...ACCOUNT, id: "a1", account_email: "work@amber.app" },
      { ...ACCOUNT, id: "a2", account_email: "k@personal.com" },
    ],
    { ...d, fetchImpl: gmail.fetchImpl },
  );
  assert.equal(recorded.length, 0, "a note to self was recorded as a relationship");
});

test("accounts with no refresh token are skipped rather than attempted", async () => {
  let touched = false;
  const r = await syncOwnerMail(
    OWNER,
    [{ ...ACCOUNT, refresh_token: null }],
    { ...deps().deps, fetchImpl: async () => ((touched = true), { ok: false }) },
  );
  assert.equal(r.accounts.length, 0);
  assert.equal(touched, false);
});
