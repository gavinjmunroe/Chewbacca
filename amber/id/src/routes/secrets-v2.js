/**
 * Per-tenant secrets v2 routes. Same auth surface as v1 (`x-api-key` via
 * `requireApiKey`), same Firestore substrate, same AES-256-GCM envelope.
 *
 * What v2 adds over v1:
 *   - per-tenant DEK wrapped by an env-only KEK (MEDHA_SECRETS_KEK)
 *   - DEK versioning so rotation re-encrypts in place
 *   - dedicated audit collection (separate from the request-level audit hook)
 *
 *   GET    /v2/secrets/:did/:key       single decrypted value
 *   GET    /v2/secrets/:did/keys       list key names + their DEK version
 *   PUT    /v2/secrets/:did/:key       body { value: string } upsert
 *   DELETE /v2/secrets/:did/:key       remove a single secret
 *   POST   /v2/secrets/:did/rotate-dek rotate DEK, re-encrypt every secret
 *
 * If MEDHA_SECRETS_KEK is unset, every route returns 503 with a stable error
 * code so the v1 surface is unaffected during the rollout.
 */

import { requireApiKey, validateDid } from "../lib/auth.js";
import { isKekConfigured } from "../secrets-v2/crypto.js";
import {
  createDekCache,
  getSecret,
  setSecret,
  deleteSecret,
  listSecretNames,
  rotateDek,
  recordAudit,
} from "../secrets-v2/store.js";

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

function checkKek(reply) {
  if (!isKekConfigured()) {
    reply.code(503).send({
      error: "kek_unconfigured",
      message: "MEDHA_SECRETS_KEK is not set on this deployment",
    });
    return false;
  }
  return true;
}

function callerLabel(request) {
  return (
    request.clientId ||
    request.headers["x-caller"] ||
    request.clientName ||
    "api"
  );
}

async function safeAudit(entry) {
  try {
    await recordAudit(entry);
  } catch {
    // never let audit logging break the data path
  }
}

export function registerSecretsV2(app) {
  app.get(
    "/v2/secrets/:did/keys",
    { preHandler: [requireApiKey] },
    async (request, reply) => {
      if (!checkKek(reply)) return;
      const { did } = request.params;
      if (!checkDid(reply, did)) return;
      try {
        const keys = await listSecretNames(did);
        return { did, keys };
      } catch (err) {
        reply.code(500);
        return { error: err.message };
      }
    },
  );

  app.get(
    "/v2/secrets/:did/:key",
    { preHandler: [requireApiKey] },
    async (request, reply) => {
      if (!checkKek(reply)) return;
      const { did, key } = request.params;
      if (!checkDid(reply, did)) return;
      if (!checkKey(reply, key)) return;
      const dekCache = createDekCache();
      try {
        const value = await getSecret(did, key, { dekCache });
        await safeAudit({
          tenantDid: did,
          keyName: key,
          action: "read",
          caller: callerLabel(request),
        });
        return { did, key, value };
      } catch (err) {
        reply.code(500);
        return { error: err.message };
      }
    },
  );

  app.put(
    "/v2/secrets/:did/:key",
    { preHandler: [requireApiKey] },
    async (request, reply) => {
      if (!checkKek(reply)) return;
      const { did, key } = request.params;
      if (!checkDid(reply, did)) return;
      if (!checkKey(reply, key)) return;
      const body = request.body || {};
      if (typeof body.value !== "string") {
        reply.code(400);
        return { error: "value must be a string" };
      }
      const dekCache = createDekCache();
      try {
        const out = await setSecret(did, key, body.value, { dekCache });
        await safeAudit({
          tenantDid: did,
          keyName: key,
          action: "write",
          caller: callerLabel(request),
        });
        return out;
      } catch (err) {
        reply.code(500);
        return { error: err.message };
      }
    },
  );

  app.delete(
    "/v2/secrets/:did/:key",
    { preHandler: [requireApiKey] },
    async (request, reply) => {
      if (!checkKek(reply)) return;
      const { did, key } = request.params;
      if (!checkDid(reply, did)) return;
      if (!checkKey(reply, key)) return;
      try {
        const out = await deleteSecret(did, key);
        await safeAudit({
          tenantDid: did,
          keyName: key,
          action: "delete",
          caller: callerLabel(request),
        });
        return out;
      } catch (err) {
        reply.code(500);
        return { error: err.message };
      }
    },
  );

  app.post(
    "/v2/secrets/:did/rotate-dek",
    { preHandler: [requireApiKey] },
    async (request, reply) => {
      if (!checkKek(reply)) return;
      const { did } = request.params;
      if (!checkDid(reply, did)) return;
      const dekCache = createDekCache();
      try {
        const out = await rotateDek(did, { dekCache });
        await safeAudit({
          tenantDid: did,
          keyName: null,
          action: "rotate_dek",
          caller: callerLabel(request),
        });
        return out;
      } catch (err) {
        reply.code(500);
        return { error: err.message };
      }
    },
  );
}
