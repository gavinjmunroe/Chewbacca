/**
 * /v1/content-seeds/* — raw-content capture + polish-result writeback.
 *
 * A content_seed is the typed Firestore object that holds raw newsletter /
 * LinkedIn / Twitter material before the agent polishes it. The polish work
 * itself runs in medha-platform (Tab 12's edit_for_newsletter loop) — this
 * surface only stores capture + writes back the result.
 *
 * Auth mirrors /v1/personal/*: Privy JWT (user-scoped) or service x-api-key
 * paired with x-amber-phone. Tenant DID always comes from the verified
 * principal; body-level userId fields are rejected with principal_mismatch
 * so a stolen JWT can't be used to write into someone else's namespace.
 */

import { tenantIndex as defaultTenantIndex } from "../lib/auth-session.js";
import {
  requireApiKeyOrAuth as defaultRequireApiKeyOrAuth,
  validatePhone,
} from "../lib/auth.js";
import * as firestoreDefaults from "../db/agent-data.js";
import { extractClaimedDid } from "../lib/claimed-did.js";
import {
  SEED_ORGS,
  SEED_INTENTS,
  SEED_SECTIONS,
  SEED_STATUSES,
  normalizeContentSeed,
  upsertContentSeed,
  getContentSeed,
  listContentSeeds,
  applyPolishResult,
} from "../db/content-seeds.js";
// THE EXTERNAL INDEX IS GONE. These were best-effort writes and reads against a
// separate vector service that held a second copy of this data. Observations
// carry their own pgvector embedding and retrieval.js searches it in-database, so
// the second copy was the sprawl this rebuild removed. The dependency-injection
// seams stay so tests and any future in-database indexer can slot straight in;
// the defaults now do nothing and say so.
const _noIndex = async () => ({ indexed: false, reason: "external_index_removed" });
const _noSearch = async () => [];
const defaultIndexContentSeed = _noIndex;
const defaultSearchContentSeeds = _noSearch;

async function resolvePrincipal(request, reply, tenantIndex) {
  let privyDid = request.privyUser?.userId;
  const rawHeaderPhone = request.headers["x-amber-phone"];
  const headerPhone = Array.isArray(rawHeaderPhone)
    ? rawHeaderPhone[0]
    : rawHeaderPhone;

  if (!privyDid && request.serviceAuth) {
    if (!headerPhone) {
      reply.code(400).send({
        error: "x-amber-phone header required when using service auth",
        code: "missing_phone_header",
      });
      return null;
    }
    const phoneErr = validatePhone(headerPhone);
    if (phoneErr) {
      reply.code(400).send({
        error: "invalid_phone_header",
        code: "invalid_phone",
        message: phoneErr,
      });
      return null;
    }
    const tenant = tenantIndex.getByPhone(headerPhone);
    if (!tenant) {
      reply.code(404).send({
        error: `No tenant found for phone ${headerPhone}`,
        code: "tenant_not_found",
      });
      return null;
    }
    privyDid = tenant.id || tenant.privyUserId;
  } else if (privyDid && headerPhone) {
    const phoneTenant = tenantIndex.getByPhone(headerPhone);
    const phoneDid = phoneTenant?.id || phoneTenant?.privyUserId || null;
    if (phoneDid && phoneDid !== privyDid) {
      reply.code(403).send({
        error: "principal_mismatch",
        message:
          "x-amber-phone header resolves to a different DID than the bearer token",
      });
      return null;
    }
  }

  if (!privyDid) {
    reply.code(401).send({ error: "auth_required" });
    return null;
  }

  const claimedDid = extractClaimedDid(request.body);
  if (claimedDid && claimedDid !== privyDid) {
    reply.code(403).send({
      error: "principal_mismatch",
      message: "Body userId/did does not match the authenticated principal",
    });
    return null;
  }

  return { privyDid };
}

function sendValidationError(reply, err) {
  return reply.code(err.statusCode || 400).send({
    error: err.code || "validation_failed",
    message: err.message || "validation failed",
  });
}

/**
 * Fire-and-forget Pinecone indexing. Logged on failure so an outage of the
 * vector store doesn't fail the write path, but is still observable. Mirrors
 * the helper in routes/personal-life.js.
 */
function indexAsync(indexRow, app, privyDid, row) {
  indexRow(privyDid, row)
    .then((result) => {
      if (
        !result?.indexed &&
        result?.reason &&
        result.reason !== "pinecone_unavailable"
      ) {
        app.log.warn(
          { reason: result.reason, kind: row.kind, id: row.id },
          "[content-seeds] pinecone index did not complete",
        );
      }
    })
    .catch((err) => {
      app.log.warn(
        { err: err?.message, kind: row.kind, id: row.id },
        "[content-seeds] pinecone index threw",
      );
    });
}

const createSeedSchema = {
  type: "object",
  properties: {
    raw_text: { type: "string", maxLength: 32000 },
    source_url: { type: "string", maxLength: 2000 },
    author_slug: { type: "string", minLength: 1, maxLength: 80 },
    org: { type: "string", enum: SEED_ORGS },
    intent: { type: "string", enum: SEED_INTENTS },
    section_hint: { type: "string", enum: SEED_SECTIONS },
  },
  required: ["author_slug", "org", "intent"],
  additionalProperties: false,
};

const polishSchema = {
  type: "object",
  properties: {
    polished_draft: { type: "string", maxLength: 64000 },
    polish_score: { type: "number" },
    doctrine_violations: {
      type: "array",
      items: { type: "string", maxLength: 600 },
      maxItems: 50,
    },
    drive_doc_url: { type: "string", maxLength: 2000 },
    status: { type: "string", enum: SEED_STATUSES },
  },
  additionalProperties: false,
};

export function registerContentSeedsRoutes(app, deps = {}) {
  const agentDataGet = deps.agentDataGet || firestoreDefaults.agentDataGet;
  const agentDataUpsert =
    deps.agentDataUpsert || firestoreDefaults.agentDataUpsert;
  const agentDataQuery =
    deps.agentDataQuery || firestoreDefaults.agentDataQuery;
  const requireApiKeyOrAuth =
    deps.requireApiKeyOrAuth || defaultRequireApiKeyOrAuth;
  const tenantIndex = deps.tenantIndex || defaultTenantIndex;
  const indexContentSeed = deps.indexContentSeed || defaultIndexContentSeed;
  const searchContentSeeds =
    deps.searchContentSeeds || defaultSearchContentSeeds;
  const firestoreDeps = { agentDataGet, agentDataUpsert, agentDataQuery };

  // ─── create ─────────────────────────────────────────────────────────────

  app.post(
    "/v1/content-seeds",
    {
      preHandler: [requireApiKeyOrAuth],
      schema: { body: createSeedSchema },
    },
    async (request, reply) => {
      const ctx = await resolvePrincipal(request, reply, tenantIndex);
      if (!ctx) return;
      let row;
      try {
        row = normalizeContentSeed(request.body, { privyDid: ctx.privyDid });
      } catch (err) {
        return sendValidationError(reply, err);
      }
      const stored = await upsertContentSeed(ctx.privyDid, row, firestoreDeps);
      indexAsync(indexContentSeed, app, ctx.privyDid, stored);
      return reply.code(201).send({ ok: true, content_seed: stored });
    },
  );

  // ─── list ───────────────────────────────────────────────────────────────

  app.get(
    "/v1/content-seeds",
    { preHandler: [requireApiKeyOrAuth] },
    async (request, reply) => {
      const ctx = await resolvePrincipal(request, reply, tenantIndex);
      if (!ctx) return;
      const q = request.query || {};
      const semantic =
        q.semantic === "true" || q.semantic === "1" || q.semantic === true;
      const queryText =
        q.q != null ? String(q.q) : q.text ? String(q.text) : "";

      // Semantic recall: route through Pinecone instead of Firestore exact
      // match. Author/org filters still apply as metadata filters so
      // "pieces about the funnel observation written by Sagar" works.
      if (semantic && queryText.trim()) {
        const filter = {};
        if (q.author_slug) filter.author_slug = String(q.author_slug);
        if (q.org) filter.org = String(q.org).toLowerCase();
        if (q.intent) filter.intent = String(q.intent).toLowerCase();
        if (q.status) filter.status = String(q.status).toLowerCase();
        const matches = await searchContentSeeds(ctx.privyDid, {
          query: queryText,
          filter: Object.keys(filter).length ? filter : undefined,
          topK: 12,
        });
        if (matches.length > 0) {
          return {
            ok: true,
            source: "pinecone",
            count: matches.length,
            matches,
          };
        }
        // Pinecone unavailable or no hits: fall through to the Firestore
        // listing below so the caller still gets something useful.
      }

      try {
        const rows = await listContentSeeds(
          ctx.privyDid,
          {
            authorSlug: q.author_slug ? String(q.author_slug) : null,
            org: q.org ? String(q.org).toLowerCase() : null,
            intent: q.intent ? String(q.intent).toLowerCase() : null,
            status: q.status ? String(q.status).toLowerCase() : null,
            limit: 200,
          },
          firestoreDeps,
        );
        return {
          ok: true,
          source: semantic ? "firestore_fallback" : "firestore",
          count: rows.length,
          content_seeds: rows,
        };
      } catch (err) {
        return sendValidationError(reply, err);
      }
    },
  );

  // ─── get one ────────────────────────────────────────────────────────────

  app.get(
    "/v1/content-seeds/:id",
    { preHandler: [requireApiKeyOrAuth] },
    async (request, reply) => {
      const ctx = await resolvePrincipal(request, reply, tenantIndex);
      if (!ctx) return;
      const id = String(request.params?.id || "");
      const row = await getContentSeed(ctx.privyDid, id, firestoreDeps);
      if (!row) {
        return reply.code(404).send({ error: "not_found" });
      }
      return { ok: true, content_seed: row };
    },
  );

  // ─── polish writeback ───────────────────────────────────────────────────
  //
  // Idempotent: the agent runs the critique loop in medha-platform and posts
  // the result here. Passing no fields just bumps updated_at, which the
  // agent uses to mark a seed as "I have it, polish is in progress".

  app.post(
    "/v1/content-seeds/:id/polish",
    {
      preHandler: [requireApiKeyOrAuth],
      schema: { body: polishSchema },
    },
    async (request, reply) => {
      const ctx = await resolvePrincipal(request, reply, tenantIndex);
      if (!ctx) return;
      const id = String(request.params?.id || "");
      const updated = await applyPolishResult(
        ctx.privyDid,
        id,
        request.body || {},
        firestoreDeps,
      );
      if (!updated) {
        return reply.code(404).send({ error: "not_found" });
      }
      indexAsync(indexContentSeed, app, ctx.privyDid, updated);
      return { ok: true, content_seed: updated };
    },
  );
}
