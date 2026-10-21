/**
 * The profile voice bio — the decisions the route makes on its own.
 *
 * What matters here is not the happy path (three legs, verified size) but the
 * three places this could leak or lie:
 *
 *   - AN UNCONNECTED CALLER GETS 404, indistinguishable from "there is no clip"
 *     and from "that is not even a uuid". A 403 would answer the question
 *     "has this person recorded a voice bio", which is the question the
 *     authorization exists to refuse.
 *   - REACH IS CHECKED BEFORE THE ROW IS READ. Same status either way, but
 *     reading first and checking second leaks existence through timing and
 *     through the log line it would write.
 *   - FINALIZE TRUSTS THE BUCKET, NOT THE CLIENT. An oversized object is
 *     deleted and the row with it, rather than recorded at the size the client
 *     claimed.
 *
 * Run with:  node --test src/routes/voice-bio.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";

import { registerVoiceBioRoutes } from "./voice-bio.js";

const PHONE = "+13105550100";
const ME = "aaaaaaaa-1111-2222-3333-444444444444";
const THEM = "bbbbbbbb-1111-2222-3333-444444444444";

const READY = {
  owner_id: THEM,
  storage_key: `voice-bios/${THEM}/abc.m4a`,
  content_type: "audio/m4a",
  duration_ms: 14_000,
  byte_size: 90_000,
  peaks: [1, 2, 3],
  status: "ready",
  created_at: "2026-09-01T00:00:00.000Z",
  updated_at: "2026-09-01T00:00:00.000Z",
};

function build(overrides = {}) {
  const app = Fastify({ logger: false });
  const calls = { reads: [], reserved: [], ready: [], removed: [], deletedObjects: [] };
  registerVoiceBioRoutes(app, {
    requireAuth: async (request) => {
      request.privyUser = { userId: "did:privy:abc", phone: PHONE };
    },
    resolveAmberIdByPhone: async () => ME,
    gcsConfigured: () => true,
    signGcsUrl: ({ objectName, method }) => `https://signed/${method}/${objectName}`,
    statGcsObject: async () => ({ exists: true, size: 90_000 }),
    deleteGcsObject: async (key) => {
      calls.deletedObjects.push(key);
    },
    canHearBio: async () => true,
    getBioRow: async (owner) => {
      calls.reads.push(owner);
      return { ...READY, owner_id: owner };
    },
    reserveBioUpload: async (owner) => {
      calls.reserved.push(owner);
      return `voice-bios/${owner}/new.m4a`;
    },
    markBioReady: async (owner, args) => {
      calls.ready.push({ owner, args });
      return true;
    },
    deleteBio: async (owner) => {
      calls.removed.push(owner);
      return true;
    },
    ...overrides,
  });
  return { app, calls };
}

test("upload-url mints a server-owned key", async () => {
  const { app, calls } = build();
  const res = await app.inject({ method: "POST", url: "/v1/me/voice-bio/upload-url" });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.match(body.uploadUrl, /^https:\/\/signed\/PUT\/voice-bios\//);
  // The caller's OWN id is in the path, and the caller never supplied it.
  assert.deepEqual(calls.reserved, [ME]);
  assert.equal(body.contentType, "audio/m4a");
});

test("finalize records the size the BUCKET reported, not the client's", async () => {
  const { app, calls } = build({ statGcsObject: async () => ({ exists: true, size: 123_456 }) });
  const res = await app.inject({
    method: "POST",
    url: "/v1/me/voice-bio",
    payload: { durationMs: 12_000, peaks: [4, 5, 6] },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().byteSize, 123_456);
  assert.equal(calls.ready[0].args.byteSize, 123_456);
});

test("finalize refuses a clip that never uploaded", async () => {
  const { app, calls } = build({ statGcsObject: async () => ({ exists: false }) });
  const res = await app.inject({ method: "POST", url: "/v1/me/voice-bio", payload: {} });
  assert.equal(res.statusCode, 409);
  assert.equal(calls.ready.length, 0);
});

test("finalize deletes an oversized object AND its row", async () => {
  const { app, calls } = build({
    statGcsObject: async () => ({ exists: true, size: 999_999_999 }),
  });
  const res = await app.inject({ method: "POST", url: "/v1/me/voice-bio", payload: {} });
  assert.equal(res.statusCode, 413);
  assert.equal(calls.deletedObjects.length, 1);
  assert.deepEqual(calls.removed, [ME]);
  assert.equal(calls.ready.length, 0);
});

test("GET /v1/me/voice-bio with nothing recorded is 200 and bio:null", async () => {
  // An ordinary state of a profile the caller certainly owns. A 404 here would
  // be indistinguishable from a real failure.
  const { app } = build({ getBioRow: async () => null });
  const res = await app.inject({ method: "GET", url: "/v1/me/voice-bio" });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().bio, null);
});

test("GET /v1/me/voice-bio hands back a signed URL and the owner's peaks", async () => {
  const { app } = build();
  const res = await app.inject({ method: "GET", url: "/v1/me/voice-bio" });
  assert.equal(res.statusCode, 200);
  const bio = res.json().bio;
  assert.match(bio.url, /^https:\/\/signed\/GET\/voice-bios\//);
  assert.deepEqual(bio.peaks, [1, 2, 3]);
  assert.equal(bio.durationMs, 14_000);
});

test("DELETE removes the object BEFORE the row", async () => {
  // The other order leaves an orphan object in the bucket that nothing points
  // at and nothing will ever clean up.
  const order = [];
  const { app } = build({
    deleteGcsObject: async () => {
      order.push("object");
    },
    deleteBio: async () => {
      order.push("row");
      return true;
    },
  });
  const res = await app.inject({ method: "DELETE", url: "/v1/me/voice-bio" });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(order, ["object", "row"]);
});

test("a connection can listen", async () => {
  const { app } = build();
  const res = await app.inject({ method: "GET", url: `/v1/profiles/${THEM}/voice-bio` });
  assert.equal(res.statusCode, 200);
  assert.match(res.json().bio.url, /^https:\/\/signed\/GET\//);
});

test("someone who is NOT connected gets 404, and the row is never read", async () => {
  const { app, calls } = build({ canHearBio: async () => false });
  const res = await app.inject({ method: "GET", url: `/v1/profiles/${THEM}/voice-bio` });
  assert.equal(res.statusCode, 404);
  assert.equal(res.json().error, "no_voice_bio");
  // REACH FIRST, ROW SECOND. Reading the row first and checking reach after is
  // the same status with a timing difference that says whether it exists.
  assert.equal(calls.reads.length, 0);
});

test("a person with no clip and a stranger get the SAME answer", async () => {
  const connectedNoClip = build({ getBioRow: async () => null });
  const stranger = build({ canHearBio: async () => false });
  const a = await connectedNoClip.app.inject({
    method: "GET",
    url: `/v1/profiles/${THEM}/voice-bio`,
  });
  const b = await stranger.app.inject({
    method: "GET",
    url: `/v1/profiles/${THEM}/voice-bio`,
  });
  assert.equal(a.statusCode, 404);
  assert.equal(b.statusCode, 404);
  // Byte-identical, so the response cannot answer "has this person recorded
  // one" -- which is the question the authorization exists to refuse.
  assert.deepEqual(a.json(), b.json());
});

test("a malformed owner id gets that same answer too", async () => {
  const { app, calls } = build();
  const res = await app.inject({ method: "GET", url: "/v1/profiles/not-a-uuid/voice-bio" });
  assert.equal(res.statusCode, 404);
  assert.equal(res.json().error, "no_voice_bio");
  assert.equal(calls.reads.length, 0);
});

test("storage not configured says so rather than pretending there is no clip", async () => {
  const { app } = build({ gcsConfigured: () => false });
  const res = await app.inject({ method: "POST", url: "/v1/me/voice-bio/upload-url" });
  assert.equal(res.statusCode, 503);
  assert.equal(res.json().error, "audio_storage_unconfigured");
});
