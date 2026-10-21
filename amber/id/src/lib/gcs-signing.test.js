/**
 * Signing correctness, without a network or a real service account.
 *
 * The V4 canonical request is the kind of thing that is either exactly right or
 * silently 403s in production, and you cannot tell by reading it. So this test
 * generates a throwaway RSA key, signs a URL, then RECONSTRUCTS the
 * string-to-sign independently and verifies the signature against it with the
 * public key. If the canonical request ever drifts, this fails here instead of at
 * a user's playback button.
 */

import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});

process.env.GCS_NOTE_AUDIO_BUCKET = "amber-note-audio-test";
process.env.GCS_SA_CLIENT_EMAIL = "signer@amber-test.iam.gserviceaccount.com";
process.env.GCS_SA_PRIVATE_KEY = privateKey;

const { signGcsUrl, gcsConfigured, encodeObjectPath } = await import("./gcs-signing.js");

const FIXED_NOW = new Date("2026-08-17T12:00:00.000Z");
const OBJECT = "notes/11111111-2222-3333-4444-555555555555/conv_1/abc.m4a";

test("gcsConfigured is true once the three env vars are present", () => {
  assert.equal(gcsConfigured(), true);
});

test("object paths keep their slashes but encode each segment", () => {
  assert.equal(encodeObjectPath("a/b c/d.m4a"), "a/b%20c/d.m4a");
  assert.equal(encodeObjectPath("a/(b)/c"), "a/%28b%29/c");
});

test("a signed GET URL carries the required V4 query params", () => {
  const url = signGcsUrl({ objectName: OBJECT, method: "GET", now: FIXED_NOW });
  const u = new URL(url);
  assert.equal(u.host, "storage.googleapis.com");
  assert.equal(u.pathname, `/amber-note-audio-test/${OBJECT}`);
  assert.equal(u.searchParams.get("X-Goog-Algorithm"), "GOOG4-RSA-SHA256");
  assert.equal(u.searchParams.get("X-Goog-Date"), "20260817T120000Z");
  assert.equal(u.searchParams.get("X-Goog-Expires"), "300");
  assert.equal(u.searchParams.get("X-Goog-SignedHeaders"), "host");
  assert.match(
    u.searchParams.get("X-Goog-Credential"),
    /^signer@amber-test\.iam\.gserviceaccount\.com\/20260817\/auto\/storage\/goog4_request$/,
  );
  assert.ok(u.searchParams.get("X-Goog-Signature"));
});

test("the signature verifies against an independently rebuilt string-to-sign", () => {
  const url = signGcsUrl({ objectName: OBJECT, method: "GET", now: FIXED_NOW });
  const u = new URL(url);
  const signature = u.searchParams.get("X-Goog-Signature");

  // Rebuild the canonical query WITHOUT the signature, in sorted order.
  const params = [...u.searchParams.entries()].filter(([k]) => k !== "X-Goog-Signature");
  params.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const canonicalQuery = params
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");

  const canonicalRequest = [
    "GET",
    `/amber-note-audio-test/${OBJECT}`,
    canonicalQuery,
    "host:storage.googleapis.com\n",
    "host",
    "UNSIGNED-PAYLOAD",
  ].join("\n");

  const stringToSign = [
    "GOOG4-RSA-SHA256",
    "20260817T120000Z",
    "20260817/auto/storage/goog4_request",
    crypto.createHash("sha256").update(canonicalRequest).digest("hex"),
  ].join("\n");

  const ok = crypto
    .createVerify("RSA-SHA256")
    .update(stringToSign)
    .verify(publicKey, Buffer.from(signature, "hex"));
  assert.equal(ok, true, "signature must verify against the rebuilt string-to-sign");
});

test("an upload URL pins the content type into the signature", () => {
  const url = signGcsUrl({
    objectName: OBJECT,
    method: "PUT",
    contentType: "audio/m4a",
    now: FIXED_NOW,
  });
  const u = new URL(url);
  // content-type is a SIGNED header, so a client cannot reuse this URL to PUT
  // HTML into the bucket.
  assert.equal(u.searchParams.get("X-Goog-SignedHeaders"), "content-type;host");
});

test("expiry is clamped to GCS's 7-day ceiling", () => {
  const url = signGcsUrl({ objectName: OBJECT, expiresSeconds: 99_999_999, now: FIXED_NOW });
  assert.equal(new URL(url).searchParams.get("X-Goog-Expires"), "604800");
});

test("signing without configuration throws rather than emitting a bad URL", async () => {
  const saved = process.env.GCS_SA_PRIVATE_KEY;
  process.env.GCS_SA_PRIVATE_KEY = "";
  // Re-import with a cache-busting query so the module re-reads the env.
  const fresh = await import(`./gcs-signing.js?nokey=${Date.now()}`);
  assert.equal(fresh.gcsConfigured(), false);
  assert.throws(() => fresh.signGcsUrl({ objectName: OBJECT }), /gcs_not_configured/);
  process.env.GCS_SA_PRIVATE_KEY = saved;
});

// ── The credentials fallback ───────────────────────────────────────────────────
// Reusing the Cloud SQL service account is the DEFAULT setup path, so it gets the
// same coverage as the explicit one.

test("signs from GOOGLE_APPLICATION_CREDENTIALS_JSON when no GCS_SA_* is set", async () => {
  process.env.GCS_NOTE_AUDIO_BUCKET = "amber-fallback-test";
  delete process.env.GCS_SA_CLIENT_EMAIL;
  delete process.env.GCS_SA_PRIVATE_KEY;
  process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON = JSON.stringify({
    client_email: "cloudsql@amber.iam.gserviceaccount.com",
    // Railway commonly stores the PEM with escaped newlines inside the JSON.
    private_key: privateKey.replace(/\n/g, "\\n"),
  });
  const m = await import(`./gcs-signing.js?fallback=${Date.now()}`);
  assert.equal(m.gcsConfigured(), true);
  const url = m.signGcsUrl({ objectName: "notes/a/b/c.m4a" });
  assert.match(new URL(url).searchParams.get("X-Goog-Credential"), /^cloudsql@amber/);
});

test("malformed credentials JSON reports unconfigured instead of throwing at import", async () => {
  process.env.GCS_NOTE_AUDIO_BUCKET = "amber-fallback-test";
  delete process.env.GCS_SA_CLIENT_EMAIL;
  delete process.env.GCS_SA_PRIVATE_KEY;
  process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON = "{not json";
  const m = await import(`./gcs-signing.js?bad=${Date.now()}`);
  assert.equal(m.gcsConfigured(), false);
});
