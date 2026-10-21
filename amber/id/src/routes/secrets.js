/**
 * Per-user secret store routes. All routes require the server-to-server API
 * key (same as /v1/data). Writes are mirrored to the audit log via the
 * onResponse hook in src/index.js.
 *
 *   GET    /v1/secrets/:did             full decrypted bag (admin only)
 *   GET    /v1/secrets/:did/keys        list key names + whether set
 *   GET    /v1/secrets/:did/:key        single decrypted value
 *   POST   /v1/secrets/:did             body = { <key>: <value>, ... } upsert
 *   PUT    /v1/secrets/:did/:key        body = { value: <string> } upsert one key
 *   POST   /v1/secrets/:did/scaffold    body = { keys: [...] } creates empty slots
 *   DELETE /v1/secrets/:did/:key        clear one key
 *   DELETE /v1/secrets/:did             clear entire doc
 */

import { requireApiKey, validateDid } from "../lib/auth.js";
import {
  getSecrets,
  getSecret,
  setSecrets,
  deleteSecrets,
  scaffoldSecrets,
  listSecretKeys,
} from "../db/secrets.js";

// Secret keys are user-supplied; clamp to identifier-shape so they can never
// embed slashes / control bytes that would address a different Firestore doc.
const KEY_RE = /^[A-Za-z0-9_.\-]{1,128}$/;

function checkDid(reply, did) {
  const err = validateDid(did);
  if (err) {
    reply.code(400).send({ error: "invalid_did", message: err });
    return false;
  }
  return true;
}

function checkKey(reply, key) {
  if (typeof key !== "string" || !KEY_RE.test(key)) {
    reply.code(400).send({
      error: "invalid_key",
      message: "secret key must match [A-Za-z0-9_.-]{1,128}",
    });
    return false;
  }
  return true;
}

export function registerSecretsRoutes(app) {
  app.get(
    "/v1/secrets/:did",
    { preHandler: [requireApiKey] },
    async (request, reply) => {
      const { did } = request.params;
      if (!checkDid(reply, did)) return;
      try {
        const values = await getSecrets(did);
        return { did, values };
      } catch (err) {
        reply.code(400);
        return { error: err.message };
      }
    },
  );

  app.get(
    "/v1/secrets/:did/keys",
    { preHandler: [requireApiKey] },
    async (request, reply) => {
      const { did } = request.params;
      if (!checkDid(reply, did)) return;
      try {
        const keys = await listSecretKeys(did);
        return { did, keys };
      } catch (err) {
        reply.code(400);
        return { error: err.message };
      }
    },
  );

  app.get(
    "/v1/secrets/:did/:key",
    { preHandler: [requireApiKey] },
    async (request, reply) => {
      const { did, key } = request.params;
      if (!checkDid(reply, did)) return;
      if (!checkKey(reply, key)) return;
      try {
        const value = await getSecret(did, key);
        return { did, key, value };
      } catch (err) {
        reply.code(400);
        return { error: err.message };
      }
    },
  );

  app.post(
    "/v1/secrets/:did",
    { preHandler: [requireApiKey] },
    async (request, reply) => {
      const { did } = request.params;
      if (!checkDid(reply, did)) return;
      try {
        const record = request.body || {};
        if (typeof record !== "object" || Array.isArray(record)) {
          reply.code(400);
          return { error: "body must be an object of {key: value}" };
        }
        for (const k of Object.keys(record)) {
          if (!KEY_RE.test(k)) {
            reply.code(400);
            return {
              error: "invalid_key",
              message: `secret key "${k}" must match [A-Za-z0-9_.-]{1,128}`,
            };
          }
        }
        const out = await setSecrets(did, record, {
          updatedBy: request.headers["x-caller"] || "api",
        });
        return out;
      } catch (err) {
        reply.code(400);
        return { error: err.message };
      }
    },
  );

  // PUT /v1/secrets/:did/:key — single-key upsert.
  //
  // Body: { value: <string> }. Returns { ok: true, updatedKeys: ["<key>"] }.
  //
  // Why this exists: medha-platform's per-service OAuth clients (gmail.js,
  // gcal/client.js, twitter.js, railway/client.js, etc) cache refreshed
  // access tokens back to amber-id with PUT /v1/secrets/:did/:key. Without
  // this handler, every cache-write returned 404 and every subsequent tool
  // call re-refreshed against the upstream provider — slower, and a
  // rate-limit risk against Google/Twitter/Railway token endpoints.
  // The v2 surface (/v2/secrets/:did/:key) already supports PUT but the
  // agent callers all hit /v1; rather than migrate every caller, mirror
  // the v1 GET/DELETE pattern with the matching PUT here.
  app.put(
    "/v1/secrets/:did/:key",
    { preHandler: [requireApiKey] },
    async (request, reply) => {
      const { did, key } = request.params;
      if (!checkDid(reply, did)) return;
      if (!checkKey(reply, key)) return;
      const body = request.body || {};
      if (typeof body.value !== "string" && body.value !== null) {
        reply.code(400);
        return {
          error: "invalid_body",
          message: "body.value must be a string (or null to clear)",
        };
      }
      try {
        const out = await setSecrets(
          did,
          { [key]: body.value },
          { updatedBy: request.headers["x-caller"] || "api" },
        );
        return out;
      } catch (err) {
        reply.code(400);
        return { error: err.message };
      }
    },
  );

  app.post(
    "/v1/secrets/:did/scaffold",
    { preHandler: [requireApiKey] },
    async (request, reply) => {
      const { did } = request.params;
      if (!checkDid(reply, did)) return;
      try {
        const keys = request.body?.keys;
        if (!Array.isArray(keys) || keys.length === 0) {
          reply.code(400);
          return { error: "body.keys must be a non-empty array" };
        }
        for (const k of keys) {
          if (typeof k !== "string" || !KEY_RE.test(k)) {
            reply.code(400);
            return {
              error: "invalid_key",
              message: `scaffold key "${k}" must match [A-Za-z0-9_.-]{1,128}`,
            };
          }
        }
        const out = await scaffoldSecrets(did, keys, {
          updatedBy: request.headers["x-caller"] || "api",
        });
        return out;
      } catch (err) {
        reply.code(400);
        return { error: err.message };
      }
    },
  );

  app.delete(
    "/v1/secrets/:did/:key",
    { preHandler: [requireApiKey] },
    async (request, reply) => {
      const { did, key } = request.params;
      if (!checkDid(reply, did)) return;
      if (!checkKey(reply, key)) return;
      try {
        const out = await deleteSecrets(did, [key]);
        return out;
      } catch (err) {
        reply.code(400);
        return { error: err.message };
      }
    },
  );

  app.delete(
    "/v1/secrets/:did",
    { preHandler: [requireApiKey] },
    async (request, reply) => {
      const { did } = request.params;
      if (!checkDid(reply, did)) return;
      try {
        const out = await deleteSecrets(did);
        return out;
      } catch (err) {
        reply.code(400);
        return { error: err.message };
      }
    },
  );
}
