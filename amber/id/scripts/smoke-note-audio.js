/**
 * End-to-end smoke test for the voice-note audio pathway, from a terminal.
 *
 *   railway run node scripts/smoke-note-audio.js
 *
 * Proves the whole storage path works BEFORE any app code depends on it:
 *
 *   1. config       — the bucket and a usable signing identity are present
 *   2. signed PUT   — upload real bytes with the pinned content type
 *   3. wrong type   — the SAME url with a different content type is REJECTED
 *   4. signed HEAD  — the server can verify size/type without an OAuth token
 *   5. signed GET   — the bytes come back byte-identical
 *   6. no public    — the object is NOT readable without a signature
 *   7. expiry       — an already-expired signature is refused
 *   8. cleanup      — the test object is deleted
 *
 * Touches only its own smoke-test/ prefix and deletes what it creates. Read-only
 * with respect to the database — this never opens a Cloud SQL connection.
 */

import crypto from "node:crypto";
import {
  deleteGcsObject,
  gcsConfig,
  gcsConfigured,
  signGcsUrl,
  statGcsObject,
} from "../src/lib/gcs-signing.js";

const PASS = "✓";
const FAIL = "✗";
let failures = 0;

function ok(label, extra = "") {
  console.log(`${PASS} ${label}${extra ? ` — ${extra}` : ""}`);
}
function bad(label, extra = "") {
  failures += 1;
  console.error(`${FAIL} ${label}${extra ? ` — ${extra}` : ""}`);
}

// A plausible clip: 64KB of noise. Content is irrelevant to the storage path, and
// generating it here keeps the test from depending on a fixture file.
const BYTES = crypto.randomBytes(64 * 1024);
const KEY = `smoke-test/${crypto.randomUUID()}.m4a`;
const CONTENT_TYPE = "audio/m4a";

// 1. Configuration
if (!gcsConfigured()) {
  const { bucket, clientEmail, privateKey } = gcsConfig();
  bad("configuration", "GCS is not configured");
  console.error(`   GCS_NOTE_AUDIO_BUCKET  ${bucket ? "set" : "MISSING"}`);
  console.error(`   signing identity       ${clientEmail || "MISSING"}`);
  console.error(`   private key            ${privateKey ? "present" : "MISSING"}`);
  console.error(
    "\n   Set GCS_NOTE_AUDIO_BUCKET in Railway. The signing identity is read from\n" +
      "   GCS_SA_CLIENT_EMAIL/GCS_SA_PRIVATE_KEY if present, otherwise from the\n" +
      "   GOOGLE_APPLICATION_CREDENTIALS_JSON already used for Cloud SQL.",
  );
  process.exit(1);
}
const cfg = gcsConfig();
ok("configuration", `bucket=${cfg.bucket} signer=${cfg.clientEmail}`);

// 2. Signed PUT with the pinned content type
const uploadUrl = signGcsUrl({
  objectName: KEY,
  method: "PUT",
  contentType: CONTENT_TYPE,
  expiresSeconds: 600,
});
{
  const res = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "content-type": CONTENT_TYPE },
    body: BYTES,
  });
  if (res.ok) ok("signed PUT", `${BYTES.length} bytes uploaded`);
  else bad("signed PUT", `HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
}

// 3. The same signed URL must NOT accept a different content type. This is the
//    property that stops a signed audio upload from being reused to plant HTML.
{
  const res = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "content-type": "text/html" },
    body: "<html>nope</html>",
  });
  if (res.ok) bad("content-type is pinned", "a text/html PUT was ACCEPTED on an audio/m4a signature");
  else ok("content-type is pinned", `text/html rejected with HTTP ${res.status}`);
}

// 4. Signed HEAD — what finalize uses to verify the upload
{
  try {
    const stat = await statGcsObject(KEY);
    if (!stat.exists) bad("signed HEAD", "object reported missing");
    else if (stat.size !== BYTES.length) bad("signed HEAD", `size ${stat.size} != ${BYTES.length}`);
    else ok("signed HEAD", `size=${stat.size} type=${stat.contentType}`);
  } catch (e) {
    bad("signed HEAD", e?.message);
  }
}

// 5. Signed GET — playback, byte-for-byte
{
  const playbackUrl = signGcsUrl({ objectName: KEY, method: "GET", expiresSeconds: 300 });
  const res = await fetch(playbackUrl);
  if (!res.ok) {
    bad("signed GET", `HTTP ${res.status}`);
  } else {
    const back = Buffer.from(await res.arrayBuffer());
    if (back.length !== BYTES.length || !back.equals(BYTES)) {
      bad("signed GET", `got ${back.length} bytes, not identical`);
    } else {
      ok("signed GET", `${back.length} bytes, byte-identical`);
    }
  }
}

// 6. The object must NOT be readable unsigned. If this passes, the bucket is
//    public and every voice note in it is public with it.
{
  const publicUrl = `https://storage.googleapis.com/${cfg.bucket}/${KEY}`;
  const res = await fetch(publicUrl);
  if (res.ok) bad("bucket is private", "the object is readable with NO signature — bucket is public");
  else ok("bucket is private", `unsigned GET refused with HTTP ${res.status}`);
}

// 7. An expired signature must be refused. Signed a minute in the past with a
//    30s lifetime, so it is already dead on arrival.
{
  const staleUrl = signGcsUrl({
    objectName: KEY,
    method: "GET",
    expiresSeconds: 30,
    now: new Date(Date.now() - 60_000),
  });
  const res = await fetch(staleUrl);
  if (res.ok) bad("expiry is enforced", "an expired signature still worked");
  else ok("expiry is enforced", `expired signature refused with HTTP ${res.status}`);
}

// 8. Cleanup
{
  const gone = await deleteGcsObject(KEY);
  if (gone) ok("cleanup", `deleted ${KEY}`);
  else bad("cleanup", `could not delete ${KEY} — remove it by hand`);
}

console.log("");
if (failures > 0) {
  console.error(`${failures} check(s) failed. The audio pathway is NOT ready.`);
  process.exit(1);
}
console.log("All checks passed. The audio pathway is live.");
process.exit(0);
