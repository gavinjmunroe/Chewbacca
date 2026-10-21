/**
 * Tests for the Amber → Clay push.
 *
 * The bulk of these are on validateClayWebhookUrl, because that function is the only
 * thing standing between a user-supplied URL and the server making HTTP requests to
 * it. An SSRF here would let any Amber account use our server to reach cloud metadata,
 * our own database, or anything else inside the deployment's network — while we POST
 * a contact book at it. So the attack strings below are the point of this file, not
 * decoration.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  CLAY_DEFAULT_MODE,
  CLAY_MODES,
  pushRowsToClay,
  toClayRow,
  validateClayWebhookUrl,
} from "./clay-webhook.js";

test("accepts real Clay webhook URLs", () => {
  const good = [
    "https://api.clay.com/v3/sources/webhook/pull-in-data-from-a-webhook-abc123",
    "https://api.clay.com/v3/sources/webhook/x?tableId=99",
    "https://clay.com/hook/abc",
    "https://www.clay.com/hook/abc",
    // The fully-qualified form of the same name. It resolves identically, so rejecting
    // it would just refuse a legitimate URL.
    "https://api.clay.com./v3/sources/webhook/abc",
  ];
  for (const u of good) {
    const r = validateClayWebhookUrl(u);
    assert.ok(r.ok, `should accept ${u} — got: ${r.reason}`);
  }
});

test("the allowlist is an EXACT host set, not a *.clay.com wildcard", () => {
  // THE SECURITY REASON this is a set. A suffix match bets on Clay's DNS hygiene: with
  // "*.clay.com" both of these passed validation and were saved only by the fact that
  // those records do not exist today. One wildcard A record, or one subdomain takeover
  // under clay.com, and a suffix match becomes internal-network SSRF.
  for (const u of [
    "https://localhost.clay.com/hook",
    "https://169.254.169.254.clay.com/hook",
    "https://metadata.clay.com/hook",
  ]) {
    assert.equal(validateClayWebhookUrl(u).ok, false, `MUST reject ${u}`);
  }

  // THE COST, pinned deliberately so it is a decision and not a surprise: an unlisted
  // Clay subdomain is refused. If Clay ever serves webhooks from a regional host, add it
  // to ALLOWED_HOSTS — the rejection message names the host, so the failure is legible.
  assert.equal(validateClayWebhookUrl("https://eu.api.clay.com/hook").ok, false);
});

test("rejects the classic SSRF targets", () => {
  const bad = [
    // Cloud metadata — the single highest-value SSRF target on any hosted platform.
    "https://169.254.169.254/latest/meta-data/",
    "http://169.254.169.254/",
    "https://metadata.google.internal/computeMetadata/v1/",
    // Our own infrastructure.
    "https://localhost/hook",
    "https://127.0.0.1/hook",
    "https://[::1]/hook",
    "https://10.0.0.5/hook",
    "https://192.168.1.1/hook",
    "https://172.16.0.1/hook",
    // Alternate IP encodings that defeat a naive private-range denylist.
    "https://2130706433/hook",
    "https://0x7f000001/hook",
    "https://0177.0.0.1/hook",
  ];
  for (const u of bad) {
    const r = validateClayWebhookUrl(u);
    assert.equal(r.ok, false, `MUST reject ${u}`);
  }
});

test("rejects hosts that merely CONTAIN clay.com", () => {
  // The single most common way this check is written wrong is host.includes("clay.com"),
  // which accepts every one of these and hands over exactly the SSRF the function
  // exists to prevent.
  const bad = [
    "https://clay.com.evil.tld/hook",
    "https://api.clay.com.attacker.io/hook",
    "https://notclay.com/hook",
    "https://myclay.com/hook",
    "https://clay.community/hook",
    "https://evil.tld/?x=api.clay.com",
    "https://evil.tld/api.clay.com/hook",
  ];
  for (const u of bad) {
    const r = validateClayWebhookUrl(u);
    assert.equal(r.ok, false, `MUST reject look-alike host: ${u}`);
  }
});

test("rejects non-https, credentials and port overrides", () => {
  for (const u of [
    "http://api.clay.com/hook", // plaintext
    "ftp://api.clay.com/hook",
    "file:///etc/passwd",
    "javascript:alert(1)",
    "https://user:pass@api.clay.com/hook", // smuggled authority
    "https://api.clay.com:8080/hook", // port override
    "https://evil.tld@api.clay.com/hook".replace("api.clay.com", "evil.tld@api.clay.com"),
  ]) {
    assert.equal(validateClayWebhookUrl(u).ok, false, `MUST reject ${u}`);
  }
});

test("rejects empty, oversized and non-string input", () => {
  for (const u of ["", "   ", null, undefined, 42, {}, []]) {
    assert.equal(validateClayWebhookUrl(u).ok, false, `MUST reject ${JSON.stringify(u)}`);
  }
  assert.equal(
    validateClayWebhookUrl("https://api.clay.com/" + "a".repeat(3000)).ok,
    false,
    "MUST reject an oversized URL",
  );
});

test("normalizes away the fragment but keeps the query", () => {
  const r = validateClayWebhookUrl("https://api.clay.com/hook?a=1#frag");
  assert.ok(r.ok);
  assert.ok(!r.url.includes("#frag"), "fragment should be dropped");
  assert.ok(r.url.includes("a=1"), "query is meaningful to Clay and must survive");
});

test("host matching is case-insensitive", () => {
  assert.ok(validateClayWebhookUrl("https://API.CLAY.COM/hook").ok);
});

test("toClayRow flattens a contact into scalar columns", () => {
  const row = toClayRow({
    id: "42",
    name: "Sagar Tiwari",
    firstName: "Sagar",
    lastName: "Tiwari",
    emails: ["s@x.com", "sagar@y.com"],
    phoneNumbers: ["+15550100005", "+15551234567"],
    company: "Blue Modern Advisory",
    title: "Co-founder",
    city: "New York",
    linkedinUrl: "https://linkedin.com/in/sagar",
    source: "apple",
  });
  // Clay maps webhook JSON to columns by key, so every value must be scalar — a
  // nested object lands in a cell as an unusable blob.
  for (const [k, v] of Object.entries(row)) {
    assert.ok(
      v === null || typeof v === "string",
      `${k} must be a string or null, got ${typeof v}`,
    );
  }
  assert.equal(row.amber_contact_id, "42", "the dedupe key must survive");
  assert.equal(row.email, "s@x.com", "first email becomes the primary column");
  assert.equal(row.emails_all, "s@x.com, sagar@y.com", "extra emails must not be dropped");
  assert.equal(row.phone, "+15550100005");
  assert.equal(row.phones_all, "+15550100005, +15551234567");
});

test("toClayRow does not invent emails_all for a single address", () => {
  const row = toClayRow({ id: "1", name: "A B", emails: ["a@b.com"], phoneNumbers: [] });
  assert.equal(row.emails_all, null, "one email means no redundant all-column");
  assert.equal(row.phones_all, null);
  assert.equal(row.phone, null, "no phones means null, not undefined");
});

test("toClayRow survives a contact with almost nothing on it", () => {
  const row = toClayRow({ id: "1", name: "Solo" });
  assert.equal(row.full_name, "Solo");
  assert.equal(row.email, null);
  assert.equal(row.phone, null);
  assert.equal(row.pushed_from, "amber");
});

test("the default body shape is one flat object per request", () => {
  // Clay's webhook source documents "key-value pairs in the body of a POST request" —
  // a single row. Batching as a JSON array (which most ingest APIs prefer) is the wrong
  // shape here and fails SILENTLY, landing one row of blobs instead of N rows. If this
  // default ever flips back, every push starts producing garbage with no error.
  assert.equal(CLAY_DEFAULT_MODE, "object");
  assert.deepEqual(CLAY_MODES, ["object", "array"]);
});

test("pushRowsToClay sends one object per request in object mode", async () => {
  const seen = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    seen.push(JSON.parse(init.body));
    return new Response("ok", { status: 200 });
  };
  try {
    const rows = [{ full_name: "A" }, { full_name: "B" }, { full_name: "C" }];
    const res = await pushRowsToClay("https://api.clay.com/hook", rows, { concurrency: 2 });
    assert.equal(res.pushed, 3);
    assert.equal(res.failures.length, 0);
    assert.equal(seen.length, 3, "one request per row");
    for (const body of seen) {
      assert.ok(!Array.isArray(body), "each body must be an object, not an array");
      assert.equal(typeof body.full_name, "string");
    }
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("pushRowsToClay batches as an array only when asked", async () => {
  const seen = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    seen.push(JSON.parse(init.body));
    return new Response("ok", { status: 200 });
  };
  try {
    const rows = [{ full_name: "A" }, { full_name: "B" }];
    const res = await pushRowsToClay("https://api.clay.com/hook", rows, { mode: "array" });
    assert.equal(res.pushed, 2);
    assert.equal(seen.length, 1, "one request for the whole batch");
    assert.ok(Array.isArray(seen[0]));
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("a push stops at the first failure instead of hammering Clay", async () => {
  let calls = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    calls += 1;
    // Rate-limited from the very first request.
    return new Response("rate limited", { status: 429 });
  };
  try {
    const rows = Array.from({ length: 50 }, (_, i) => ({ full_name: `P${i}` }));
    const res = await pushRowsToClay("https://api.clay.com/hook", rows, { concurrency: 2 });
    assert.equal(res.pushed, 0);
    assert.ok(res.failures.length > 0);
    // With concurrency 2, at most the in-flight pair should have been sent. The point
    // is that it stopped — not that it sent all 50 and then reported failure.
    assert.ok(calls <= 2, `should stop immediately, made ${calls} requests`);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("an auth token is sent as a Bearer header when configured", async () => {
  let authHeader = null;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    authHeader = init.headers.authorization;
    return new Response("ok", { status: 200 });
  };
  try {
    await pushRowsToClay("https://api.clay.com/hook", [{ full_name: "A" }], {
      authToken: "tok_123",
    });
    assert.equal(authHeader, "Bearer tok_123");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("a redirect is refused rather than followed", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(null, { status: 302 });
  try {
    // validateClayWebhookUrl proves the URL we were GIVEN is Clay; a redirect could
    // point anywhere, so following it would reopen the SSRF the validator closed.
    const res = await pushRowsToClay("https://api.clay.com/hook", [{ full_name: "A" }]);
    assert.equal(res.pushed, 0);
    assert.equal(res.failures[0].error, "clay_redirected");
  } finally {
    globalThis.fetch = realFetch;
  }
});
