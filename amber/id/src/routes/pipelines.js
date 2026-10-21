/**
 * /v1/pipelines/* — investor, event, and multi-thread relationship CRUD.
 *
 * These three first-class pipeline objects let Sagar split partnerships
 * (in his head until now) into named threads:
 *   - investor: Jared, Carlo's tax-credit thread, the Perplexity intro
 *   - event:    Rytual 3-events framework (vipassana, everything-night,
 *               lightning-in-a-bottle, rave, custom)
 *   - relationship: one person who shows up in two pipelines at once
 *                   (Carlo as both partner and investor)
 *
 * Auth follows /v1/me/events: Privy bearer token OR a service x-api-key
 * with x-amber-phone header. The tenant DID always comes from the
 * verified principal; body-level userId fields are rejected.
 *
 * Storage:
 *   agent_data/{tenantDid}/pipeline_investors/{id}
 *   agent_data/{tenantDid}/pipeline_events/{id}
 *   agent_data/{tenantDid}/pipeline_relationships/{id}
 *
 * Pinecone indexing is best-effort via knowledge/pipelines-index.js
 * which currently no-ops while Tab 7 stands up the per-DID client.
 */

import { tenantIndex as defaultTenantIndex } from "../lib/auth-session.js";
import {
  requireApiKeyOrAuth as defaultRequireApiKeyOrAuth,
  validatePhone,
} from "../lib/auth.js";
import {
  upsertInvestor,
  getInvestor,
  listInvestors,
  deleteInvestor,
  upsertEvent,
  getEvent,
  listEvents,
  deleteEvent,
  upsertRelationship,
  addThreadToRelationship,
  findRelationships,
  deleteRelationship,
  INVESTOR_STAGES,
  EVENT_TYPES,
  DIMENSIONS,
  RELATIONSHIP_PIPELINES,
} from "../db/pipelines.js";
import { extractClaimedDid } from "../lib/claimed-did.js";

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

const investorSchema = {
  type: "object",
  required: ["name", "stage"],
  properties: {
    id: { type: "string", maxLength: 128 },
    name: { type: "string", minLength: 1, maxLength: 200 },
    contact_email: { type: "string", maxLength: 320 },
    contact_phone: { type: "string", maxLength: 32 },
    stage: { type: "string", maxLength: 32 },
    thesis_fit_note: { type: "string", maxLength: 4000 },
    last_touch_at: { type: "string", maxLength: 64 },
    threads: { type: "array", items: { type: "string" }, maxItems: 50 },
  },
  additionalProperties: false,
};

const eventSchema = {
  type: "object",
  required: ["name", "type", "dimension"],
  properties: {
    id: { type: "string", maxLength: 128 },
    name: { type: "string", minLength: 1, maxLength: 200 },
    type: { type: "string", maxLength: 64 },
    date_start: { type: "string", maxLength: 64 },
    date_end: { type: "string", maxLength: 64 },
    location: { type: "string", maxLength: 200 },
    attendees: { type: "array", items: { type: "string" }, maxItems: 1000 },
    dimension: { type: "string", maxLength: 32 },
    notes: { type: "string", maxLength: 8000 },
  },
  additionalProperties: false,
};

const threadSchema = {
  type: "object",
  required: ["pipeline"],
  properties: {
    thread_id: { type: "string", maxLength: 128 },
    pipeline: { type: "string", maxLength: 32 },
    context: { type: "string", maxLength: 4000 },
    status: { type: "string", maxLength: 64 },
    last_event_at: { type: "string", maxLength: 64 },
  },
  additionalProperties: false,
};

const relationshipSchema = {
  type: "object",
  required: ["person_name"],
  properties: {
    id: { type: "string", maxLength: 128 },
    person_name: { type: "string", minLength: 1, maxLength: 200 },
    contact_email: { type: "string", maxLength: 320 },
    threads: { type: "array", items: threadSchema, maxItems: 50 },
  },
  additionalProperties: false,
};

function validateEnum(value, allowed, field) {
  if (allowed.has(value)) return null;
  return {
    error: `invalid_${field}`,
    message: `${field}=${value} is not one of ${[...allowed].join(", ")}`,
  };
}

function investorSearchText(row) {
  return [row.name, row.stage, row.thesis_fit_note, row.contact_email]
    .filter(Boolean)
    .join(" — ");
}

function eventSearchText(row) {
  return [row.name, row.type, row.dimension, row.location, row.notes]
    .filter(Boolean)
    .join(" — ");
}

function relationshipSearchText(row) {
  const threadText = (row.threads || [])
    .map((t) => `${t.pipeline}: ${t.context || t.status || ""}`)
    .join(" | ");
  return [row.person_name, row.contact_email, threadText]
    .filter(Boolean)
    .join(" — ");
}

export function registerPipelinesRoutes(app, deps = {}) {
  const requireApiKeyOrAuth =
    deps.requireApiKeyOrAuth || defaultRequireApiKeyOrAuth;
  const tenantIndex = deps.tenantIndex || defaultTenantIndex;
  const dbOps = {
    upsertInvestor: deps.upsertInvestor || upsertInvestor,
    getInvestor: deps.getInvestor || getInvestor,
    listInvestors: deps.listInvestors || listInvestors,
    deleteInvestor: deps.deleteInvestor || deleteInvestor,
    upsertEvent: deps.upsertEvent || upsertEvent,
    getEvent: deps.getEvent || getEvent,
    listEvents: deps.listEvents || listEvents,
    deleteEvent: deps.deleteEvent || deleteEvent,
    upsertRelationship: deps.upsertRelationship || upsertRelationship,
    addThreadToRelationship:
      deps.addThreadToRelationship || addThreadToRelationship,
    findRelationships: deps.findRelationships || findRelationships,
    deleteRelationship: deps.deleteRelationship || deleteRelationship,
  };
  const index = deps.indexPipelineObject || (async () => ({ indexed: false }));

  // ── Investors ─────────────────────────────────────────────────────────

  app.post(
    "/v1/pipelines/investor",
    {
      preHandler: [requireApiKeyOrAuth],
      schema: { body: investorSchema },
    },
    async (request, reply) => {
      const ctx = await resolvePrincipal(request, reply, tenantIndex);
      if (!ctx) return;
      const body = request.body || {};
      const stageErr = validateEnum(body.stage, INVESTOR_STAGES, "stage");
      if (stageErr) return reply.code(400).send(stageErr);
      const row = await dbOps.upsertInvestor(ctx.privyDid, body);
      index(ctx.privyDid, {
        kind: "investor",
        id: row.id,
        text: investorSearchText(row),
        metadata: { stage: row.stage },
      }).catch(() => {});
      return reply.code(201).send({ ok: true, investor: row });
    },
  );

  app.get(
    "/v1/pipelines/investor",
    { preHandler: [requireApiKeyOrAuth] },
    async (request, reply) => {
      const ctx = await resolvePrincipal(request, reply, tenantIndex);
      if (!ctx) return;
      const stage = request.query?.stage;
      if (stage) {
        const stageErr = validateEnum(stage, INVESTOR_STAGES, "stage");
        if (stageErr) return reply.code(400).send(stageErr);
      }
      const limit = Math.min(parseInt(request.query?.limit, 10) || 100, 500);
      const rows = await dbOps.listInvestors(ctx.privyDid, { stage, limit });
      return { ok: true, count: rows.length, investors: rows };
    },
  );

  app.get(
    "/v1/pipelines/investor/:id",
    { preHandler: [requireApiKeyOrAuth] },
    async (request, reply) => {
      const ctx = await resolvePrincipal(request, reply, tenantIndex);
      if (!ctx) return;
      const row = await dbOps.getInvestor(ctx.privyDid, request.params.id);
      if (!row) return reply.code(404).send({ error: "investor_not_found" });
      return { ok: true, investor: row };
    },
  );

  app.delete(
    "/v1/pipelines/investor/:id",
    { preHandler: [requireApiKeyOrAuth] },
    async (request, reply) => {
      const ctx = await resolvePrincipal(request, reply, tenantIndex);
      if (!ctx) return;
      await dbOps.deleteInvestor(ctx.privyDid, request.params.id);
      return { ok: true, deleted: request.params.id };
    },
  );

  // ── Events (Rytual 3-events) ──────────────────────────────────────────

  app.post(
    "/v1/pipelines/event",
    {
      preHandler: [requireApiKeyOrAuth],
      schema: { body: eventSchema },
    },
    async (request, reply) => {
      const ctx = await resolvePrincipal(request, reply, tenantIndex);
      if (!ctx) return;
      const body = request.body || {};
      const typeErr = validateEnum(body.type, EVENT_TYPES, "type");
      if (typeErr) return reply.code(400).send(typeErr);
      const dimErr = validateEnum(body.dimension, DIMENSIONS, "dimension");
      if (dimErr) return reply.code(400).send(dimErr);
      const row = await dbOps.upsertEvent(ctx.privyDid, body);
      index(ctx.privyDid, {
        kind: "event",
        id: row.id,
        text: eventSearchText(row),
        metadata: { type: row.type, dimension: row.dimension },
      }).catch(() => {});
      return reply.code(201).send({ ok: true, event: row });
    },
  );

  app.get(
    "/v1/pipelines/event",
    { preHandler: [requireApiKeyOrAuth] },
    async (request, reply) => {
      const ctx = await resolvePrincipal(request, reply, tenantIndex);
      if (!ctx) return;
      const q = request.query || {};
      if (q.type) {
        const err = validateEnum(q.type, EVENT_TYPES, "type");
        if (err) return reply.code(400).send(err);
      }
      if (q.dimension) {
        const err = validateEnum(q.dimension, DIMENSIONS, "dimension");
        if (err) return reply.code(400).send(err);
      }
      const limit = Math.min(parseInt(q.limit, 10) || 100, 500);
      const rows = await dbOps.listEvents(ctx.privyDid, {
        from: q.from,
        to: q.to,
        type: q.type,
        dimension: q.dimension,
        limit,
      });
      return { ok: true, count: rows.length, events: rows };
    },
  );

  app.get(
    "/v1/pipelines/event/:id",
    { preHandler: [requireApiKeyOrAuth] },
    async (request, reply) => {
      const ctx = await resolvePrincipal(request, reply, tenantIndex);
      if (!ctx) return;
      const row = await dbOps.getEvent(ctx.privyDid, request.params.id);
      if (!row) return reply.code(404).send({ error: "event_not_found" });
      return { ok: true, event: row };
    },
  );

  app.delete(
    "/v1/pipelines/event/:id",
    { preHandler: [requireApiKeyOrAuth] },
    async (request, reply) => {
      const ctx = await resolvePrincipal(request, reply, tenantIndex);
      if (!ctx) return;
      await dbOps.deleteEvent(ctx.privyDid, request.params.id);
      return { ok: true, deleted: request.params.id };
    },
  );

  // ── Multi-thread relationships ────────────────────────────────────────

  app.post(
    "/v1/pipelines/relationship",
    {
      preHandler: [requireApiKeyOrAuth],
      schema: { body: relationshipSchema },
    },
    async (request, reply) => {
      const ctx = await resolvePrincipal(request, reply, tenantIndex);
      if (!ctx) return;
      const body = request.body || {};
      for (const t of body.threads || []) {
        const err = validateEnum(
          t.pipeline,
          RELATIONSHIP_PIPELINES,
          "pipeline",
        );
        if (err) return reply.code(400).send(err);
      }
      const row = await dbOps.upsertRelationship(ctx.privyDid, body);
      index(ctx.privyDid, {
        kind: "relationship",
        id: row.id,
        text: relationshipSearchText(row),
        metadata: { person_name: row.person_name },
      }).catch(() => {});
      return reply.code(201).send({ ok: true, relationship: row });
    },
  );

  app.post(
    "/v1/pipelines/relationship/:id/thread",
    {
      preHandler: [requireApiKeyOrAuth],
      schema: { body: threadSchema },
    },
    async (request, reply) => {
      const ctx = await resolvePrincipal(request, reply, tenantIndex);
      if (!ctx) return;
      const err = validateEnum(
        request.body?.pipeline,
        RELATIONSHIP_PIPELINES,
        "pipeline",
      );
      if (err) return reply.code(400).send(err);
      const row = await dbOps.addThreadToRelationship(
        ctx.privyDid,
        request.params.id,
        request.body || {},
      );
      if (!row)
        return reply.code(404).send({ error: "relationship_not_found" });
      index(ctx.privyDid, {
        kind: "relationship",
        id: row.id,
        text: relationshipSearchText(row),
        metadata: { person_name: row.person_name },
      }).catch(() => {});
      return { ok: true, relationship: row };
    },
  );

  app.get(
    "/v1/pipelines/relationship",
    { preHandler: [requireApiKeyOrAuth] },
    async (request, reply) => {
      const ctx = await resolvePrincipal(request, reply, tenantIndex);
      if (!ctx) return;
      const q = request.query || {};
      const limit = Math.min(parseInt(q.limit, 10) || 100, 500);
      const rows = await dbOps.findRelationships(ctx.privyDid, {
        person_name: q.person_name,
        limit,
      });
      return { ok: true, count: rows.length, relationships: rows };
    },
  );

  app.delete(
    "/v1/pipelines/relationship/:id",
    { preHandler: [requireApiKeyOrAuth] },
    async (request, reply) => {
      const ctx = await resolvePrincipal(request, reply, tenantIndex);
      if (!ctx) return;
      await dbOps.deleteRelationship(ctx.privyDid, request.params.id);
      return { ok: true, deleted: request.params.id };
    },
  );
}
